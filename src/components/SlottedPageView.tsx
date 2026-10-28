/**
 * Slotted Page, Buffer Pool & Chaos Corruption Lab
 *
 * Implements:
 * 1. 4096-byte Slotted Page memory map with Adler-32 Checksums
 * 2. Deterministic Bit-Flip Corruption injection & Database Integrity verification
 * 3. MVCC Tuple Versioning inspection (_xmin, _xmax, versionId)
 * 4. 16-Frame Buffer Pool with Clock sweep eviction
 */

import { useState } from 'react';
import { Database } from '../engine/Database.ts';
import { SlottedPage } from '../engine/storage/SlottedPage.ts';
import { PAGE_SIZE } from '../engine/types.ts';
import { HardDrive, RefreshCw, Cpu, Flame, ShieldAlert, CheckCircle2, AlertTriangle } from 'lucide-react';

interface SlottedPageViewProps {
  db: Database;
  onRefreshDb: () => void;
}

export function SlottedPageView({ db, onRefreshDb }: SlottedPageViewProps) {
  const disk = db.diskManager;
  const bufferPool = db.bufferPool;

  const existingPageIds = disk.getExistingPageIds();
  const [selectedPageId, setSelectedPageId] = useState<number>(existingPageIds[0] ?? 0);
  const [selectedSlotIdx, setSelectedSlotIdx] = useState<number | null>(null);

  // Read current page
  const pageRaw = disk.readPage(selectedPageId);
  const slottedPage = new SlottedPage(new Uint8Array(pageRaw));
  const summary = slottedPage.getInspectorSummary();

  const frames = bufferPool.getFramesSnapshot();
  const stats = bufferPool.getStats();

  const [integrityScan, setIntegrityScan] = useState<{
    totalPages: number;
    corruptedPages: number[];
    validPages: number[];
  } | null>(null);

  const handleDefragment = () => {
    slottedPage.defragment();
    disk.writePage(selectedPageId, slottedPage.raw);
    onRefreshDb();
  };

  const handleFlushAll = () => {
    bufferPool.flushAll();
    onRefreshDb();
  };

  const handleInjectBitFlip = () => {
    db.injectCorruption(selectedPageId);
    onRefreshDb();
  };

  const handleVerifyIntegrity = () => {
    const report = db.verifyDatabaseIntegrity();
    setIntegrityScan(report);
  };

  const handleRestoreFromWAL = () => {
    db.runRecovery();
    setIntegrityScan(db.verifyDatabaseIntegrity());
    onRefreshDb();
  };

  const selectedSlot = selectedSlotIdx !== null ? summary.slots[selectedSlotIdx] : null;
  const selectedRow = selectedSlotIdx !== null ? slottedPage.getRow(selectedSlotIdx) : null;

  return (
    <div className="flex flex-col gap-6 p-6 max-w-[1440px] mx-auto w-full">
      {/* Top Banner: Page Selector & Buffer Pool Metrics */}
      <div className="border border-neutral-800 rounded bg-neutral-900/70 p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-neutral-300">Inspect Disk Page:</span>
            <select
              value={selectedPageId}
              onChange={(e) => {
                setSelectedPageId(parseInt(e.target.value, 10));
                setSelectedSlotIdx(null);
                setIntegrityScan(null);
              }}
              className="bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1 text-xs font-mono text-amber-300 focus:outline-none"
            >
              {existingPageIds.map((id) => (
                <option key={id} value={id}>
                  Page #{id} ({id === 0 ? 'Table Root' : `Heap Block ${id}`})
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={handleDefragment}
            className="cursor-pointer text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-200 px-3 py-1 rounded transition-colors flex items-center gap-1 font-sans"
            title="Compact records and remove delete tombstones"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Compact & Defragment Page</span>
          </button>
        </div>

        {/* Chaos Engineering & Checksums */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleVerifyIntegrity}
            className="cursor-pointer text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-200 px-3 py-1 rounded transition-colors flex items-center gap-1.5 font-sans"
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Verify Checksum Integrity</span>
          </button>

          <button
            onClick={handleInjectBitFlip}
            className="cursor-pointer text-xs bg-rose-950/50 hover:bg-rose-900/60 text-rose-300 border border-rose-800/80 px-3 py-1 rounded transition-colors flex items-center gap-1.5 font-sans"
            title="Inject bit-flip to test corruption detection"
          >
            <Flame className="w-3.5 h-3.5" />
            <span>Inject Bit-Flip Corruption</span>
          </button>

          <button
            onClick={handleFlushAll}
            className="cursor-pointer text-xs bg-amber-400 hover:bg-amber-300 text-neutral-950 font-medium px-2.5 py-1 rounded transition-colors font-sans"
          >
            Flush Buffer Pool
          </button>
        </div>
      </div>

      {/* Integrity Scan Report Banner */}
      {integrityScan && (
        <div
          className={`p-4 rounded border text-xs font-mono flex items-center justify-between ${
            integrityScan.corruptedPages.length === 0
              ? 'bg-emerald-950/40 border-emerald-800/80 text-emerald-300'
              : 'bg-rose-950/40 border-rose-800/80 text-rose-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {integrityScan.corruptedPages.length === 0 ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-400" />
            )}
            <span>
              Database Checksum Verification: {integrityScan.validPages.length} of{' '}
              {integrityScan.totalPages} pages valid.{' '}
              {integrityScan.corruptedPages.length > 0 &&
                `CORRUPTION DETECTED on Page(s) [${integrityScan.corruptedPages.join(', ')}]!`}
            </span>
          </div>

          {integrityScan.corruptedPages.length > 0 && (
            <button
              onClick={handleRestoreFromWAL}
              className="cursor-pointer px-3 py-1 rounded bg-amber-400 text-neutral-950 font-bold font-sans text-xs"
            >
              Recover Corrupted Pages via WAL
            </button>
          )}
        </div>
      )}

      {/* Main 2-Column Split: Slotted Page Memory Map & Buffer Pool Frame Table */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column (7 cols): 4096-Byte Slotted Page Memory Map */}
        <div className="lg:col-span-7 flex flex-col gap-4">
          <div className="border border-neutral-800 rounded bg-neutral-900/80 p-4">
            <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
              <div className="flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-semibold text-neutral-200">
                  Slotted-Page #{summary.pageId} (4,096 Bytes)
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`text-[11px] font-mono font-semibold px-2 py-0.5 rounded ${
                    summary.isChecksumValid
                      ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                      : 'bg-rose-950 text-rose-400 border border-rose-800 animate-pulse'
                  }`}
                >
                  {summary.isChecksumValid ? 'CHECKSUM VALID' : 'CORRUPTED BIT-FLIP'}
                </span>
                <span className="text-xs font-mono text-neutral-400">
                  Utilization: <strong className="text-neutral-200">{summary.dataUtilizationPercent}%</strong>
                </span>
              </div>
            </div>

            {/* Visual 4KB Linear Memory Bar */}
            <div className="mt-4 flex flex-col gap-2">
              <div className="flex items-center justify-between text-[11px] font-mono text-neutral-400">
                <span>0x0000 (Start)</span>
                <span>Free Gap: {summary.freeSpaceAvailable} B</span>
                <span>0x1000 (4096 B)</span>
              </div>

              <div className="h-9 w-full rounded bg-neutral-950 border border-neutral-800 overflow-hidden flex relative">
                {/* 36B Header */}
                <div
                  style={{ width: `${(36 / PAGE_SIZE) * 100}%`, minWidth: '20px' }}
                  className="bg-indigo-600/70 h-full flex items-center justify-center text-[9px] font-mono text-white select-none border-r border-indigo-400/40"
                  title="Page Header (36 bytes including 4B Checksum)"
                >
                  HDR
                </div>

                {/* Slot Directory */}
                <div
                  style={{
                    width: `${((summary.slotCount * 4) / PAGE_SIZE) * 100}%`,
                    minWidth: summary.slotCount > 0 ? '24px' : '0px',
                  }}
                  className="bg-sky-600/70 h-full flex items-center justify-center text-[9px] font-mono text-white select-none border-r border-sky-400/40"
                  title={`Slot Directory (${summary.slotCount} slots, ${summary.slotCount * 4} bytes)`}
                >
                  {summary.slotCount > 0 ? `SLOTS (${summary.slotCount})` : ''}
                </div>

                {/* Free space gap */}
                <div className="flex-1 h-full bg-neutral-900 flex items-center justify-center text-[10px] font-mono text-neutral-500">
                  Free Space ({summary.freeSpaceAvailable} Bytes)
                </div>

                {/* Records payload (from bottom up) */}
                <div
                  style={{
                    width: `${(((PAGE_SIZE - summary.freeSpaceUpper) / PAGE_SIZE) * 100)}%`,
                    minWidth: summary.activeRecordCount > 0 ? '40px' : '0px',
                  }}
                  className="bg-amber-600/70 h-full flex items-center justify-center text-[9px] font-mono text-white select-none border-l border-amber-400/40"
                  title={`Records Payload (${PAGE_SIZE - summary.freeSpaceUpper} bytes)`}
                >
                  RECORDS ({PAGE_SIZE - summary.freeSpaceUpper}B)
                </div>
              </div>
            </div>

            {/* Page Header Breakdown Card */}
            <div className="mt-4 p-3 rounded bg-neutral-950 border border-neutral-800/80 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
              <div>
                <span className="text-neutral-500 block text-[10px]">Page ID</span>
                <span className="text-neutral-200 font-medium">#{summary.pageId}</span>
              </div>
              <div>
                <span className="text-neutral-500 block text-[10px]">Adler-32 Checksum</span>
                <span className={summary.isChecksumValid ? 'text-emerald-400' : 'text-rose-400 font-bold'}>
                  0x{summary.checksum.toString(16).toUpperCase()}
                </span>
              </div>
              <div>
                <span className="text-neutral-500 block text-[10px]">Active Records</span>
                <span className="text-emerald-400 font-medium">{summary.activeRecordCount}</span>
              </div>
              <div>
                <span className="text-neutral-500 block text-[10px]">Page LSN</span>
                <span className="text-amber-400">{summary.pageLsn}</span>
              </div>
              <div>
                <span className="text-neutral-500 block text-[10px]">Free Lower</span>
                <span className="text-neutral-300">0x{summary.freeSpaceLower.toString(16).toUpperCase()}</span>
              </div>
              <div>
                <span className="text-neutral-500 block text-[10px]">Free Upper</span>
                <span className="text-neutral-300">0x{summary.freeSpaceUpper.toString(16).toUpperCase()}</span>
              </div>
              <div>
                <span className="text-neutral-500 block text-[10px]">Next Page Link</span>
                <span className="text-neutral-300">
                  {summary.nextPageId === 0 ? 'EOF (0)' : `#${summary.nextPageId}`}
                </span>
              </div>
              <div>
                <span className="text-neutral-500 block text-[10px]">Total Slots</span>
                <span className="text-neutral-200 font-medium">{summary.slotCount}</span>
              </div>
            </div>

            {/* Slots Directory Table */}
            <div className="mt-4">
              <h4 className="text-xs font-semibold text-neutral-300 mb-2">
                Slot Directory ({summary.slots.length} Entries)
              </h4>
              <div className="max-h-60 overflow-y-auto border border-neutral-800 rounded">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-neutral-800 bg-neutral-950 font-mono text-[11px] text-neutral-400">
                      <th className="px-3 py-2">Slot #</th>
                      <th className="px-3 py-2">Offset</th>
                      <th className="px-3 py-2">Length</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-800/60 font-mono text-neutral-300 text-xs">
                    {summary.slots.map((s) => (
                      <tr
                        key={s.index}
                        onClick={() => setSelectedSlotIdx(s.index)}
                        className={`cursor-pointer transition-colors ${
                          selectedSlotIdx === s.index ? 'bg-neutral-800/80 text-white' : 'hover:bg-neutral-850'
                        }`}
                      >
                        <td className="px-3 py-1.5 font-medium">Slot {s.index}</td>
                        <td className="px-3 py-1.5 text-neutral-400">
                          0x{s.offset.toString(16).toUpperCase().padStart(4, '0')} ({s.offset})
                        </td>
                        <td className="px-3 py-1.5 tabular-nums">{s.length} B</td>
                        <td className="px-3 py-1.5">
                          {s.isDeleted ? (
                            <span className="text-rose-400 text-[11px]">Tombstoned</span>
                          ) : (
                            <span className="text-emerald-400 text-[11px]">Active</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-amber-400 text-[11px]">Inspect</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Decoded Record & MVCC Version Header Inspector */}
            {selectedSlot && (
              <div className="mt-4 p-3 rounded bg-neutral-950 border border-neutral-800 flex flex-col gap-2">
                <div className="flex items-center justify-between pb-2 border-b border-neutral-800 text-xs">
                  <span className="font-semibold text-amber-300">
                    Slot {selectedSlotIdx} Record Payload & MVCC Header
                  </span>
                  <span className="text-[11px] font-mono text-neutral-400">
                    Offset: 0x{selectedSlot.offset.toString(16).toUpperCase()} · Length: {selectedSlot.length} B
                  </span>
                </div>

                {selectedRow ? (
                  <div className="flex flex-col gap-2 text-xs font-mono">
                    {/* MVCC Version Header */}
                    <div className="grid grid-cols-3 gap-2 p-2 rounded bg-neutral-900 border border-neutral-800 text-[11px]">
                      <div>
                        <span className="text-neutral-500 block">xmin (Created By Txn)</span>
                        <span className="text-emerald-400 font-bold">Txn #{selectedRow._xmin ?? 1}</span>
                      </div>
                      <div>
                        <span className="text-neutral-500 block">xmax (Deleted By Txn)</span>
                        <span className="text-neutral-300">
                          {selectedRow._xmax && selectedRow._xmax > 0 ? `Txn #${selectedRow._xmax}` : '0 (Active)'}
                        </span>
                      </div>
                      <div>
                        <span className="text-neutral-500 block">Version ID</span>
                        <span className="text-neutral-400 truncate block">{selectedRow._versionId ?? 'genesis'}</span>
                      </div>
                    </div>

                    <pre className="bg-neutral-900 p-2.5 rounded overflow-x-auto text-[11px] text-neutral-200">
                      {JSON.stringify(selectedRow, null, 2)}
                    </pre>
                  </div>
                ) : (
                  <span className="text-neutral-500 italic text-xs">No active data payload (tombstoned slot)</span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Column (5 cols): Buffer Pool 16-Frame Cache Table */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          <div className="border border-neutral-800 rounded bg-neutral-900/80 p-4">
            <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
              <div className="flex items-center gap-2">
                <Cpu className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-semibold text-neutral-200">
                  Buffer Pool ({frames.length} Frames · 64 KB Cache)
                </h3>
              </div>
              <span className="text-xs font-mono text-neutral-400">
                Clock Hand: <strong className="text-amber-400">Frame #{stats.clockHand}</strong>
              </span>
            </div>

            <p className="text-xs text-neutral-400 mt-2 mb-3">
              Implements Clock sweep & LRU eviction. Dirty frames require WAL log flushing prior to
              disk write-back.
            </p>

            {/* 16 Frames Grid */}
            <div className="grid grid-cols-2 gap-2 max-h-[520px] overflow-y-auto pr-1">
              {frames.map((frame) => {
                const isClockTarget = stats.clockHand === frame.frameId;
                const isLoaded = frame.pageId !== null;

                return (
                  <div
                    key={frame.frameId}
                    className={`p-2.5 rounded border text-xs font-mono transition-all ${
                      frame.isDirty
                        ? 'border-amber-600/70 bg-amber-950/20'
                        : isLoaded
                        ? 'border-neutral-700 bg-neutral-950'
                        : 'border-neutral-800/60 bg-neutral-950/40 opacity-60'
                    } ${isClockTarget ? 'ring-1 ring-amber-400' : ''}`}
                  >
                    <div className="flex items-center justify-between mb-1 text-[11px]">
                      <span className="font-semibold text-neutral-300">Frame {frame.frameId}</span>
                      {isClockTarget && (
                        <span className="text-[10px] text-amber-400 uppercase">Clock Hand</span>
                      )}
                    </div>

                    <div className="flex flex-col gap-0.5 text-[11px] text-neutral-400">
                      <div className="flex justify-between">
                        <span>Cached Page:</span>
                        <span className="text-neutral-200 font-medium">
                          {isLoaded ? `Page #${frame.pageId}` : 'Empty'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Pin Count:</span>
                        <span className={frame.pinCount > 0 ? 'text-emerald-400' : 'text-neutral-400'}>
                          {frame.pinCount}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Dirty Bit:</span>
                        <span className={frame.isDirty ? 'text-amber-400 font-semibold' : 'text-neutral-500'}>
                          {frame.isDirty ? 'DIRTY' : 'CLEAN'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Page LSN:</span>
                        <span className="text-neutral-400 tabular-nums">{frame.pageLsn}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
