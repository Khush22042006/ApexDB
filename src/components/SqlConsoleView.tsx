/**
 * SQL Studio with Natural Language Translation, Query X-Ray & Data Provenance
 *
 * Features:
 * - SQL Editor with keyboard shortcuts & query templates
 * - Schema-grounded Natural Language to SQL converter
 * - Visual Query X-Ray (Estimated vs Actual Cardinality & Operator Timings)
 * - EXPLAIN WHY / WHY NOT Data Provenance inspector
 * - Materialized Query Result Caching detection
 */

import { useState } from 'react';
import { Database } from '../engine/Database.ts';
import { QueryResult, QueryPlanNode } from '../engine/types.ts';
import { NLQueryGenerator } from '../engine/ai/NLQueryGenerator.ts';
import { Play, RotateCcw, ArrowRight, CornerDownRight, Sparkles, Activity, ShieldCheck, Zap } from 'lucide-react';

interface SqlConsoleViewProps {
  db: Database;
  onRefreshDb: () => void;
}

const TEMPLATES = [
  {
    name: 'Point Lookup (B+ Tree)',
    sql: 'SELECT * FROM users WHERE age = 34;',
    desc: 'Uses B+ Tree index on age (O(log N))',
  },
  {
    name: 'Range Query (B+ Tree Chained)',
    sql: 'SELECT id, username, age FROM users WHERE age >= 30 AND age <= 42 ORDER BY age ASC;',
    desc: 'Traverses min leaf, then sequential leaf pointers',
  },
  {
    name: 'Full Table Scan (SeqScan)',
    sql: "SELECT username, department, email FROM users WHERE department = 'Engineering';",
    desc: 'Scans all slotted heap pages',
  },
  {
    name: 'EXPLAIN Execution Plan',
    sql: 'EXPLAIN SELECT * FROM users WHERE age = 34;',
    desc: 'Inspects Volcano iterator operators and cost',
  },
  {
    name: 'Insert with MVCC Versioning',
    sql: "INSERT INTO users (username, email, age, department) VALUES ('satya_n', 'satya@azure.dev', 56, 'Executive');",
    desc: 'Allocates slotted page slot and records xmin',
  },
  {
    name: 'ACID Transaction Rollback',
    sql: "BEGIN;\nUPDATE users SET age = 99 WHERE id = 1;\nSELECT * FROM users WHERE id = 1;\nROLLBACK;\nSELECT * FROM users WHERE id = 1;",
    desc: 'Demonstrates MVCC atomicity rollback',
  },
  {
    name: 'Sync Checkpoint',
    sql: 'CHECKPOINT;',
    desc: 'Flushes all dirty buffer frames and writes WAL checkpoint',
  },
];

