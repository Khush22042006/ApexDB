/**
 * Write-Ahead Logging (WAL) & ARIES Crash Recovery Lab
 *
 * Demonstrates:
 * - Monotonically increasing Log Sequence Numbers (LSN)
 * - The WAL Invariant (Log before Page write-back)
 * - Simulated sudden system crash / power loss
 * - Complete 3-Phase ARIES Recovery: Analysis, Redo, and Undo
 */

import { useState } from 'react';
import { Database } from '../engine/Database.ts';
import { WalRecord, WalRecordType } from '../engine/types.ts';
import { RecoveryStep } from '../engine/wal/WALManager.ts';
import { ShieldAlert, RefreshCw, Zap, Flame, CheckCircle2 } from 'lucide-react';

interface WalRecoveryViewProps {
  db: Database;
  onRefreshDb: () => void;
}

export function WalRecoveryView({ db, onRefreshDb }: WalRecoveryViewProps) {
  const wal = db.wal;
  const summary = wal.getSummary();
  const allRecords = wal.getAllRecords();

  const [isCrashed, setIsCrashed] = useState<boolean>(false);
  const [recoveryLog, setRecoveryLog] = useState<{
    activeTxnIds: number[];
    committedTxnIds: number[];
    abortedTxnIds: number[];
    steps: RecoveryStep[];
  } | null>(null);

  const handleSimulateCrash = () => {
    db.simulateCrash();
    setIsCrashed(true);
    setRecoveryLog(null);
    onRefreshDb();
  };

  const handleRunRecovery = () => {
    const plan = db.runRecovery();
    setRecoveryLog(plan);
    setIsCrashed(false);
    onRefreshDb();
  };

  const handleCreateCheckpoint = () => {
    db.checkpoint();
    onRefreshDb();
  };

  const handleStartTxn = () => {
    db.execute('BEGIN;');
    onRefreshDb();
  };

  const handleCommitTxn = () => {
    db.execute('COMMIT;');
    onRefreshDb();
  };

  const handleRollbackTxn = () => {
    db.execute('ROLLBACK;');
    onRefreshDb();
  };

  return (
    <div className="flex flex-col gap-6 p-6 max-w-[1440px] mx-auto w-full">
      {/* Top Banner: Status & Actions */}
      <div className="border border-neutral-800 rounded bg-neutral-900/70 p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-neutral-200">System State:</span>
            {isCrashed ? (
              <span className="text-xs font-mono font-semibold text-rose-400 bg-rose-950/40 border border-rose-800/80 rounded px-2 py-0.5">
                CRASHED (RAM Lost)
              </span>
            ) : (
              <span className="text-xs font-mono font-semibold text-emerald-400 bg-emerald-950/40 border border-emerald-800/80 rounded px-2 py-0.5">
                RUNNING (Nominal)
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 pl-4 border-l border-neutral-800">
            <span className="text-xs font-medium text-neutral-300">Active Txn ID:</span>
            <span className="text-xs font-mono text-amber-300 tabular-nums">
              {db.getCurrentTxnId() !== null ? `#${db.getCurrentTxnId()}` : 'None (Auto-Commit)'}
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          {db.getCurrentTxnId() === null ? (
            <button
              onClick={handleStartTxn}
              className="cursor-pointer text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-200 px-3 py-1.5 rounded transition-colors font-sans"
            >
              Start Txn (BEGIN)
            </button>
          ) : (
            <>
              <button
                onClick={handleCommitTxn}
                className="cursor-pointer text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded transition-colors font-sans"
              >
                Commit
              </button>
              <button
                onClick={handleRollbackTxn}
                className="cursor-pointer text-xs bg-neutral-800 hover:bg-neutral-700 text-rose-300 px-3 py-1.5 rounded transition-colors font-sans"
              >
                Rollback
              </button>
            </>
          )}

          <button
            onClick={handleCreateCheckpoint}
            className="cursor-pointer text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-200 px-3 py-1.5 rounded transition-colors font-sans"
          >
            Checkpoint
          </button>

          {!isCrashed ? (
            <button
              onClick={handleSimulateCrash}
              className="cursor-pointer text-xs bg-rose-600 hover:bg-rose-500 text-white font-medium px-3.5 py-1.5 rounded transition-colors flex items-center gap-1.5 font-sans"
            >
              <Flame className="w-3.5 h-3.5 fill-current" />
              <span>Simulate Crash</span>
            </button>
          ) : (
            <button
              onClick={handleRunRecovery}
              className="cursor-pointer text-xs bg-amber-400 hover:bg-amber-300 text-neutral-950 font-medium px-3.5 py-1.5 rounded transition-colors flex items-center gap-1.5 font-sans"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Run ARIES Recovery</span>
            </button>
          )}
        </div>
      </div>

      {/* Recovery Result Trace Box */}
      {recoveryLog && (
        <div className="border border-emerald-800/80 rounded bg-emerald-950/20 p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between pb-2 border-b border-emerald-800/40">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm font-semibold text-emerald-300">
                ARIES Recovery Completed Successfully
              </h3>
            </div>
            <span className="text-xs font-mono text-neutral-400">
              Active Losers Rolled Back: [{recoveryLog.activeTxnIds.join(', ') || 'None'}]
            </span>
          </div>

          <div className="flex flex-col gap-2 mt-1">
            {recoveryLog.steps.map((s, idx) => (
              <div
                key={idx}
                className="p-2 rounded bg-neutral-950 border border-neutral-800 text-xs font-mono flex items-start gap-3"
              >
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-semibold ${
                    s.phase === 'ANALYSIS'
                      ? 'bg-sky-950 text-sky-300 border border-sky-800/60'
                      : s.phase === 'REDO'
                      ? 'bg-amber-950 text-amber-300 border border-amber-800/60'
                      : 'bg-rose-950 text-rose-300 border border-rose-800/60'
                  }`}
                >
                  {s.phase}
                </span>
                <div className="flex-1">
                  <div className="text-neutral-200 font-medium">{s.description}</div>
                  <div className="text-[11px] text-neutral-400 mt-0.5">{s.actionTaken}</div>
                </div>
                <span className="text-neutral-500 text-[10px] tabular-nums">LSN {s.lsn}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* WAL Records Streaming Table */}
      <div className="border border-neutral-800 rounded bg-neutral-900/80 p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-semibold text-neutral-200">
              WAL Record Stream ({allRecords.length} Log Records)
            </h3>
          </div>
          <div className="flex items-center gap-4 text-xs font-mono text-neutral-400">
            <span>
              Flushed LSN: <strong className="text-neutral-200 tabular-nums">{summary.flushedLsn}</strong>
            </span>
            <span>
              Last Checkpoint LSN:{' '}
              <strong className="text-neutral-200 tabular-nums">{summary.lastCheckpointLsn}</strong>
            </span>
          </div>
        </div>

        <div className="overflow-x-auto border border-neutral-800 rounded">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-neutral-800 bg-neutral-950 font-mono text-[11px] text-neutral-400">
                <th className="px-3 py-2.5">LSN</th>
                <th className="px-3 py-2.5">Prev LSN</th>
                <th className="px-3 py-2.5">Txn ID</th>
                <th className="px-3 py-2.5">Record Type</th>
                <th className="px-3 py-2.5">Target Location</th>
                <th className="px-3 py-2.5">Before / After Image</th>
                <th className="px-3 py-2.5">Persistence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800/60 font-mono text-neutral-300 text-xs">
              {allRecords.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-neutral-500 italic">
                    No WAL records generated yet.
                  </td>
                </tr>
              ) : (
                allRecords.map((r) => {
                  const isFlushed = r.lsn <= summary.flushedLsn;

                  return (
                    <tr key={r.lsn} className="hover:bg-neutral-850 transition-colors">
                      <td className="px-3 py-2 text-amber-300 font-semibold tabular-nums">
                        #{r.lsn}
                      </td>
                      <td className="px-3 py-2 text-neutral-500 tabular-nums">
                        {r.prevLsn > 0 ? `#${r.prevLsn}` : '0'}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {r.txnId > 0 ? `Txn ${r.txnId}` : 'Sys (0)'}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            r.type === WalRecordType.COMMIT
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/60'
                              : r.type === WalRecordType.ABORT
                              ? 'bg-rose-950 text-rose-300 border border-rose-800/60'
                              : r.type === WalRecordType.CHECKPOINT
                              ? 'bg-sky-950 text-sky-300 border border-sky-800/60'
                              : 'bg-neutral-800 text-neutral-200'
                          }`}
                        >
                          {r.type}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-neutral-400">
                        {r.tableName ? (
                          <span>
                            {r.tableName} (P{r.pageId}:S{r.slotIndex})
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-2 text-neutral-400 max-w-[280px] truncate text-[11px]">
                        {r.afterRow ? (
                          <span>{JSON.stringify(r.afterRow)}</span>
                        ) : r.beforeRow ? (
                          <span>Revert: {JSON.stringify(r.beforeRow)}</span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {isFlushed ? (
                          <span className="text-emerald-400 text-[11px]">Flushed to Disk</span>
                        ) : (
                          <span className="text-amber-400 text-[11px]">Volatile Buffer</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
