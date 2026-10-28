/**
 * ApexDB Slotted Page Implementation with Checksums & Corruption Detection
 *
 * Implements standard database slotted-page layout inside a 4096-byte array:
 * [Header (36B: 32B base + 4B Adler-32 Checksum)] -> [Slot Directory: offset (2B) + length (2B) ->]
 * ... [Free Space Gap] ... [<- Record Payloads with MVCC Headers]
 */

import { PAGE_SIZE, PAGE_HEADER_SIZE, PageType, Slot, Row } from '../types.ts';

/**
 * Fast Adler-32 Checksum algorithm for block integrity verification
 */
export function computeAdler32(buf: Uint8Array, start: number = 0, end: number = buf.length): number {
  let a = 1;
  let b = 0;
  const MOD_ADLER = 65521;

  for (let i = start; i < end; i++) {
    a = (a + buf[i]) % MOD_ADLER;
    b = (b + a) % MOD_ADLER;
  }

  return (b << 16) | a;
}

export class SlottedPage {
  public raw: Uint8Array;
  private view: DataView;

  constructor(buffer?: Uint8Array) {
    if (buffer) {
      this.raw = buffer;
    } else {
      this.raw = new Uint8Array(PAGE_SIZE);
      this.initialize(0, PageType.HEAP_PAGE);
    }
    this.view = new DataView(this.raw.buffer, this.raw.byteOffset, this.raw.byteLength);
  }

  public initialize(pageId: number, pageType: PageType = PageType.HEAP_PAGE): void {
    this.view = new DataView(this.raw.buffer, this.raw.byteOffset, this.raw.byteLength);
    this.raw.fill(0);
    this.setPageId(pageId);
    this.setPageType(pageType);
    this.setSlotCount(0);
    this.setFreeSpaceLower(PAGE_HEADER_SIZE);
    this.setFreeSpaceUpper(PAGE_SIZE);
    this.setPageLsn(0);
    this.setNextPageId(0);
    this.setPrevPageId(0);
    this.updateChecksum();
  }

  // Header getters and setters
  public getPageId(): number {
    return this.view.getUint32(0, true);
  }

  public setPageId(id: number): void {
    this.view.setUint32(0, id, true);
  }

  public getPageType(): PageType {
    return this.view.getUint16(4, true) as PageType;
  }

  public setPageType(type: PageType): void {
    this.view.setUint16(4, type, true);
  }

  public getSlotCount(): number {
    return this.view.getUint16(6, true);
  }

  public setSlotCount(count: number): void {
    this.view.setUint16(6, count, true);
  }

  public getFreeSpaceLower(): number {
    return this.view.getUint16(8, true);
  }

  public setFreeSpaceLower(val: number): void {
    this.view.setUint16(8, val, true);
  }

  public getFreeSpaceUpper(): number {
    return this.view.getUint16(10, true);
  }

  public setFreeSpaceUpper(val: number): void {
    this.view.setUint16(10, val, true);
  }

  public getPageLsn(): number {
    return this.view.getUint32(12, true);
  }

  public setPageLsn(lsn: number): void {
    this.view.setUint32(12, lsn, true);
  }

  public getNextPageId(): number {
    return this.view.getUint32(16, true);
  }

  public setNextPageId(id: number): void {
    this.view.setUint32(16, id, true);
  }

  public getPrevPageId(): number {
    return this.view.getUint32(20, true);
  }

  public setPrevPageId(id: number): void {
    this.view.setUint32(20, id, true);
  }

  // Checksum at bytes 32..35
  public getChecksum(): number {
    return this.view.getUint32(32, true);
  }

  public setChecksum(cs: number): void {
    this.view.setUint32(32, cs, true);
  }

  public calculatePageChecksum(): number {
    // Checksum over bytes 0..31 and bytes 36..4095
    const headPart = computeAdler32(this.raw, 0, 32);
    const bodyPart = computeAdler32(this.raw, 36, PAGE_SIZE);
    return (headPart ^ bodyPart) >>> 0;
  }

  public updateChecksum(): void {
    const cs = this.calculatePageChecksum();
    this.setChecksum(cs);
  }

  public verifyChecksum(): boolean {
    const stored = this.getChecksum();
    if (stored === 0) return this.raw.every((byte) => byte === 0);
    const calculated = this.calculatePageChecksum();
    return stored === calculated;
  }

  /**
   * Deterministic corruption injection for testing failure recovery
   */
  public injectBitFlip(offset: number = 40): void {
    if (offset >= 0 && offset < PAGE_SIZE) {
      this.raw[offset] ^= 0xff; // flip bits
    }
  }

  public getFreeSpaceAvailable(): number {
    const free = this.getFreeSpaceUpper() - this.getFreeSpaceLower();
    return Math.max(0, free);
  }

  public getSlot(slotIndex: number): Slot | null {
    const slotCount = this.getSlotCount();
    if (slotIndex < 0 || slotIndex >= slotCount) {
      return null;
    }
    const slotOffset = PAGE_HEADER_SIZE + slotIndex * 4;
    const offset = this.view.getUint16(slotOffset, true);
    const length = this.view.getUint16(slotOffset + 2, true);
    return {
      offset,
      length,
      isDeleted: length === 0,
    };
  }

  public getAllSlots(): (Slot & { index: number })[] {
    const count = this.getSlotCount();
    const slots: (Slot & { index: number })[] = [];
    for (let i = 0; i < count; i++) {
      const s = this.getSlot(i);
      if (s) {
        slots.push({ ...s, index: i });
      }
    }
    return slots;
  }

