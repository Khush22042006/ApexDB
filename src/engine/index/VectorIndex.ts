/**
 * ApexDB Vector & Hybrid Search Engine
 *
 * Implements native vector embeddings with Cosine Similarity, L2 Distance,
 * and Hybrid Search (combining BM25 text relevance and vector semantic distance).
 */

import { RecordId, Row } from '../types.ts';

export interface VectorEntry {
  key: string | number;
  vector: number[];
  rid: RecordId;
  metadata?: Record<string, any>;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

export class VectorIndex {
  public name: string;
  public dimensions: number;
  private entries: VectorEntry[] = [];

  constructor(name: string, dimensions: number = 4) {
    this.name = name;
    this.dimensions = dimensions;
  }

  public clear(): void {
    this.entries = [];
  }

  public insert(key: string | number, vector: number[], rid: RecordId, metadata?: Record<string, any>): void {
    this.validateVector(vector);
    const existingIdx = this.entries.findIndex((e) => e.key === key);
    if (existingIdx >= 0) {
      this.entries[existingIdx] = { key, vector, rid, metadata };
    } else {
      this.entries.push({ key, vector, rid, metadata });
    }
  }

  public delete(key: string | number): void {
    this.entries = this.entries.filter((e) => e.key !== key);
  }

  /**
   * k-Nearest Neighbors search using Cosine Similarity
   */
  public searchKNN(
    queryVector: number[],
    k: number = 5,
    filterPredicate?: (entry: VectorEntry) => boolean
  ): {
    key: string | number;
    score: number; // cosine similarity [0..1]
    rid: RecordId;
    metadata?: Record<string, any>;
  }[] {
    this.validateVector(queryVector);
    this.validateLimit(k);
    const scored: { key: string | number; score: number; rid: RecordId; metadata?: Record<string, any> }[] = [];

    for (const entry of this.entries) {
      if (filterPredicate && !filterPredicate(entry)) {
        continue;
      }
      const score = cosineSimilarity(queryVector, entry.vector);
      scored.push({
        key: entry.key,
        score: Math.round(score * 1000) / 1000,
        rid: entry.rid,
        metadata: entry.metadata,
      });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }

  /**
   * Hybrid Search: Combines keyword text matching with vector cosine distance
   */
  public searchHybrid(
    queryText: string,
    queryVector: number[],
    k: number = 5,
    alpha: number = 0.5 // 0.0 = pure text, 1.0 = pure vector
  ): {
    key: string | number;
    hybridScore: number;
    vectorScore: number;
    textScore: number;
    rid: RecordId;
  }[] {
    this.validateVector(queryVector);
    this.validateLimit(k);
    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
      throw new Error('Hybrid alpha must be between 0 and 1');
    }
    const tokens = queryText.toLowerCase().split(/\s+/).filter(Boolean);
    const results: {
      key: string | number;
      hybridScore: number;
      vectorScore: number;
      textScore: number;
      rid: RecordId;
    }[] = [];

    for (const entry of this.entries) {
      const vScore = cosineSimilarity(queryVector, entry.vector);

      // Text BM25-like overlap score
      let tScore = 0;
      if (entry.metadata?.text) {
        const textLower = String(entry.metadata.text).toLowerCase();
        let matches = 0;
        for (const tok of tokens) {
          if (textLower.includes(tok)) matches++;
        }
        tScore = tokens.length > 0 ? matches / tokens.length : 0;
      }

      const hybridScore = alpha * vScore + (1 - alpha) * tScore;

      results.push({
        key: entry.key,
        hybridScore: Math.round(hybridScore * 1000) / 1000,
        vectorScore: Math.round(vScore * 1000) / 1000,
        textScore: Math.round(tScore * 1000) / 1000,
        rid: entry.rid,
      });
    }

    results.sort((a, b) => b.hybridScore - a.hybridScore);
    return results.slice(0, k);
  }

  public getCount(): number {
    return this.entries.length;
  }

  public getAllEntries(): VectorEntry[] {
    return [...this.entries];
  }

  private validateVector(vector: number[]): void {
    if (vector.length !== this.dimensions || vector.some((value) => !Number.isFinite(value))) {
      throw new Error(`Vector must contain exactly ${this.dimensions} finite values`);
    }
  }

  private validateLimit(limit: number): void {
    if (!Number.isInteger(limit) || limit < 0) {
      throw new Error('Result limit must be a non-negative integer');
    }
  }
}
