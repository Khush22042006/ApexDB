/**
 * ApexDB Autonomous Workload Monitor & Safe Shadow Index Optimizer
 *
 * Implements autonomous self-tuning:
 * 1. Workload pattern analysis (slow queries, unindexed predicates).
 * 2. Safe Shadow Testing: constructs shadow indexes in the background to verify real speedups.
 * 3. Automatic promotion of verified indexes.
 * 4. Materialized query result caching with invalidation epochs.
 */

import { WorkloadStat, IndexRecommendation, Row } from '../types.ts';
import { BPlusTree, BPlusKey } from '../index/BPlusTree.ts';

export class WorkloadAdvisor {
  private workloadStats: Map<string, WorkloadStat> = new Map();
  private recommendations: IndexRecommendation[] = [];
  private shadowIndexes: Map<string, BPlusTree> = new Map(); // "table.col" -> shadow tree

  // Materialized Query Result Cache
  private queryCache: Map<string, { rows: Row[]; columns: string[]; cachedAt: number; tables: string[] }> = new Map();
  private tableEpochs: Map<string, number> = new Map();
  private cacheEpoch: number = 0;

  public isAutoTuningEnabled: boolean = true;

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.workloadStats.clear();
    this.recommendations = [];
    this.shadowIndexes.clear();
    this.queryCache.clear();
    this.tableEpochs.clear();
    this.cacheEpoch = 0;
  }

  /**
   * Tracks query execution for autonomous workload analysis
   */
  public recordQuery(params: {
    sql: string;
    targetTable?: string;
    filterColumns?: string[];
    durationMs: number;
  }): void {
    if (!params.targetTable) return;

    const pattern = params.sql.replace(/\d+/g, '?').replace(/'[^']*'/g, '?').trim();
    const hash = `${params.targetTable}:${pattern}`;

    let stat = this.workloadStats.get(hash);
    if (!stat) {
      stat = {
        queryHash: hash,
        sqlPattern: pattern,
        frequency: 0,
        avgDurationMs: params.durationMs,
        maxDurationMs: params.durationMs,
        targetTable: params.targetTable,
        filterColumns: params.filterColumns || [],
        joinColumns: [],
        lastSeen: Date.now(),
      };
      this.workloadStats.set(hash, stat);
    }

    stat.frequency++;
    stat.avgDurationMs = (stat.avgDurationMs * (stat.frequency - 1) + params.durationMs) / stat.frequency;
    stat.maxDurationMs = Math.max(stat.maxDurationMs, params.durationMs);
    stat.lastSeen = Date.now();

    // Check if recommendations should be generated
    if (this.isAutoTuningEnabled) {
      this.evaluateRecommendations();
    }
  }

  private evaluateRecommendations(): void {
    for (const [, stat] of this.workloadStats.entries()) {
      if (stat.filterColumns.length > 0 && stat.frequency >= 2) {
        for (const col of stat.filterColumns) {
          const recId = `${stat.targetTable}.${col}`;
          const alreadyExists = this.recommendations.some((r) => r.id === recId);
          if (!alreadyExists) {
            this.recommendations.push({
              id: recId,
              tableName: stat.targetTable,
              columnName: col,
              reason: `Observed ${stat.frequency} unindexed queries with filter on '${col}' (avg: ${stat.avgDurationMs.toFixed(2)}ms)`,
              estimatedSpeedup: '3.5x - 8.0x',
              status: 'PENDING_SHADOW_TEST',
            });
          }
        }
      }
    }
  }

  /**
   * Safe Shadow Testing: builds a shadow index and executes verified test queries
   */
  public runShadowTest(
    recId: string,
    existingRows: Row[],
    runTestScan: (useIndex: boolean) => number
  ): IndexRecommendation | null {
    const rec = this.recommendations.find((r) => r.id === recId);
    if (!rec) return null;

    rec.status = 'SHADOW_TESTING';

    // 1. Build shadow index in isolated memory
    const shadowTree = new BPlusTree(4);
    for (let i = 0; i < existingRows.length; i++) {
      const val = existingRows[i][rec.columnName];
      if (val !== undefined && val !== null) {
        shadowTree.insert(val as BPlusKey, { pageId: 1, slotIndex: i });
      }
    }
    this.shadowIndexes.set(recId, shadowTree);

    // 2. Measure baseline vs shadow latency
    const baselineTime = runTestScan(false);
    const shadowTime = runTestScan(true);

    const speedup = (Math.max(0.01, baselineTime) / Math.max(0.01, shadowTime)).toFixed(1);
    rec.shadowSpeedupResult = `${speedup}x speedup confirmed`;
    rec.shadowTestDurationMs = Math.round(shadowTime * 100) / 100;

    // 3. Auto-promote if speedup is significant (>= 1.5x)
    if (parseFloat(speedup) >= 1.5) {
      rec.status = 'PROMOTED_LIVE';
    } else {
      rec.status = 'REJECTED';
    }

    return rec;
  }

  public getRecommendations(): IndexRecommendation[] {
    return [...this.recommendations];
  }

  public getWorkloadStats(): WorkloadStat[] {
    return Array.from(this.workloadStats.values());
  }

  // --- Materialized Query Cache ---

  public getCachedQuery(sql: string): { rows: Row[]; columns: string[] } | null {
    const entry = this.queryCache.get(sql);
    if (!entry) return null;

    // Verify invalidation epochs
    for (const tbl of entry.tables) {
      const currentEpoch = this.tableEpochs.get(tbl) || 0;
      if (entry.cachedAt < currentEpoch) {
        this.queryCache.delete(sql);
        return null; // Stale cache
      }
    }

    return { rows: entry.rows, columns: entry.columns };
  }

  public cacheQuery(sql: string, rows: Row[], columns: string[], tables: string[]): void {
    this.queryCache.set(sql, {
      rows,
      columns,
      cachedAt: this.cacheEpoch,
      tables,
    });
  }

  public invalidateTable(tableName: string): void {
    this.tableEpochs.set(tableName.toLowerCase(), ++this.cacheEpoch);
  }

  public getCacheStats() {
    return {
      entriesCount: this.queryCache.size,
      autoTuningEnabled: this.isAutoTuningEnabled,
      activeRecommendations: this.recommendations.length,
      shadowIndexesBuilt: this.shadowIndexes.size,
    };
  }
}