  /**
   * Inserts record bytes into the page. Returns allocated slotIndex, or -1 if full.
   */
  public insertRecord(recordBytes: Uint8Array): number {
    const needed = recordBytes.length + 4; // slot directory entry is 4 bytes
    if (this.getFreeSpaceAvailable() < needed) {
      return -1;
    }

    // Check if we can reuse a deleted tombstone slot
    let targetSlotIndex = -1;
    const slotCount = this.getSlotCount();
    for (let i = 0; i < slotCount; i++) {
      const s = this.getSlot(i);
      if (s && s.isDeleted) {
        targetSlotIndex = i;
        break;
      }
    }

    const newUpper = this.getFreeSpaceUpper() - recordBytes.length;
    this.raw.set(recordBytes, newUpper);
    this.setFreeSpaceUpper(newUpper);

    if (targetSlotIndex !== -1) {
      const slotOffset = PAGE_HEADER_SIZE + targetSlotIndex * 4;
      this.view.setUint16(slotOffset, newUpper, true);
      this.view.setUint16(slotOffset + 2, recordBytes.length, true);
      this.updateChecksum();
      return targetSlotIndex;
    } else {
      const slotIndex = slotCount;
      const slotOffset = PAGE_HEADER_SIZE + slotIndex * 4;
      this.view.setUint16(slotOffset, newUpper, true);
      this.view.setUint16(slotOffset + 2, recordBytes.length, true);
      this.setSlotCount(slotCount + 1);
      this.setFreeSpaceLower(slotOffset + 4);
      this.updateChecksum();
      return slotIndex;
    }
  }

  public getRecordBytes(slotIndex: number): Uint8Array | null {
    const slot = this.getSlot(slotIndex);
    if (!slot || slot.isDeleted || slot.length === 0) {
      return null;
    }
    return this.raw.slice(slot.offset, slot.offset + slot.length);
  }

  public insertRow(row: Row): number {
    const jsonStr = JSON.stringify(row);
    const bytes = new TextEncoder().encode(jsonStr);
    return this.insertRecord(bytes);
  }

  public getRow(slotIndex: number): Row | null {
    const bytes = this.getRecordBytes(slotIndex);
    if (!bytes) return null;
    try {
      const jsonStr = new TextDecoder().decode(bytes);
      return JSON.parse(jsonStr) as Row;
    } catch {
      return null;
    }
  }

  public deleteRecord(slotIndex: number): boolean {
    const slot = this.getSlot(slotIndex);
    if (!slot || slot.isDeleted) {
      return false;
    }
    const slotOffset = PAGE_HEADER_SIZE + slotIndex * 4;
    this.view.setUint16(slotOffset + 2, 0, true);
    this.updateChecksum();
    return true;
  }

  public updateRow(slotIndex: number, newRow: Row): boolean {
    const jsonStr = JSON.stringify(newRow);
    const bytes = new TextEncoder().encode(jsonStr);
    const slot = this.getSlot(slotIndex);
    if (!slot || slot.isDeleted) return false;

    if (bytes.length <= slot.length) {
      this.raw.set(bytes, slot.offset);
      const slotOffset = PAGE_HEADER_SIZE + slotIndex * 4;
      this.view.setUint16(slotOffset + 2, bytes.length, true);
      this.updateChecksum();
      return true;
    }

    if (this.getFreeSpaceAvailable() < bytes.length) {
      this.defragment();
      if (this.getFreeSpaceAvailable() < bytes.length) {
        return false;
      }
    }

    const newUpper = this.getFreeSpaceUpper() - bytes.length;
    this.raw.set(bytes, newUpper);
    this.setFreeSpaceUpper(newUpper);
    const slotOffset = PAGE_HEADER_SIZE + slotIndex * 4;
    this.view.setUint16(slotOffset, newUpper, true);
    this.view.setUint16(slotOffset + 2, bytes.length, true);
    this.updateChecksum();
    return true;
  }

  public defragment(): void {
    const slots = this.getAllSlots().filter((s) => !s.isDeleted && s.length > 0);
    slots.sort((a, b) => b.offset - a.offset);

    const tempBuf = new Uint8Array(PAGE_SIZE);
    let currentUpper = PAGE_SIZE;

    for (const slot of slots) {
      const recordBytes = this.raw.slice(slot.offset, slot.offset + slot.length);
      currentUpper -= slot.length;
      tempBuf.set(recordBytes, currentUpper);
      const slotOffset = PAGE_HEADER_SIZE + slot.index * 4;
      this.view.setUint16(slotOffset, currentUpper, true);
    }

    this.raw.set(tempBuf.subarray(currentUpper, PAGE_SIZE), currentUpper);
    this.setFreeSpaceUpper(currentUpper);
    this.updateChecksum();
  }

  public getInspectorSummary() {
    const slotCount = this.getSlotCount();
    const slots = this.getAllSlots();
    const activeSlots = slots.filter((s) => !s.isDeleted);
    const deletedSlots = slots.filter((s) => s.isDeleted);
    const totalDataBytes = activeSlots.reduce((acc, s) => acc + s.length, 0);
    const isValidChecksum = this.verifyChecksum();

    return {
      pageId: this.getPageId(),
      pageType: this.getPageType(),
      slotCount,
      activeRecordCount: activeSlots.length,
      tombstoneCount: deletedSlots.length,
      freeSpaceLower: this.getFreeSpaceLower(),
      freeSpaceUpper: this.getFreeSpaceUpper(),
      freeSpaceAvailable: this.getFreeSpaceAvailable(),
      pageLsn: this.getPageLsn(),
      nextPageId: this.getNextPageId(),
      prevPageId: this.getPrevPageId(),
      checksum: this.getChecksum(),
      isChecksumValid: isValidChecksum,
      dataUtilizationPercent: Math.round((totalDataBytes / PAGE_SIZE) * 100),
      slots,
    };
  }
}