export function SqlConsoleView({ db, onRefreshDb }: SqlConsoleViewProps) {
  const [query, setQuery] = useState<string>('SELECT * FROM users WHERE age >= 30 AND age <= 42 ORDER BY age ASC;');
  const [nlInput, setNlInput] = useState<string>('Find users in Engineering older than 30');
  const [nlExplanation, setNlExplanation] = useState<string | null>(null);
  const [results, setResults] = useState<QueryResult[]>([]);
  const [activeResultIdx, setActiveResultIdx] = useState<number>(0);
  const [activeResultTab, setActiveResultTab] = useState<'table' | 'xray' | 'provenance'>('table');
  const [isExecuting, setIsExecuting] = useState<boolean>(false);

  const schemas = db.getAllSchemas();
  const indexes = db.getAllIndexes();

  const handleRunQuery = () => {
    if (!query.trim()) return;
    setIsExecuting(true);
    try {
      const res = db.execute(query);
      setResults(res);
      setActiveResultIdx(0);
      onRefreshDb();
    } finally {
      setIsExecuting(false);
    }
  };

  const handleTranslateNL = () => {
    if (!nlInput.trim()) return;
    const translation = NLQueryGenerator.generateSQL(nlInput, schemas);
    setQuery(translation.sql);
    setNlExplanation(translation.explanation);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleRunQuery();
    }
  };

  const activeResult = results[activeResultIdx];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 p-6 max-w-[1440px] mx-auto w-full">
      {/* Left Sidebar: Schema Catalog & Templates */}
      <div className="lg:col-span-4 flex flex-col gap-6">
        {/* Catalog Browser */}
        <div className="border border-neutral-800 rounded bg-neutral-900/60 p-4">
          <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
            <h3 className="text-sm font-semibold text-neutral-200">System Catalog</h3>
            <span className="text-xs font-mono text-neutral-400">
              {schemas.length} tables · {indexes.length} indexes
            </span>
          </div>

          <div className="mt-3 flex flex-col gap-4">
            {schemas.map((s) => (
              <div key={s.name} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono font-medium text-amber-300">{s.name}</span>
                  <span className="text-neutral-400 font-mono text-[11px] tabular-nums">{s.rowCount} rows</span>
                </div>
                <div className="pl-2 border-l border-neutral-800 flex flex-col gap-1 text-[11px] font-mono text-neutral-400">
                  {s.columns.map((c) => (
                    <div key={c.name} className="flex items-center justify-between">
                      <span className="text-neutral-300">
                        {c.name} {c.primaryKey && <span className="text-amber-400 text-[10px]">PK</span>}
                      </span>
                      <span className="text-neutral-400">{c.type}</span>
                    </div>
                  ))}
                  {s.indexes.length > 0 && (
                    <div className="mt-1 pt-1 border-t border-neutral-800/60 text-[10px] text-emerald-400/90 flex flex-wrap gap-1">
                      <span>B+ Tree:</span>
                      {s.indexes.map((idx) => (
                        <span key={idx} className="font-mono text-neutral-300">({idx})</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Quick Query Templates */}
        <div className="border border-neutral-800 rounded bg-neutral-900/60 p-4">
          <h3 className="text-sm font-semibold text-neutral-200 pb-2 border-b border-neutral-800">
            Query Recipes
          </h3>
          <div className="mt-3 flex flex-col gap-2">
            {TEMPLATES.map((tmpl) => (
              <button
                key={tmpl.name}
                onClick={() => setQuery(tmpl.sql)}
                className="text-left p-2 rounded hover:bg-neutral-800/70 border border-neutral-800/80 transition-colors group cursor-pointer"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-neutral-200 group-hover:text-amber-300">
                    {tmpl.name}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-neutral-400 group-hover:text-amber-400 transition-transform group-hover:translate-x-0.5" />
                </div>
                <p className="text-[11px] text-neutral-400 mt-0.5 line-clamp-1">{tmpl.desc}</p>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Studio Area */}
      <div className="lg:col-span-8 flex flex-col gap-5">
        {/* Natural Language to SQL Assistant Bar */}
        <div className="border border-neutral-800 rounded bg-neutral-900/80 p-3.5 flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs font-medium text-neutral-300">
            <span className="flex items-center gap-1.5 text-amber-300">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>Natural Language to Safe SQL</span>
            </span>
            <span className="text-[11px] text-neutral-400">Schema-grounded translation</span>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              value={nlInput}
              onChange={(e) => setNlInput(e.target.value)}
              placeholder="e.g. Find users in Engineering older than 30"
              className="flex-1 bg-neutral-950 border border-neutral-800 rounded px-3 py-1.5 text-xs text-neutral-100 placeholder:text-neutral-500 focus:outline-none"
            />
            <button
              onClick={handleTranslateNL}
              className="cursor-pointer text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-100 px-3 py-1.5 rounded transition-colors whitespace-nowrap"
            >
              Generate SQL
            </button>
          </div>

          {nlExplanation && (
            <div className="text-[11px] text-neutral-400 pl-1 border-l-2 border-amber-400/80 mt-1">
              {nlExplanation}
            </div>
          )}
        </div>

        {/* Editor Box */}
        <div className="border border-neutral-800 rounded bg-neutral-900/90 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-800 bg-neutral-950/50">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-neutral-300">SQL Statement</span>
              <span className="text-[11px] text-neutral-400">· Press ⌘+Enter to execute</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  db.seedDefaultDatabase();
                  onRefreshDb();
                }}
                className="cursor-pointer text-xs text-neutral-400 hover:text-neutral-200 px-2.5 py-1 rounded border border-neutral-700/60 transition-colors flex items-center gap-1 font-sans"
                title="Reset database to default seed data"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset DB</span>
              </button>
              <button
                onClick={handleRunQuery}
                disabled={isExecuting}
                className="cursor-pointer text-xs font-medium text-neutral-950 bg-amber-400 hover:bg-amber-300 px-3.5 py-1 rounded transition-colors flex items-center gap-1.5 font-sans"
              >
                <Play className="w-3 h-3 fill-current" />
                <span>Execute</span>
              </button>
            </div>
          </div>

          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={5}
            placeholder="SELECT * FROM users WHERE age > 30;"
            className="w-full bg-neutral-950 p-4 font-mono text-xs text-neutral-100 placeholder:text-neutral-600 focus:outline-none resize-y selection:bg-neutral-800"
            spellCheck={false}
          />
        </div>

        {/* Results Section */}
        {results.length > 0 && (
          <div className="border border-neutral-800 rounded bg-neutral-900/80 overflow-hidden flex flex-col">
            {/* Multiple statement switcher */}
            {results.length > 1 && (
              <div className="flex items-center gap-1 p-1 bg-neutral-950 border-b border-neutral-800 overflow-x-auto">
                {results.map((r, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveResultIdx(i)}
                    className={`cursor-pointer px-3 py-1 text-xs font-mono rounded transition-colors whitespace-nowrap ${
                      activeResultIdx === i
                        ? 'bg-neutral-800 text-white font-medium'
                        : 'text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    Statement {i + 1} ({r.success ? 'OK' : 'ERR'})
                  </button>
                ))}
              </div>
            )}

            {/* Execution Telemetry Banner */}
            {activeResult && (
              <div className="px-4 py-2.5 border-b border-neutral-800/80 bg-neutral-950/40 flex flex-wrap items-center justify-between gap-4 text-xs">
                <div className="flex items-center gap-2">
                  <span
                    className={`font-semibold ${
                      activeResult.success ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {activeResult.success ? 'Query Succeeded' : 'Query Failed'}
                  </span>
                  <span className="text-neutral-500">·</span>
                  <span className="font-mono text-neutral-300 tabular-nums">
                    {activeResult.executionTimeMs} ms
                  </span>
                  {activeResult.cacheHit && (
                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-sky-950 text-sky-300 border border-sky-800">
                      Materialized Cache Hit
                    </span>
                  )}
                  {activeResult.affectedRows !== undefined && (
                    <>
                      <span className="text-neutral-500">·</span>
                      <span className="font-mono text-neutral-300 tabular-nums">
                        {activeResult.affectedRows} row{activeResult.affectedRows === 1 ? '' : 's'}
                      </span>
                    </>
                  )}
                </div>

                {/* Subsystem I/O stats */}
                <div className="flex items-center gap-4 text-[11px] font-mono text-neutral-400">
                  <span>
                    Disk I/O:{' '}
                    <strong className="text-neutral-200 font-semibold tabular-nums">
                      R:{activeResult.metrics.diskReads} W:{activeResult.metrics.diskWrites}
                    </strong>
                  </span>
                  <span>
                    Buffer Pool:{' '}
                    <strong className="text-neutral-200 font-semibold tabular-nums">
                      Hit:{activeResult.metrics.bufferHits} Miss:{activeResult.metrics.bufferMisses}
                    </strong>
                  </span>
                  <span>
                    WAL:{' '}
                    <strong className="text-neutral-200 font-semibold tabular-nums">
                      +{activeResult.metrics.walRecordsLogged} logs
                    </strong>
                  </span>
                </div>
              </div>
            )}

            {/* Results Navigation Tabs: Data Grid vs Query X-Ray vs Provenance */}
            {activeResult && activeResult.success && (
              <div className="flex items-center gap-2 px-4 py-2 border-b border-neutral-800 bg-neutral-950/60 text-xs">
                <button
                  onClick={() => setActiveResultTab('table')}
                  className={`cursor-pointer px-3 py-1 rounded transition-colors ${
                    activeResultTab === 'table' ? 'bg-neutral-800 text-white font-medium' : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  Tabular Results ({activeResult.rows?.length || 0})
                </button>
                <button
                  onClick={() => setActiveResultTab('xray')}
                  className={`cursor-pointer px-3 py-1 rounded transition-colors flex items-center gap-1.5 ${
                    activeResultTab === 'xray' ? 'bg-neutral-800 text-amber-300 font-medium' : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  <Activity className="w-3.5 h-3.5" />
                  <span>Query X-Ray</span>
                </button>
                <button
                  onClick={() => setActiveResultTab('provenance')}
                  className={`cursor-pointer px-3 py-1 rounded transition-colors flex items-center gap-1.5 ${
                    activeResultTab === 'provenance' ? 'bg-neutral-800 text-emerald-300 font-medium' : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>EXPLAIN WHY (Provenance)</span>
                </button>
              </div>
            )}

            {/* Result Content */}
            <div className="p-4">
              {activeResult && !activeResult.success && (
                <div className="p-3 rounded bg-rose-950/30 border border-rose-900/50 text-rose-300 text-xs font-mono">
                  {activeResult.error}
                </div>
              )}

              {activeResult && activeResult.success && (
                <>
                  {/* Tab 1: Tabular Data */}
                  {activeResultTab === 'table' && (
                    <>
                      {activeResult.rows && activeResult.rows.length > 0 ? (
                        <div className="overflow-x-auto border border-neutral-800 rounded">
                          <table className="w-full text-left text-xs border-collapse">
                            <thead>
                              <tr className="border-b border-neutral-800 bg-neutral-950/80">
                                {activeResult.columns?.map((col) => (
                                  <th
                                    key={col}
                                    className="px-3.5 py-2.5 font-mono font-medium text-neutral-300 text-[11px]"
                                  >
                                    {col}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-neutral-800/60 font-mono text-neutral-300">
                              {activeResult.rows.map((row, idx) => (
                                <tr key={idx} className="hover:bg-neutral-800/40 transition-colors">
                                  {activeResult.columns?.map((col) => {
                                    const val = row[col];
                                    return (
                                      <td
                                        key={col}
                                        className={`px-3.5 py-2 whitespace-nowrap tabular-nums ${
                                          val === null
                                            ? 'text-neutral-500 italic'
                                            : typeof val === 'number'
                                            ? 'text-emerald-400'
                                            : 'text-neutral-200'
                                        }`}
                                      >
                                        {val === null ? 'NULL' : String(val)}
                                      </td>
                                    );
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="py-6 text-center text-xs text-neutral-400">
                          {activeResult.statement || 'Operation completed with 0 rows returned.'}
                        </div>
                      )}
                    </>
                  )}

                  {/* Tab 2: Query X-Ray (Estimated vs Actual Cardinality & Timings) */}
                  {activeResultTab === 'xray' && activeResult.queryPlan && (
                    <div className="flex flex-col gap-3">
                      <div className="p-3 rounded bg-neutral-950 border border-neutral-800">
                        <div className="flex items-center justify-between pb-2 mb-2 border-b border-neutral-800 text-xs">
                          <span className="font-semibold text-amber-300">Volcano Query Execution Tree</span>
                          <span className="text-[11px] text-neutral-400 font-mono">
                            Actual Time: {activeResult.executionTimeMs} ms
                          </span>
                        </div>
                        <div className="pl-2">
                          <PlanTreeNode node={activeResult.queryPlan} isRoot={true} />
                        </div>
                      </div>

                      {/* Cardinality Delta Card */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 font-mono text-xs">
                        <div className="p-3 rounded bg-neutral-950 border border-neutral-800">
                                  <span className="text-neutral-400 block text-[11px]">Estimated Rows (table size):</span>
                          <span className="text-lg font-bold text-neutral-200">
                                  {activeResult.queryPlan.estimatedRows ?? 'Unavailable'}
                          </span>
                        </div>
                        <div className="p-3 rounded bg-neutral-950 border border-neutral-800">
                          <span className="text-neutral-400 block text-[11px]">Actual Rows Yielded:</span>
                          <span className="text-lg font-bold text-emerald-400">
                            {activeResult.rows?.length || 0}
                          </span>
                        </div>
                        <div className="p-3 rounded bg-neutral-950 border border-neutral-800">
                                  <span className="text-neutral-400 block text-[11px]">Relative Cardinality Error:</span>
                          <span className="text-lg font-bold text-sky-400">
                                  {activeResult.queryPlan.estimatedRows
                                    ? `${(Math.abs((activeResult.rows?.length ?? 0) - activeResult.queryPlan.estimatedRows) / activeResult.queryPlan.estimatedRows * 100).toFixed(1)}%`
                                    : 'Unavailable'}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Tab 3: EXPLAIN WHY / WHY NOT Data Provenance */}
                  {activeResultTab === 'provenance' && (
                    <div className="flex flex-col gap-3">
                      <div className="text-xs text-neutral-300 pb-2 border-b border-neutral-800">
                        Detailed tuple-level explanation of why rows were admitted or filtered out:
                      </div>

                      <div className="flex flex-col gap-2 font-mono text-xs">
                        {activeResult.provenanceWhy && activeResult.provenanceWhy.length > 0 ? (
                          activeResult.provenanceWhy.map((reason, idx) => (
                            <div
                              key={idx}
                              className="p-2.5 rounded bg-neutral-950 border border-neutral-800 flex items-start gap-2.5"
                            >
                              <span className="text-neutral-500 text-[11px] shrink-0">#{idx + 1}</span>
                              <span
                                className={`text-[11px] leading-relaxed ${
                                  reason.startsWith('Included')
                                    ? 'text-emerald-300'
                                    : 'text-neutral-300'
                                }`}
                              >
                                {reason}
                              </span>
                            </div>
                          ))
                        ) : (
                          <div className="text-xs text-neutral-500 italic p-2">
                            All scanned rows satisfied visibility and predicate constraints.
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PlanTreeNode({ node, isRoot }: { node: QueryPlanNode; isRoot?: boolean }) {
  const isIndex = node.nodeType === 'IndexScan';
  return (
    <div className="flex flex-col gap-1 text-xs font-mono">
      <div className="flex items-center gap-2">
        {!isRoot && <CornerDownRight className="w-3.5 h-3.5 text-neutral-600 shrink-0" />}
        <span
          className={`font-semibold px-1.5 py-0.5 rounded text-[11px] ${
            isIndex
              ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/60'
              : node.nodeType === 'SeqScan'
              ? 'bg-amber-950 text-amber-300 border border-amber-800/60'
              : 'bg-neutral-800 text-neutral-200'
          }`}
        >
          {node.nodeType}
        </span>
        <span className="text-neutral-300 text-[11px]">{node.details}</span>
        <span className="text-neutral-400 text-[10px] tabular-nums">
          (Est Cost: {node.estimatedCost.toFixed(1)} · Actual: {node.actualRows ?? '?'} rows)
        </span>
      </div>
      {node.children && node.children.length > 0 && (
        <div className="pl-5 border-l border-neutral-800 ml-1.5 flex flex-col gap-1 mt-1">
          {node.children.map((child, i) => (
            <PlanTreeNode key={i} node={child} />
          ))}
        </div>
      )}
    </div>
  );
}
