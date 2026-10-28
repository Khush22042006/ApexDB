/**
 * ApexDB Write-Ahead Logging (WAL) and ARIES Recovery Engine
 *
 * Implements Write-Ahead Log protocol:
 * 1. Log records are appended prior to modifying buffer pool pages.
 * 2. Pages cannot be flushed to disk before their pageLSN is flushed to WAL disk.
 * 3. Supports ARIES recovery: Analysis, Redo, and Undo phases.
 */

import { WalRecord, WalRecordType, Row } from '../types.ts';

export interface RecoveryStep {
  phase: 'ANALYSIS' | 'REDO' | 'UNDO';
  lsn: number;
  description: string;
  actionTaken: string;
}

export class WALManager {
  private logBuffer: WalRecord[] = [];
  private persistentLog: WalRecord[] = [];
  private nextLsn: number = 1;
  private nextTxnId: number = 1;
  private flushedLsn: number = 0;
  private activeTxns: Set<number> = new Set();
  private lastCheckpointLsn: number = 0;

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.logBuffer = [];
    this.persistentLog = [];
    this.nextLsn = 1;
    this.nextTxnId = 1;
    this.flushedLsn = 0;
    this.activeTxns.clear();
    this.lastCheckpointLsn = 0;
  }

  public getFlushedLsn(): number {
    return this.flushedLsn;
  }

  public getNextLsn(): number {
    return this.nextLsn;
  }

  public startTransaction(): number {
    const txnId = this.nextTxnId++;
    this.activeTxns.add(txnId);
    this.appendRecord({
      txnId,
      type: WalRecordType.BEGIN,
    });
    return txnId;
  }

  public appendRecord(params: {
    txnId: number;
    type: WalRecordType;
    tableName?: string;
    pageId?: number;
    slotIndex?: number;
    beforeRow?: Row | null;
    afterRow?: Row | null;
  }): number {
    const lsn = this.nextLsn++;
    const prevLsn = this.getLastLsnForTxn(params.txnId);

    const record: WalRecord = {
      lsn,
      prevLsn,
      txnId: params.txnId,
      type: params.type,
      tableName: params.tableName,
      pageId: params.pageId,
      slotIndex: params.slotIndex,
      beforeRow: params.beforeRow,
      afterRow: params.afterRow,
      timestamp: Date.now(),
    };

    this.logBuffer.push(record);
    return lsn;
  }

  public commitTransaction(txnId: number): number {
    const lsn = this.appendRecord({
      txnId,
      type: WalRecordType.COMMIT,
    });
    this.activeTxns.delete(txnId);
    // Committing forces WAL flush to persistent storage (Durability requirement)
    this.flushToLsn(lsn);
    return lsn;
  }

  public abortTransaction(txnId: number): number {
    const lsn = this.appendRecord({
      txnId,
      type: WalRecordType.ABORT,
    });
    this.activeTxns.delete(txnId);
    this.flushToLsn(lsn);
    return lsn;
  }

  public createCheckpoint(): number {
    const lsn = this.appendRecord({
      txnId: 0,
      type: WalRecordType.CHECKPOINT,
    });
    this.lastCheckpointLsn = lsn;
    this.flushToLsn(lsn);
    return lsn;
  }

  /**
   * Flushes log buffer records up to target LSN to persistent log storage.
   */
  public flushToLsn(targetLsn: number): void {
    if (targetLsn <= this.flushedLsn) return;

    while (this.logBuffer.length > 0 && this.logBuffer[0].lsn <= targetLsn) {
      const rec = this.logBuffer.shift()!;
      this.persistentLog.push(rec);
      this.flushedLsn = rec.lsn;
    }
  }

  public flushAll(): void {
    while (this.logBuffer.length > 0) {
      const rec = this.logBuffer.shift()!;
      this.persistentLog.push(rec);
      this.flushedLsn = rec.lsn;
    }
  }

  public discardUnflushedRecords(): void {
    this.logBuffer = [];
    this.activeTxns.clear();
  }

  public getLastLsnForTxn(txnId: number): number {
    // Search backwards in logBuffer, then persistentLog
    for (let i = this.logBuffer.length - 1; i >= 0; i--) {
      if (this.logBuffer[i].txnId === txnId) {
        return this.logBuffer[i].lsn;
      }
    }
    for (let i = this.persistentLog.length - 1; i >= 0; i--) {
      if (this.persistentLog[i].txnId === txnId) {
        return this.persistentLog[i].lsn;
      }
    }
    return 0;
  }

  /**
   * Simulates ARIES crash recovery analysis, returning detailed step logs.
   */
  public analyzeAndPlanRecovery(): {
    activeTxnIds: number[];
    committedTxnIds: number[];
    abortedTxnIds: number[];
    steps: RecoveryStep[];
    redoStartLsn: number;
  } {
    const steps: RecoveryStep[] = [];
    const activeTxns = new Set<number>();
    const committedTxns = new Set<number>();
    const abortedTxns = new Set<number>();

    // Phase 1: Analysis
    const allRecords = [...this.persistentLog];
    const checkpointIdx = allRecords.findIndex((r) => r.lsn === this.lastCheckpointLsn);
    const startIdx = checkpointIdx >= 0 ? checkpointIdx : 0;

    steps.push({
      phase: 'ANALYSIS',
      lsn: this.lastCheckpointLsn,
      description: `Analysis Phase starting from checkpoint LSN ${this.lastCheckpointLsn}`,
      actionTaken: `Scanning ${allRecords.length - startIdx} log records to identify active loser transactions.`,
    });

    for (let i = startIdx; i < allRecords.length; i++) {
      const rec = allRecords[i];
      if (rec.type === WalRecordType.BEGIN) {
        activeTxns.add(rec.txnId);
      } else if (rec.type === WalRecordType.COMMIT) {
        activeTxns.delete(rec.txnId);
        committedTxns.add(rec.txnId);
      } else if (rec.type === WalRecordType.ABORT) {
        activeTxns.delete(rec.txnId);
        abortedTxns.add(rec.txnId);
      }
    }

    const redoStartLsn = this.lastCheckpointLsn > 0 ? this.lastCheckpointLsn : (allRecords[0]?.lsn ?? 1);

    steps.push({
      phase: 'ANALYSIS',
      lsn: allRecords[allRecords.length - 1]?.lsn ?? 0,
      description: `Analysis complete: ${activeTxns.size} uncommitted transactions identified as losers.`,
      actionTaken: `Active loser Txns: [${Array.from(activeTxns).join(', ')}]. Redo will start at LSN ${redoStartLsn}.`,
    });

    // Phase 2: Redo Simulation
    for (const rec of allRecords) {
      if (rec.lsn >= redoStartLsn) {
        if (rec.type === WalRecordType.INSERT || rec.type === WalRecordType.UPDATE || rec.type === WalRecordType.DELETE) {
          steps.push({
            phase: 'REDO',
            lsn: rec.lsn,
            description: `Redo operation: Txn ${rec.txnId} ${rec.type} on table ${rec.tableName || 'N/A'} (Page ${rec.pageId}, Slot ${rec.slotIndex})`,
            actionTaken: `Reapplying forward state to page ${rec.pageId} (PageLSN updated to ${rec.lsn}).`,
          });
        }
      }
    }

    // Phase 3: Undo Simulation
    // Reverse scan uncommitted loser transactions
    for (let i = allRecords.length - 1; i >= 0; i--) {
      const rec = allRecords[i];
      if (activeTxns.has(rec.txnId)) {
        if (rec.type === WalRecordType.INSERT) {
          steps.push({
            phase: 'UNDO',
            lsn: rec.lsn,
            description: `Undo INSERT from uncommitted Txn ${rec.txnId} on Page ${rec.pageId}, Slot ${rec.slotIndex}`,
            actionTaken: `Tombstoning inserted record to restore pre-crash state. Appended CLR.`,
          });
        } else if (rec.type === WalRecordType.UPDATE) {
          steps.push({
            phase: 'UNDO',
            lsn: rec.lsn,
            description: `Undo UPDATE from uncommitted Txn ${rec.txnId} on Page ${rec.pageId}, Slot ${rec.slotIndex}`,
            actionTaken: `Reverting record back to before-image. Appended CLR.`,
          });
        } else if (rec.type === WalRecordType.DELETE) {
          steps.push({
            phase: 'UNDO',
            lsn: rec.lsn,
            description: `Undo DELETE from uncommitted Txn ${rec.txnId} on Page ${rec.pageId}, Slot ${rec.slotIndex}`,
            actionTaken: `Restoring deleted record from before-image. Appended CLR.`,
          });
        }
      }
    }

    return {
      activeTxnIds: Array.from(activeTxns),
      committedTxnIds: Array.from(committedTxns),
      abortedTxnIds: Array.from(abortedTxns),
      steps,
      redoStartLsn,
    };
  }

  public getAllRecords(): WalRecord[] {
    return [...this.persistentLog, ...this.logBuffer];
  }

  public getPersistentRecords(): WalRecord[] {
    return [...this.persistentLog];
  }

  public getBufferRecords(): WalRecord[] {
    return [...this.logBuffer];
  }

  public getSummary() {
    return {
      totalRecords: this.persistentLog.length + this.logBuffer.length,
      persistentCount: this.persistentLog.length,
      bufferedCount: this.logBuffer.length,
      flushedLsn: this.flushedLsn,
      nextLsn: this.nextLsn,
      activeTxnIds: Array.from(this.activeTxns),
      lastCheckpointLsn: this.lastCheckpointLsn,
    };
  }
}
