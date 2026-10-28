/**
 * ApexDB Learned Index (CDF Regression Spline)
 *
 * Implements a learned index model:
 * 1. Models key distribution as a Cumulative Distribution Function (CDF).
 * 2. Uses linear regression segments to predict target array offsets in O(1).
 * 3. Restricts lookup to a bounded window [pred - errorBound, pred + errorBound].
 */

import { RecordId } from '../types.ts';

export interface SplineSegment {
  minKey: number;
  maxKey: number;
  slope: number;
  intercept: number;
  errorBound: number;
}

export class LearnedIndex {
  public name: string;
  private sortedKeys: number[] = [];
  private records: RecordId[] = [];
  private segments: SplineSegment[] = [];
  public maxError: number = 2;

  constructor(name: string) {
    this.name = name;
  }

  public train(data: { key: number; rid: RecordId }[]): void {
    if (data.length === 0) return;

    // Sort data by key
    const sorted = [...data].sort((a, b) => a.key - b.key);
    this.sortedKeys = sorted.map((d) => d.key);
    this.records = sorted.map((d) => d.rid);

    this.buildLinearSplines();
  }

  private buildLinearSplines(): void {
    const N = this.sortedKeys.length;
    if (N <= 1) {
      this.segments = [
        {
          minKey: this.sortedKeys[0] ?? 0,
          maxKey: this.sortedKeys[0] ?? 0,
          slope: 0,
          intercept: 0,
          errorBound: 1,
        },
      ];
      return;
    }

    const minK = this.sortedKeys[0];
    const maxK = this.sortedKeys[N - 1];
    const keyRange = maxK - minK;

    const slope = keyRange > 0 ? (N - 1) / keyRange : 0;
    const intercept = -slope * minK;

    // Calculate max error bound across training keys
    let maxErr = 1;
    for (let i = 0; i < N; i++) {
      const pred = Math.round(slope * this.sortedKeys[i] + intercept);
      const err = Math.abs(pred - i);
      if (err > maxErr) maxErr = err;
    }

    this.maxError = maxErr;
    this.segments = [
      {
        minKey: minK,
        maxKey: maxK,
        slope,
        intercept,
        errorBound: maxErr,
      },
    ];
  }

  /**
   * Predicts key position via CDF and runs bounded local search
   */
  public search(key: number): {
    found: boolean;
    rid: RecordId | null;
    predictedIndex: number;
    actualIndex: number;
    errorDelta: number;
    comparisons: number;
  } {
    if (this.sortedKeys.length === 0) {
      return { found: false, rid: null, predictedIndex: 0, actualIndex: -1, errorDelta: 0, comparisons: 0 };
    }

    const seg = this.segments[0];
    const rawPred = Math.round(seg.slope * key + seg.intercept);
    const predIdx = Math.max(0, Math.min(this.sortedKeys.length - 1, rawPred));

    // Bounded search within [predIdx - errorBound, predIdx + errorBound]
    const low = Math.max(0, predIdx - seg.errorBound);
    const high = Math.min(this.sortedKeys.length - 1, predIdx + seg.errorBound);

    let comparisons = 0;
    for (let i = low; i <= high; i++) {
      comparisons++;
      if (this.sortedKeys[i] === key) {
        return {
          found: true,
          rid: this.records[i],
          predictedIndex: predIdx,
          actualIndex: i,
          errorDelta: Math.abs(predIdx - i),
          comparisons,
        };
      }
    }

    return {
      found: false,
      rid: null,
      predictedIndex: predIdx,
      actualIndex: -1,
      errorDelta: 0,
      comparisons,
    };
  }

  public getModelStats() {
    return {
      totalKeys: this.sortedKeys.length,
      segmentsCount: this.segments.length,
      maxErrorBound: this.maxError,
      slope: this.segments[0]?.slope.toFixed(4) ?? '0',
      intercept: this.segments[0]?.intercept.toFixed(2) ?? '0',
    };
  }
}
