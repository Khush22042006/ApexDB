/**
 * ApexDB Buffer Pool Manager
 *
 * Implements an in-memory frame cache between query execution and DiskManager.
 * Enforces LRU / Clock page eviction and Write-Ahead Logging (WAL) flush guarantees.
 */

import { PAGE_SIZE, BufferFrame } from '../types.ts';
import { DiskManager } from './DiskManager.ts';
import { SlottedPage } from './SlottedPage.ts';

export class BufferPool {
  private diskManager: DiskManager;
  private poolSize: number;
  private frames: BufferFrame[];
  private pageTable: Map<number, number> = new Map(); // pageId -> frameId
  private clockHand: number = 0;
  private nextAccessTime: number = 1;

  // Telemetry metrics
  public hits: number = 0;
  public misses: number = 0;
  public evictions: number = 0;
  public flushes: number = 0;

  // Hook for WAL invariant enforcement
  public onBeforeFlushPage?: (pageLsn: number) => void;

  constructor(diskManager: DiskManager, poolSize: number = 16) {
    this.diskManager = diskManager;
    this.poolSize = poolSize;
    this.frames = [];

    for (let i = 0; i < poolSize; i++) {
      this.frames.push({
        frameId: i,
        pageId: null,
        pinCount: 0,
        isDirty: false,
        pageLsn: 0,
        data: new Uint8Array(PAGE_SIZE),
        lastAccessed: 0,
        referenceBit: false,
      });
    }
  }

  public reset(discardDirtyPages: boolean = false): void {
    if (!discardDirtyPages) this.flushAll();
    this.pageTable.clear();
    this.clockHand = 0;
    this.nextAccessTime = 1;
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
    this.flushes = 0;
    for (let i = 0; i < this.poolSize; i++) {
      this.frames[i].pageId = null;
      this.frames[i].pinCount = 0;
      this.frames[i].isDirty = false;
      this.frames[i].pageLsn = 0;
      this.frames[i].data.fill(0);
      this.frames[i].lastAccessed = 0;
      this.frames[i].referenceBit = false;
    }
  }

  public getPoolSize(): number {
    return this.poolSize;
  }

  /**
   * Fetches a page into the buffer pool, pinning it.
   */
  public fetchPage(pageId: number): SlottedPage {
    // 1. Check if page is already in buffer pool (Hit)
    if (this.pageTable.has(pageId)) {
      this.hits++;
      const frameId = this.pageTable.get(pageId)!;
      const frame = this.frames[frameId];
      frame.pinCount++;
      frame.referenceBit = true;
      frame.lastAccessed = this.nextAccessTime++;
      return new SlottedPage(frame.data);
    }

    // 2. Buffer miss
    this.misses++;

    // 3. Find a victim frame to replace
    const victimFrameId = this.findVictimFrame();
    if (victimFrameId === -1) {
      throw new Error(`BufferPool out of memory: all ${this.poolSize} frames are pinned!`);
    }

    const frame = this.frames[victimFrameId];

    // 4. Evict existing page if dirty
    if (frame.pageId !== null) {
      if (frame.isDirty) {
        this.flushFrame(frame);
      }
      this.pageTable.delete(frame.pageId);
      this.evictions++;
    }

    // 5. Read requested page from disk
    const diskData = this.diskManager.readPage(pageId);
    frame.data.set(diskData);
    frame.pageId = pageId;
    frame.pinCount = 1;
    frame.isDirty = false;
    frame.referenceBit = true;
    frame.lastAccessed = this.nextAccessTime++;

    // Read LSN from page header (bytes 12-15)
    const view = new DataView(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);
    frame.pageLsn = view.getUint32(12, true);

    this.pageTable.set(pageId, victimFrameId);
    return new SlottedPage(frame.data);
  }

