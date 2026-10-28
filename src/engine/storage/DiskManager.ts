/**
 * ApexDB Disk Manager
 *
 * Simulates a hardware block device storing 4096-byte pages.
 * Tracks physical read/write I/O operations and page allocation.
 */

import { PAGE_SIZE } from '../types.ts';

export class DiskManager {
  private pages: Map<number, Uint8Array> = new Map();
  private nextPageId: number = 0;

  // I/O Telemetry
  public readsCount: number = 0;
  public writesCount: number = 0;
  private lastReadPageId: number = -1;
  public sequentialReads: number = 0;
  public randomReads: number = 0;

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.pages.clear();
    this.nextPageId = 0;
    this.readsCount = 0;
    this.writesCount = 0;
    this.lastReadPageId = -1;
    this.sequentialReads = 0;
    this.randomReads = 0;
  }

  public allocatePage(): number {
    const pageId = this.nextPageId++;
    const blank = new Uint8Array(PAGE_SIZE);
    this.pages.set(pageId, blank);
    this.writesCount++;
    return pageId;
  }

  public readPage(pageId: number): Uint8Array {
    this.readsCount++;
    if (this.lastReadPageId !== -1 && pageId === this.lastReadPageId + 1) {
      this.sequentialReads++;
    } else {
      this.randomReads++;
    }
    this.lastReadPageId = pageId;

    const existing = this.pages.get(pageId);
    if (!existing) {
      // Allocate if accessing newly
      const newPage = new Uint8Array(PAGE_SIZE);
      this.pages.set(pageId, newPage);
      if (pageId >= this.nextPageId) {
        this.nextPageId = pageId + 1;
      }
      return new Uint8Array(newPage); // return copy
    }
    return new Uint8Array(existing); // return clone to simulate reading from disk into memory
  }

  public writePage(pageId: number, data: Uint8Array): void {
    this.writesCount++;
    if (data.length !== PAGE_SIZE) {
      throw new Error(`Invalid page write size: expected ${PAGE_SIZE}, got ${data.length}`);
    }
    this.pages.set(pageId, new Uint8Array(data));
    if (pageId >= this.nextPageId) {
      this.nextPageId = pageId + 1;
    }
  }

  public getNumPages(): number {
    return this.nextPageId;
  }

  public getExistingPageIds(): number[] {
    return Array.from(this.pages.keys()).sort((a, b) => a - b);
  }

  public getRawPageData(pageId: number): Uint8Array | undefined {
    return this.pages.get(pageId);
  }

  public exportDiskImage(): Record<string, string> {
    const serialized: Record<string, string> = {};
    for (const [id, buf] of this.pages.entries()) {
      let binary = '';
      for (let i = 0; i < buf.length; i++) {
        binary += String.fromCharCode(buf[i]);
      }
      serialized[id.toString()] = btoa(binary);
    }
    return serialized;
  }

  public importDiskImage(serialized: Record<string, string>): void {
    this.reset();
    let maxId = 0;
    for (const [idStr, b64] of Object.entries(serialized)) {
      const id = parseInt(idStr, 10);
      const binary = atob(b64);
      const buf = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        buf[i] = binary.charCodeAt(i);
      }
      this.pages.set(id, buf);
      if (id >= maxId) maxId = id + 1;
    }
    this.nextPageId = maxId;
  }
}
