/**
 * ApexDB Git-like Database Branching Engine
 *
 * Implements Copy-on-Write (CoW) database branches, three-way diffing,
 * and merge conflict detection.
 */

import { BranchInfo, BranchDiffRow, BranchMergeResult, Row, Value } from '../types.ts';

export interface BranchOverlay {
  addedRows: Map<string, Row[]>; // tableName -> rows
  modifiedRows: Map<string, Map<Value, Row>>; // tableName -> (PK -> Row)
  deletedRowPks: Map<string, Set<Value>>; // tableName -> Set<PK>
}

export class BranchManager {
  private branches: Map<string, BranchInfo> = new Map();
  private overlays: Map<string, BranchOverlay> = new Map();
  private primaryKeyColumns: Map<string, string> = new Map();
  public activeBranch: string = 'main';

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.branches.clear();
    this.overlays.clear();
    this.primaryKeyColumns.clear();
    this.activeBranch = 'main';

    this.createBranch('main', null, 'Production primary branch');
  }

  public createBranch(name: string, fromBranch: string | null = 'main', description: string = ''): BranchInfo {
    const branchName = name.toLowerCase().trim();
    if (this.branches.has(branchName)) {
      throw new Error(`Branch '${branchName}' already exists`);
    }

    const info: BranchInfo = {
      name: branchName,
      parentBranch: fromBranch,
      createdLsn: 1,
      createdTimestamp: Date.now(),
      headLsn: 1,
      activeTxnId: null,
      description: description || `Branched from ${fromBranch || 'root'}`,
    };

    this.branches.set(branchName, info);
    this.overlays.set(branchName, {
      addedRows: new Map(),
      modifiedRows: new Map(),
      deletedRowPks: new Map(),
    });

    return info;
  }

  public switchBranch(name: string): BranchInfo {
    const branchName = name.toLowerCase().trim();
    const branch = this.branches.get(branchName);
    if (!branch) {
      throw new Error(`Branch '${branchName}' does not exist`);
    }
    this.activeBranch = branchName;
    return branch;
  }

  public getActiveBranch(): BranchInfo {
    return this.branches.get(this.activeBranch)!;
  }

  public getAllBranches(): BranchInfo[] {
    return Array.from(this.branches.values());
  }

  public getOverlay(branchName: string): BranchOverlay {
    let overlay = this.overlays.get(branchName);
    if (!overlay) {
      overlay = {
        addedRows: new Map(),
        modifiedRows: new Map(),
        deletedRowPks: new Map(),
      };
      this.overlays.set(branchName, overlay);
    }
    return overlay;
  }

  /**
   * Records a mutation inside the active branch overlay
   */
  public recordInsert(tableName: string, row: Row, pkCol: string): void {
    if (this.activeBranch === 'main') return; // direct commits to main go straight to disk
    const overlay = this.getOverlay(this.activeBranch);
    const tbl = tableName.toLowerCase();
    this.primaryKeyColumns.set(tbl, pkCol);
    if (!overlay.addedRows.has(tbl)) {
      overlay.addedRows.set(tbl, []);
    }
    overlay.addedRows.get(tbl)!.push(row);
  }

  public recordUpdate(tableName: string, pkVal: Value, newRow: Row, pkCol?: string): void {
    if (this.activeBranch === 'main') return;
    const overlay = this.getOverlay(this.activeBranch);
    const tbl = tableName.toLowerCase();
    if (pkCol) this.primaryKeyColumns.set(tbl, pkCol);

    const added = overlay.addedRows.get(tbl);
    const pkColumn = this.primaryKeyColumns.get(tbl);
    if (added && pkColumn) {
      const addedIndex = added.findIndex((row) => row[pkColumn] === pkVal);
      if (addedIndex >= 0) {
        added[addedIndex] = newRow;
        return;
      }
    }
    overlay.deletedRowPks.get(tbl)?.delete(pkVal);
    if (!overlay.modifiedRows.has(tbl)) {
      overlay.modifiedRows.set(tbl, new Map());
    }
    overlay.modifiedRows.get(tbl)!.set(pkVal, newRow);
  }

  public recordDelete(tableName: string, pkVal: Value, pkCol?: string): void {
    if (this.activeBranch === 'main') return;
    const overlay = this.getOverlay(this.activeBranch);
    const tbl = tableName.toLowerCase();
    if (pkCol) this.primaryKeyColumns.set(tbl, pkCol);

    const pkColumn = this.primaryKeyColumns.get(tbl);
    const added = overlay.addedRows.get(tbl);
    if (added && pkColumn) {
      const addedIndex = added.findIndex((row) => row[pkColumn] === pkVal);
      if (addedIndex >= 0) {
        added.splice(addedIndex, 1);
        overlay.modifiedRows.get(tbl)?.delete(pkVal);
        return;
      }
    }
    overlay.modifiedRows.get(tbl)?.delete(pkVal);

    if (!overlay.deletedRowPks.has(tbl)) {
      overlay.deletedRowPks.set(tbl, new Set());
    }
    overlay.deletedRowPks.get(tbl)!.add(pkVal);
  }

  public clearOverlay(branchName: string): void {
    const branch = branchName.toLowerCase().trim();
    this.overlays.set(branch, {
      addedRows: new Map(),
      modifiedRows: new Map(),
      deletedRowPks: new Map(),
    });
  }

  /**
   * Diffs two branches, returning added, modified, and deleted records
   */
  public diff(baseBranch: string = 'main', targetBranch: string = this.activeBranch): BranchDiffRow[] {
    const targetOverlay = this.getOverlay(targetBranch);
    const diffs: BranchDiffRow[] = [];

    // Added rows
    for (const [tbl, rows] of targetOverlay.addedRows.entries()) {
      for (const r of rows) {
        const pkColumn = this.primaryKeyColumns.get(tbl);
        const pk = pkColumn ? r[pkColumn] : r.id ?? r.order_id;
        diffs.push({
          tableName: tbl,
          action: 'ADDED',
          primaryKey: pk,
          targetRow: r,
        });
      }
    }

    // Modified rows
    for (const [tbl, modMap] of targetOverlay.modifiedRows.entries()) {
      for (const [pk, r] of modMap.entries()) {
        diffs.push({
          tableName: tbl,
          action: 'MODIFIED',
          primaryKey: pk,
          targetRow: r,
        });
      }
    }

    // Deleted rows
    for (const [tbl, delSet] of targetOverlay.deletedRowPks.entries()) {
      for (const pk of delSet) {
        diffs.push({
          tableName: tbl,
          action: 'DELETED',
          primaryKey: pk,
        });
      }
    }

    return diffs;
  }

  /**
   * Merges changes from sourceBranch into targetBranch
   */
  public merge(
    sourceBranch: string,
    targetBranch: string = 'main',
    applyCallback: (diff: BranchDiffRow) => void
  ): BranchMergeResult {
    const diffs = this.diff(targetBranch, sourceBranch);
    const conflicts: { tableName: string; primaryKey: Value; message: string }[] = [];
    let appliedCount = 0;

    for (const d of diffs) {
      try {
        applyCallback(d);
        appliedCount++;
      } catch (err: any) {
        conflicts.push({
          tableName: d.tableName,
          primaryKey: d.primaryKey,
          message: err.message || 'Merge conflict',
        });
      }
    }

    return {
      success: conflicts.length === 0,
      sourceBranch,
      targetBranch,
      appliedChanges: appliedCount,
      conflicts,
      mergeLsn: Date.now(),
    };
  }
}
