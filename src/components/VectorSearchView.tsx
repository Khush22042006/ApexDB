/**
 * Vector Indexing & Hybrid Search Studio
 *
 * Implements:
 * 1. Native k-NN Vector Cosine Similarity Search
 * 2. Hybrid Search: Weighted combination of BM25 text relevance and vector semantic distance
 * 3. Document Embeddings inspector
 */

import { useState } from 'react';
import { Database } from '../engine/Database.ts';
import { Search, Sliders, Zap, FileText } from 'lucide-react';

interface VectorSearchViewProps {
  db: Database;
  onRefreshDb: () => void;
}

const PRESET_VECTORS = [
  { label: 'OS & Low-Level IO', vector: [0.85, 0.15, 0.40, 0.10], text: 'kernel page cache io_uring' },
  { label: 'Database Storage Engines', vector: [0.22, 0.90, 0.38, 0.80], text: 'buffer pool clock sweep b-tree' },
  { label: 'Cryptography & ZK Proofs', vector: [0.08, 0.20, 0.95, 0.30], text: 'zero-knowledge succinct arguments' },
  { label: 'Neural Indexing / HNSW', vector: [0.30, 0.40, 0.18, 0.92], text: 'vector embeddings nearest neighbors' },
];

export function VectorSearchView({ db, onRefreshDb }: VectorSearchViewProps) {
  const vectorIndex = db.vectorIndexes.get('vector_docs.embedding');
  const allDocs = vectorIndex ? vectorIndex.getAllEntries() : [];

  const [queryText, setQueryText] = useState<string>('kernel buffer cache');
  const [vectorInput, setVectorInput] = useState<string>('0.85, 0.15, 0.40, 0.10');
  const [alpha, setAlpha] = useState<number>(0.6); // 0.6 vector, 0.4 text
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [hasSearched, setHasSearched] = useState<boolean>(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const handleRunHybridSearch = () => {
    setSearchError(null);
    if (!vectorIndex) {
      setSearchError('The vector index is not available.');
      return;
    }

    const rawParts = vectorInput.split(',').map((part) => part.trim());
    const queryVec = rawParts.map(Number);
    if (rawParts.length !== vectorIndex.dimensions || rawParts.some((part) => part === '') || queryVec.some((value) => !Number.isFinite(value))) {
      setSearchError(`Enter exactly ${vectorIndex.dimensions} finite comma-separated values.`);
      return;
    }

    try {
      const results = vectorIndex.searchHybrid(queryText, queryVec, 5, alpha);
      setSearchResults(results);
      setHasSearched(true);
    } catch (caught) {
      setSearchError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const handleApplyPreset = (preset: typeof PRESET_VECTORS[0]) => {
    setQueryText(preset.text);
    setVectorInput(preset.vector.join(', '));
  };

  return (
    <div className="flex flex-col gap-6 p-6 max-w-[1440px] mx-auto w-full">
      {/* Top Banner */}
      <div className="border border-neutral-800 rounded bg-neutral-900/70 p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-400" />
            <h2 className="text-base font-bold text-white">
              Native Vector & Hybrid Semantic Search Engine
            </h2>
          </div>
          <p className="text-xs text-neutral-400 mt-1 max-w-2xl">
            Executes native Cosine Similarity k-NN vector search and blends it with lexical BM25
            token matching for high-precision hybrid retrieval.
          </p>
        </div>

        <div className="flex items-center gap-3 text-xs font-mono text-neutral-400">
          <span>Vector Index: <strong className="text-amber-300">vec_docs_embedding (4D)</strong></span>
          <span>·</span>
          <span>Indexed Docs: <strong className="text-neutral-200 tabular-nums">{allDocs.length}</strong></span>
        </div>
      </div>

      {/* Grid: Search Controls vs Results */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Search Form & Presets (5 cols) */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          <div className="border border-neutral-800 rounded bg-neutral-900/80 p-4 flex flex-col gap-4">
            <h3 className="text-sm font-semibold text-neutral-200 pb-2 border-b border-neutral-800">
              Hybrid Query Parameters
            </h3>

            {/* Presets */}
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-neutral-400">Quick Concept Presets:</span>
              <div className="flex flex-wrap gap-1.5">
                {PRESET_VECTORS.map((p) => (
                  <button
                    key={p.label}
                    onClick={() => handleApplyPreset(p)}
                    className="cursor-pointer text-[11px] font-mono px-2 py-1 rounded bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 text-neutral-300 transition-colors"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Text Query */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-neutral-300">Lexical Text Query:</label>
              <input
                type="text"
                value={queryText}
                onChange={(e) => setQueryText(e.target.value)}
                placeholder="Keywords"
                className="bg-neutral-950 border border-neutral-800 rounded px-3 py-1.5 text-xs text-neutral-100 focus:outline-none"
              />
            </div>

            {/* Vector Query */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-neutral-300">
                Vector Embedding [v0, v1, v2, v3]:
              </label>
              <input
                type="text"
                value={vectorInput}
                onChange={(e) => setVectorInput(e.target.value)}
                placeholder="0.85, 0.15, 0.40, 0.10"
                className="bg-neutral-950 border border-neutral-800 rounded px-3 py-1.5 text-xs font-mono text-amber-300 focus:outline-none"
              />
            </div>

            {/* Hybrid Alpha Weight Slider */}
            <div className="p-3 rounded bg-neutral-950 border border-neutral-800 flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-neutral-400">Hybrid Alpha (α):</span>
                <span className="text-amber-400 font-bold tabular-nums">
                  {(alpha * 100).toFixed(0)}% Vector · {((1 - alpha) * 100).toFixed(0)}% Text
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={alpha}
                onChange={(e) => setAlpha(parseFloat(e.target.value))}
                className="w-full accent-amber-400 cursor-pointer"
              />
            </div>

            <button
              onClick={handleRunHybridSearch}
              className="cursor-pointer text-xs bg-amber-400 hover:bg-amber-300 text-neutral-950 font-semibold px-4 py-2 rounded transition-colors flex items-center justify-center gap-2 font-sans"
            >
              <Search className="w-3.5 h-3.5" />
              <span>Execute Hybrid Retrieval</span>
            </button>
            {searchError && <p role="alert" className="text-xs text-rose-300">{searchError}</p>}
          </div>
        </div>

        {/* Right Column: Scored Results & Catalog (7 cols) */}
        <div className="lg:col-span-7 flex flex-col gap-4">
          <div className="border border-neutral-800 rounded bg-neutral-900/80 p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
              <h3 className="text-sm font-semibold text-neutral-200">
                Top Matches ({searchResults.length > 0 ? searchResults.length : allDocs.length})
              </h3>
              <span className="text-xs font-mono text-neutral-400">Cosine + BM25 Score</span>
            </div>

            {hasSearched && searchResults.length === 0 ? (
              <div className="py-8 text-center text-xs text-neutral-400">No documents matched this query.</div>
            ) : !hasSearched ? (
              <div className="flex flex-col gap-2">
                <span className="text-xs text-neutral-400 mb-1">
                  Indexed Vector Catalog (Click Execute to rank):
                </span>
                {allDocs.map((doc) => (
                  <div
                    key={doc.key}
                    className="p-3 rounded bg-neutral-950 border border-neutral-800 flex items-center justify-between text-xs font-mono"
                  >
                    <div>
                      <div className="text-neutral-200 font-semibold">{doc.metadata?.title}</div>
                      <div className="text-neutral-500 text-[11px] mt-0.5">
                        Vector: [{doc.vector.map((v) => v.toFixed(2)).join(', ')}]
                      </div>
                    </div>
                    <span className="text-[11px] text-amber-400">Doc #{doc.key}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {searchResults.map((res, i) => {
                  const doc = allDocs.find((d) => d.key === res.key);

                  return (
                    <div
                      key={res.key}
                      className="p-3.5 rounded bg-neutral-950 border border-neutral-800 flex flex-col gap-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-neutral-100">
                          #{i + 1}. {doc?.metadata?.title}
                        </span>
                        <span className="text-xs font-mono font-bold text-emerald-400 tabular-nums">
                          Hybrid: {(res.hybridScore * 100).toFixed(1)}%
                        </span>
                      </div>

                      <div className="flex items-center gap-4 text-[11px] font-mono text-neutral-400 pt-1 border-t border-neutral-900">
                        <span>Vector Cosine: {(res.vectorScore * 100).toFixed(1)}%</span>
                        <span>·</span>
                        <span>Text Lexical: {(res.textScore * 100).toFixed(1)}%</span>
                        <span>·</span>
                        <span className="text-amber-300">RID P{res.rid.pageId}:S{res.rid.slotIndex}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