  /**
   * Unpins a page after operation completion.
   */
  public unpinPage(pageId: number, isDirty: boolean): void {
    const frameId = this.pageTable.get(pageId);
    if (frameId === undefined) {
      return;
    }
    const frame = this.frames[frameId];
    if (frame.pinCount > 0) {
      frame.pinCount--;
    }
    if (isDirty) {
      frame.isDirty = true;
      // sync page header LSN with frame if changed
      const view = new DataView(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);
      frame.pageLsn = view.getUint32(12, true);
      new SlottedPage(frame.data).updateChecksum();
    }
  }

  /**
   * Creates a new page on disk and brings it into the buffer pool pinned.
   */
  public newPage(): { pageId: number; page: SlottedPage } {
    const pageId = this.diskManager.allocatePage();
    const page = this.fetchPage(pageId);
    page.initialize(pageId);
    this.unpinPage(pageId, true);
    // Pin it back for the caller
    const frameId = this.pageTable.get(pageId)!;
    this.frames[frameId].pinCount = 1;
    return { pageId, page };
  }

  /**
   * Flushes a specific page to disk if dirty.
   */
  public flushPage(pageId: number): void {
    const frameId = this.pageTable.get(pageId);
    if (frameId !== undefined) {
      this.flushFrame(this.frames[frameId]);
    }
  }

  /**
   * Flushes all dirty pages to disk.
   */
  public flushAll(): void {
    for (const frame of this.frames) {
      if (frame.pageId !== null && frame.isDirty) {
        this.flushFrame(frame);
      }
    }
  }

  private flushFrame(frame: BufferFrame): void {
    if (frame.pageId === null) return;

    // Enforce WAL: logs up to frame.pageLsn must be flushed before page is written to disk!
    if (this.onBeforeFlushPage && frame.pageLsn > 0) {
      this.onBeforeFlushPage(frame.pageLsn);
    }

    this.diskManager.writePage(frame.pageId, frame.data);
    frame.isDirty = false;
    this.flushes++;
  }

  /**
   * Clock sweep / LRU replacement algorithm.
   */
  private findVictimFrame(): number {
    // First, look for an empty frame
    for (let i = 0; i < this.poolSize; i++) {
      if (this.frames[i].pageId === null) {
        return i;
      }
    }

    // Clock sweep replacement algorithm
    let scans = 0;
    while (scans < this.poolSize * 2) {
      const frame = this.frames[this.clockHand];
      if (frame.pinCount === 0) {
        if (!frame.referenceBit) {
          const victim = this.clockHand;
          this.clockHand = (this.clockHand + 1) % this.poolSize;
          return victim;
        } else {
          frame.referenceBit = false;
        }
      }
      this.clockHand = (this.clockHand + 1) % this.poolSize;
      scans++;
    }

    // Fallback: strictly Least Recently Used among unpinned
    let oldestTime = Infinity;
    let victim = -1;
    for (let i = 0; i < this.poolSize; i++) {
      if (this.frames[i].pinCount === 0 && this.frames[i].lastAccessed < oldestTime) {
        oldestTime = this.frames[i].lastAccessed;
        victim = i;
      }
    }
    return victim;
  }

  /**
   * Returns current snapshot of all frames for visualization.
   */
  public getFramesSnapshot(): BufferFrame[] {
    return this.frames.map((f) => ({
      frameId: f.frameId,
      pageId: f.pageId,
      pinCount: f.pinCount,
      isDirty: f.isDirty,
      pageLsn: f.pageLsn,
      data: f.data,
      lastAccessed: f.lastAccessed,
      referenceBit: f.referenceBit,
    }));
  }

  public getStats() {
    const totalRequests = this.hits + this.misses;
    const hitRate = totalRequests > 0 ? (this.hits / totalRequests) * 100 : 0;
    const dirtyCount = this.frames.filter((f) => f.isDirty).length;
    const pinnedCount = this.frames.filter((f) => f.pinCount > 0).length;

    return {
      poolSize: this.poolSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: Math.round(hitRate * 10) / 10,
      evictions: this.evictions,
      flushes: this.flushes,
      dirtyFrames: dirtyCount,
      pinnedFrames: pinnedCount,
      clockHand: this.clockHand,
    };
  }
}
