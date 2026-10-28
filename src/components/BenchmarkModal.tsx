/**
 * Benchmark Modal Dialog
 *
 * Runs on-demand performance comparisons between Full Table Scans and B+ Tree Index Scans.
 */

import { useState } from 'react';
import { Database } from '../engine/Database.ts';
import { X, Play, Zap, HardDrive, CheckCircle } from 'lucide-react';

interface BenchmarkModalProps {
  db: Database;
  isOpen: boolean;
  onClose: () => void;
  onRefreshDb: () => void;
}

export function BenchmarkModal({ db, isOpen, onClose, onRefreshDb }: BenchmarkModalProps) {
  const [recordCount, setRecordCount] = useState<number>(500);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [results, setResults] = useState<{
    insertTimeMs: number;
    seqScanTimeMs: number;
    indexScanTimeMs: number;
    speedup: string;
    seqPages: number;
    recordsProcessed: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleRun = () => {
    setIsRunning(true);
    setError(null);
    setTimeout(() => {
      try {
        const dropResult = db.execute('DROP TABLE IF EXISTS perf_test;', { bypassApproval: true })[0];
        const createResult = db.execute(`CREATE TABLE perf_test (
          id INTEGER PRIMARY KEY AUTO_INCREMENT,
          account_val INTEGER,
          label TEXT
        );`)[0];
        if (!dropResult?.success || !createResult?.success) {
          throw new Error(dropResult?.error || createResult?.error || 'Benchmark setup failed');
        }

        const values = Array.from({ length: recordCount }, (_, index) => {
          const id = index + 1;
          return `(${id}, ${id * 7}, 'user_${id}')`;
        });
        const tInsertStart = performance.now();
        const insertResult = db.execute(`INSERT INTO perf_test (id, account_val, label) VALUES ${values.join(', ')};`)[0];
        const insertTime = performance.now() - tInsertStart;
        if (!insertResult?.success) throw new Error(insertResult?.error || 'Benchmark insert failed');

        const indexResult = db.execute('CREATE INDEX IF NOT EXISTS idx_perf_val ON perf_test (account_val);')[0];
        if (!indexResult?.success) throw new Error(indexResult?.error || 'Benchmark index creation failed');
        db.checkpoint();

      const targetVal = Math.floor(recordCount * 0.75) * 7;
      const targetLabel = `user_${Math.floor(recordCount * 0.75)}`;

      // 1. SeqScan on label
      const tSeq = performance.now();
      const resSeq = db.execute(`SELECT * FROM perf_test WHERE label = '${targetLabel}';`)[0];
      const seqTime = performance.now() - tSeq;

      // 2. IndexScan on account_val
      const tIdx = performance.now();
      const resIdx = db.execute(`SELECT * FROM perf_test WHERE account_val = ${targetVal};`)[0];
      const idxTime = performance.now() - tIdx;

        if (!resSeq.success || !resIdx.success || resSeq.rows?.length !== 1 || resIdx.rows?.length !== 1) {
          throw new Error(resSeq.error || resIdx.error || 'Benchmark queries returned unexpected results');
        }

      const speedup = (seqTime / Math.max(0.01, idxTime)).toFixed(1);

        setResults({
          insertTimeMs: Math.round(insertTime * 10) / 10,
          seqScanTimeMs: Math.round(seqTime * 100) / 100,
          indexScanTimeMs: Math.round(idxTime * 100) / 100,
          speedup: `${speedup}x`,
          seqPages: db.getTablePageCount('perf_test'),
          recordsProcessed: insertResult.affectedRows ?? 0,
        });
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setIsRunning(false);
        onRefreshDb();
      }
    }, 50);
  };

  return (
    <div className="fixed inset-0 z-50 bg-neutral-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-neutral-900 border border-neutral-800 rounded-lg max-w-xl w-full p-6 shadow-2xl flex flex-col gap-5">
        <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-semibold text-white">Database Engine Benchmark</h3>
          </div>
          <button
            onClick={onClose}
            className="cursor-pointer text-neutral-400 hover:text-white p-1 rounded"
            aria-label="Close benchmark"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-neutral-400 leading-relaxed">
          Generates a slotted-page dataset, constructs an in-memory B+ Tree index, and performs
          head-to-head latency testing between Full Heap Scan and B+ Tree Index Traversal.
        </p>

        <div className="flex items-center gap-3 text-xs">
          <span className="font-medium text-neutral-300">Dataset Size:</span>
          {[200, 500, 1000].map((count) => (
            <button
              key={count}
              onClick={() => setRecordCount(count)}
              className={`cursor-pointer px-3 py-1 rounded text-xs font-mono transition-colors ${
                recordCount === count
                  ? 'bg-amber-400 text-neutral-950 font-semibold'
                  : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
              }`}
            >
              {count} Rows
            </button>
          ))}
        </div>

        {results && (
          <div className="border border-neutral-800 rounded bg-neutral-950 p-4 flex flex-col gap-3 font-mono text-xs">
            <div className="flex items-center justify-between text-neutral-300 pb-2 border-b border-neutral-800">
              <span>Inserted {results.recordsProcessed} Slotted Records:</span>
              <span className="text-amber-400 font-semibold">{results.insertTimeMs} ms</span>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div className="p-2.5 rounded bg-neutral-900 border border-neutral-800">
                <span className="text-neutral-400 block text-[11px] mb-1">Full Table Scan:</span>
                <span className="text-base font-bold text-neutral-200">{results.seqScanTimeMs} ms</span>
                <span className="text-[10px] text-neutral-500 block mt-0.5">
                  Read all {results.seqPages} pages
                </span>
              </div>

              <div className="p-2.5 rounded bg-emerald-950/40 border border-emerald-800/60">
                <span className="text-emerald-400 block text-[11px] mb-1">B+ Tree Index Scan:</span>
                <span className="text-base font-bold text-emerald-300">{results.indexScanTimeMs} ms</span>
                <span className="text-[10px] text-emerald-400 block mt-0.5">
                  {results.speedup} faster lookup
                </span>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            onClick={onClose}
            className="cursor-pointer px-4 py-2 text-xs text-neutral-400 hover:text-white font-sans transition-colors"
          >
            Close
          </button>
          <button
            onClick={handleRun}
            disabled={isRunning}
            className="cursor-pointer px-4 py-2 bg-amber-400 hover:bg-amber-300 text-neutral-950 font-medium text-xs rounded flex items-center gap-1.5 font-sans transition-colors"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>{isRunning ? 'Running...' : 'Run Benchmark'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
