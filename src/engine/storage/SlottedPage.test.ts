import { describe, expect, it } from 'vitest';
import { SlottedPage } from './SlottedPage.ts';

describe('SlottedPage integrity', () => {
  it('rejects a zeroed checksum on initialized content', () => {
    const page = new SlottedPage();
    page.initialize(1);
    page.setChecksum(0);
    expect(page.verifyChecksum()).toBe(false);
  });

  it('accepts a fully blank zeroed page', () => {
    const page = new SlottedPage(new Uint8Array(4096));
    expect(page.verifyChecksum()).toBe(true);
  });

  it('accepts page content after checksum recalculation', () => {
    const page = new SlottedPage();
    page.initialize(7);
    page.updateChecksum();
    expect(page.verifyChecksum()).toBe(true);
  });
});
