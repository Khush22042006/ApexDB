/**
 * ApexDB Multi-Version Concurrency Control (MVCC) Engine
 *
 * Implements Snapshot Isolation (SI) with non-blocking reads,
 * write-write conflict detection, and historical Time-Travel visibility.
 */

import { Row } from '../types.ts';

export interface TxnSnapshot {
  txnId: number;
  readTimestamp: number;
  activeTxnIds: Set<number>;
  committedTxnIds: Set<number>;
}

export class MVCCEngine {
  private activeTxns: Map<number, { startTime: number; status: 'ACTIVE' | 'COMMITTED' | 'ABORTED' }> = new Map();
  private committedTxns: Set<number> = new Set();
  private abortedTxns: Set<number> = new Set();
  private globalClock: number = 1000;

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.activeTxns.clear();
    this.committedTxns.clear();
    this.abortedTxns.clear();
    this.globalClock = 1000;
  }

  public getNextTimestamp(): number {
    return ++this.globalClock;
  }

  public registerTxn(txnId: number): void {
    this.activeTxns.set(txnId, {
      startTime: this.getNextTimestamp(),
      status: 'ACTIVE',
    });
  }

  public commitTxn(txnId: number): void {
    this.activeTxns.delete(txnId);
    this.committedTxns.add(txnId);
  }

  public abortTxn(txnId: number): void {
    this.activeTxns.delete(txnId);
    this.abortedTxns.add(txnId);
  }

  /**
   * Creates an MVCC snapshot for transaction isolation
   */
  public createSnapshot(currentTxnId: number): TxnSnapshot {
    const active = new Set<number>();
    for (const [id, data] of this.activeTxns.entries()) {
      if (id !== currentTxnId && data.status === 'ACTIVE') {
        active.add(id);
      }
    }

    return {
      txnId: currentTxnId,
      readTimestamp: this.getNextTimestamp(),
      activeTxnIds: active,
      committedTxnIds: new Set(this.committedTxns),
    };
  }

  /**
   * Evaluates standard MVCC Snapshot Isolation visibility
   */
  public isVisible(row: Row, snapshot: TxnSnapshot): boolean {
    const xmin = row._xmin ?? 1;
    const xmax = row._xmax ?? 0;

    // 1. Did the current transaction create it?
    if (xmin === snapshot.txnId) {
      // Visible unless the current txn also deleted it
      return xmax !== snapshot.txnId;
    }

    // 2. Was xmin committed prior to snapshot?
    const isXminCommitted = this.committedTxns.has(xmin) || xmin === 1;
    if (!isXminCommitted) {
      return false; // Created by uncommitted transaction
    }

    if (snapshot.activeTxnIds.has(xmin)) {
      return false; // xmin was still active when snapshot was taken
    }

    // 3. Was it deleted/superseded by xmax?
    if (xmax === 0) {
      return true; // Still active
    }

    if (xmax === snapshot.txnId) {
      return false; // Deleted by current transaction
    }

    const isXmaxCommitted = this.committedTxns.has(xmax);
    if (!isXmaxCommitted) {
      return true; // xmax hasn't committed, so deletion is not visible yet
    }

    if (snapshot.activeTxnIds.has(xmax)) {
      return true; // xmax was active when snapshot was created, so deletion is not visible
    }

    // xmax is committed and was not active in snapshot -> tuple is dead
    return false;
  }

  /**
   * Time-Travel Query Evaluator: AS OF SYSTEM TIME <historicalTimestamp>
   */
  public isVisibleAtTime(row: Row, targetTimestamp: number): boolean {
    const rowCreated = row._timestamp ?? 0;
    if (rowCreated > targetTimestamp) {
      return false; // tuple was not created yet
    }

    // Check if xmax deleted it before target timestamp
    const xmax = row._xmax ?? 0;
    if (xmax > 0 && this.committedTxns.has(xmax)) {
      const deletedAt = (row as any)._deletedTimestamp ?? Infinity;
      if (deletedAt <= targetTimestamp) {
        return false; // already deleted at that time
      }
    }

    return true;
  }

  /**
   * Write-Write Conflict Detection (First-Committer-Wins / Serialization check)
   */
  public checkWriteConflict(row: Row, currentTxnId: number): { hasConflict: boolean; reason?: string } {
    const xmax = row._xmax ?? 0;
    if (xmax !== 0 && xmax !== currentTxnId) {
      if (this.activeTxns.has(xmax)) {
        return {
          hasConflict: true,
          reason: `Concurrent write-write conflict: row is concurrently modified by active Txn #${xmax}`,
        };
      }
    }
    return { hasConflict: false };
  }

  /**
   * Vacuum analysis: identifies obsolete tuples dead to all active transactions
   */
  public isDeadTuple(row: Row): boolean {
    const xmax = row._xmax ?? 0;
    if (xmax === 0) return false;
    if (!this.committedTxns.has(xmax)) return false;

    // If xmax is older than any active transaction's start time, no active snapshot can see it
    let oldestActiveTime = Infinity;
    for (const [, t] of this.activeTxns.entries()) {
      if (t.startTime < oldestActiveTime) {
        oldestActiveTime = t.startTime;
      }
    }

    const deletedAt = (row as any)._deletedTimestamp ?? 0;
    return deletedAt < oldestActiveTime;
  }
}
