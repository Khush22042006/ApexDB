/**
 * Database Architecture Deep Dive & Built-in Benchmark Studio
 *
 * Explains the 6 foundational database subsystems written from scratch
 * and provides an interactive Full Table Scan vs B+ Tree Index Scan benchmark.
 */

import { useState } from 'react';
import { Database } from '../engine/Database.ts';
import { Play, CheckCircle2, Zap, ArrowRight, Layers, FileCode, HardDrive, Cpu, ShieldAlert, GitBranch } from 'lucide-react';

interface ArchitectureViewProps {
  db: Database;
  onRefreshDb: () => void;
}

const MODULES = [
  {
    id: 'slotted-page',
    name: '1. Slotted-Page Binary Layout',
    icon: HardDrive,
    tagline: '4096-byte memory blocks with slot offsets and variable-length record packing',
    description: `Real databases cannot simply append records to a file because records have variable lengths and get deleted or updated. 
ApexDB implements a canonical slotted-page architecture inside a 4096-byte array:
- Page Header (32 bytes): stores pageId, slot count, free space bounds, and pageLSN.
- Slot Directory (bytes 32 upwards): stores 4-byte entries [offset (2B), length (2B)] per slot.
- Free Space Gap: resides in the middle between the slot directory and the records.
- Records (from 4096 downwards): serialized JSON/binary records grow downwards.
When a record is deleted, its slot length is zeroed (tombstone). When the page becomes fragmented, defragment() slides active records to the bottom, consolidating free space into a single contiguous gap.`,
    code: `// SlottedPage.ts - Record Insertion & Slot Allocation
public insertRecord(recordBytes: Uint8Array): number {
  const needed = recordBytes.length + 4; // 4-byte slot directory entry
  if (this.getFreeSpaceAvailable() < needed) return -1;

  // Records grow downwards from top of page (4096)
  const newUpper = this.getFreeSpaceUpper() - recordBytes.length;
  this.raw.set(recordBytes, newUpper);
  this.setFreeSpaceUpper(newUpper);

  // Allocate slot entry at freeSpaceLower
  const slotIndex = this.getSlotCount();
  const slotOffset = PAGE_HEADER_SIZE + slotIndex * 4;
  this.view.setUint16(slotOffset, newUpper, true);
  this.view.setUint16(slotOffset + 2, recordBytes.length, true);
  this.setSlotCount(slotIndex + 1);
  this.setFreeSpaceLower(slotOffset + 4);
  return slotIndex;
}`,
  },
  {
    id: 'buffer-pool',
    name: '2. Buffer Pool & Clock Sweep',
    icon: Cpu,
    tagline: 'In-memory frame cache with pinning and dirty-page WAL invariant enforcement',
    description: `Disk I/O is orders of magnitude slower than RAM. The Buffer Pool Manager maintains a fixed-capacity frame array (default 16 frames = 64KB cache).
- fetchPage(pageId): Checks the hash page table for cache hits. On miss, selects a victim frame using the Clock replacement algorithm.
- Pinning: Pages currently being read or modified have pinCount > 0 and cannot be evicted.
- Write-Ahead Invariant: Dirty frames can NEVER be flushed to disk until all WAL records up to frame.pageLsn are safely persisted to disk!`,
    code: `// BufferPool.ts - Clock Sweep Page Replacement Algorithm
private findVictimFrame(): number {
  let scans = 0;
  while (scans < this.poolSize * 2) {
    const frame = this.frames[this.clockHand];
    if (frame.pinCount === 0) {
      if (!frame.referenceBit) {
        const victim = this.clockHand;
        this.clockHand = (this.clockHand + 1) % this.poolSize;
        return victim; // unreferenced unpinned victim found
      } else {
        frame.referenceBit = false; // give second chance
      }
    }
    this.clockHand = (this.clockHand + 1) % this.poolSize;
    scans++;
  }
  return -1; // all frames pinned
}`,
  },
  {
    id: 'wal-aries',
    name: '3. Write-Ahead Logging & ARIES',
    icon: ShieldAlert,
    tagline: 'Durability via monotonic LSNs and 3-phase crash recovery',
    description: `Database crash durability relies on Write-Ahead Logging (WAL). Every state change appends a log record with a monotonically increasing Log Sequence Number (LSN) before the page in memory is modified.
When a crash occurs, ApexDB executes the canonical ARIES protocol:
1. Analysis: Scans the log forward from the last checkpoint to find active uncommitted 'loser' transactions.
2. Redo: Repeats history forward to reconstruct page state up to the moment of failure.
3. Undo: Scans backward rolling back active loser transactions to guarantee ACID Atomicity.`,
    code: `// WALManager.ts - ARIES Recovery Loop
public analyzeAndPlanRecovery() {
  // Phase 1: Analysis - identify losers
  for (let i = startIdx; i < allRecords.length; i++) {
    const rec = allRecords[i];
    if (rec.type === 'BEGIN') activeTxns.add(rec.txnId);
    if (rec.type === 'COMMIT') activeTxns.delete(rec.txnId);
    if (rec.type === 'ABORT') activeTxns.delete(rec.txnId);
  }
  // Phase 2: Redo - replay forward state
  // Phase 3: Undo - roll back uncommitted losers
}`,
  },
  {
    id: 'bplus-tree',
    name: '4. B+ Tree Index Engine',
    icon: GitBranch,
    tagline: 'Balanced multi-way search tree with leaf chaining for O(1) sequential scans',
    description: `Unlike standard binary trees or B-Trees where data is stored in all nodes, B+ Trees store data RecordIds exclusively in leaf nodes.
- Internal nodes only contain routing keys and child pointers.
- Leaf nodes are chained together with doubly-linked nextLeaf and prevLeaf pointers.
- Search takes O(log N). Range queries find the min leaf in O(log N) and then traverse leaves sequentially without ever re-visiting the root or internal levels!`,
    code: `// BPlusTree.ts - Leaf Node Splitting & Median Key Promotion
private splitLeaf(leaf: BPlusTreeNode): void {
  const mid = Math.ceil(leaf.keys.length / 2);
  const newLeaf = this.createNode(true);
  newLeaf.keys = leaf.keys.splice(mid);
  newLeaf.records = leaf.records.splice(mid);

  // Link sibling leaf pointers for O(K) range scans
  newLeaf.nextLeaf = leaf.nextLeaf;
  leaf.nextLeaf = newLeaf;

  const promotedKey = newLeaf.keys[0];
  this.insertIntoParent(leaf, promotedKey, newLeaf);
}`,
  },
  {
    id: 'lexer-parser',
    name: '5. Recursive Descent SQL Parser',
    icon: FileCode,
    tagline: 'Zero-dependency lexer and tokenizer with operator precedence climbing',
    description: `ApexDB does not use any external parser generator libraries (like Chevrotain, Peggy, or ANTLR). 
The engine includes a complete SQL Lexer that breaks characters into typed tokens (Keywords, Identifiers, Numbers, Operators, Strings), followed by a hand-crafted recursive descent parser that constructs typed AST nodes for SELECT, INSERT, UPDATE, DELETE, CREATE TABLE, and EXPLAIN statements.`,
    code: `// Parser.ts - Expression Precedence Climbing
public parseExpression(): Expression {
  return this.parseOr();
}
private parseOr(): Expression {
  let expr = this.parseAnd();
  while (this.matchKeyword('OR')) {
    expr = { type: 'Binary', operator: 'OR', left: expr, right: this.parseAnd() };
  }
  return expr;
}`,
  },
  {
    id: 'volcano-planner',
    name: '6. Volcano Iterator Engine',
    icon: Layers,
    tagline: 'Pipelined relational algebra operators: open() -> next() -> close()',
    description: `Queries are executed using the Volcano (Iterator) Model. Each relational operator (SeqScan, IndexScan, Filter, Project, Sort, Limit) implements:
- open(): Initializes cursor and child operators.
- next(): Pulls the next tuple on demand without materializing the entire table in memory!
- close(): Releases cursor resources.
The query planner automatically chooses an IndexScan whenever a WHERE clause references an indexed column with equality or range conditions!`,
    code: `// QueryEngine.ts - Volcano Model Iterator
export interface VolcanoExecutor {
  open(): void;
  next(): Row | null;
  close(): void;
  getPlanNode(): QueryPlanNode;
}`,
  },
];

export function ArchitectureView({ db, onRefreshDb }: ArchitectureViewProps) {
  const [selectedModuleId, setSelectedModuleId] = useState<string>(MODULES[0].id);

  // Benchmark state
  const [isRunningBench, setIsRunningBench] = useState<boolean>(false);
  const [benchResults, setBenchResults] = useState<{
    recordCount: number;
    seqScanTimeMs: number;
    seqScanPages: number;
    indexScanTimeMs: number;
    indexScanComparisons: number;
    speedup: string;
  } | null>(null);
  const [benchmarkError, setBenchmarkError] = useState<string | null>(null);

  const activeModule = MODULES.find((m) => m.id === selectedModuleId)!;

  const handleRunScanBenchmark = () => {
    setIsRunningBench(true);
    setBenchmarkError(null);
    setTimeout(() => {
      try {
        db.execute('DROP TABLE IF EXISTS bench_users;', { bypassApproval: true });
        const createResult = db.execute(`CREATE TABLE bench_users (
          id INTEGER PRIMARY KEY AUTO_INCREMENT,
          score INTEGER,
          tag TEXT
        );`)[0];
        if (!createResult?.success) throw new Error(createResult?.error || 'Benchmark setup failed');

        const values = Array.from({ length: 300 }, (_, index) => {
          const id = index + 1;
          return `(${id}, ${id * 3}, 'user_${id}')`;
        });
        const insertResult = db.execute(`INSERT INTO bench_users (id, score, tag) VALUES ${values.join(', ')};`)[0];
        if (!insertResult?.success) throw new Error(insertResult?.error || 'Benchmark insert failed');

        const indexResult = db.execute('CREATE INDEX idx_bench_score ON bench_users (score);')[0];
        if (!indexResult?.success) throw new Error(indexResult?.error || 'Benchmark index creation failed');
        db.checkpoint();

      // Run Full Table Scan on unindexed condition
      const t0 = performance.now();
      const resSeq = db.execute(`SELECT * FROM bench_users WHERE tag = 'user_250';`)[0];
      const seqTime = performance.now() - t0;

      // Run B+ Tree Index Scan on indexed score
      const t1 = performance.now();
      const resIdx = db.execute(`SELECT * FROM bench_users WHERE score = 750;`)[0];
      const idxTime = performance.now() - t1;

        if (!resSeq.success || !resIdx.success || resSeq.rows?.length !== 1 || resIdx.rows?.length !== 1) {
          throw new Error(resSeq.error || resIdx.error || 'Benchmark queries returned unexpected results');
        }

      const speedup = (seqTime / Math.max(0.01, idxTime)).toFixed(1);

        setBenchResults({
          recordCount: insertResult.affectedRows ?? 0,
          seqScanTimeMs: Math.round(seqTime * 100) / 100,
          seqScanPages: db.getTablePageCount('bench_users'),
          indexScanTimeMs: Math.round(idxTime * 100) / 100,
          indexScanComparisons: db.getIndex('bench_users', 'score')?.search(750).comparisons ?? 0,
          speedup: `${speedup}x`,
        });
      } catch (caught) {
        setBenchmarkError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setIsRunningBench(false);
        onRefreshDb();
      }
    }, 50);
  };

  return (
    <div className="flex flex-col gap-8 p-6 max-w-[1440px] mx-auto w-full">
      {/* Top Banner: Benchmark Hero Section */}
      <div className="border border-neutral-800 rounded bg-neutral-900/80 p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div>
          <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider block mb-1">
            Live Performance Benchmark
          </span>
          <h2 className="text-xl font-bold text-white">
            Sequential Table Scan vs B+ Tree Index Scan
          </h2>
          <p className="text-xs text-neutral-400 mt-1 max-w-2xl">
            Measures query latency, page reads, and search complexity comparing an unindexed full
            table scan (O(N)) against an indexed B+ Tree traversal (O(log N)).
          </p>
        </div>

        <button
          onClick={handleRunScanBenchmark}
          disabled={isRunningBench}
          className="cursor-pointer px-5 py-2.5 rounded bg-amber-400 hover:bg-amber-300 text-neutral-950 font-semibold text-xs transition-colors flex items-center gap-2 whitespace-nowrap shrink-0 font-sans"
        >
          <Play className="w-3.5 h-3.5 fill-current" />
          <span>{isRunningBench ? 'Benchmarking...' : 'Execute Live Benchmark'}</span>
        </button>
      </div>

      {benchmarkError && <div role="alert" className="mx-6 border border-rose-800 bg-rose-950/30 px-3 py-2 text-xs text-rose-300">{benchmarkError}</div>}

      {/* Benchmark Results Display */}
      {benchResults && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Card 1: SeqScan */}
          <div className="border border-neutral-800 rounded bg-neutral-950 p-4 flex flex-col gap-2">
            <div className="flex items-center justify-between pb-2 border-b border-neutral-800">
              <span className="text-xs font-semibold text-amber-400">Sequential Table Scan</span>
              <span className="text-[11px] font-mono text-neutral-500">O(N) Complexity</span>
            </div>
            <div className="text-2xl font-bold font-mono text-neutral-200 tabular-nums">
              {benchResults.seqScanTimeMs} ms
            </div>
            <div className="text-xs text-neutral-400 flex flex-col gap-1 mt-1 font-mono">
              <span>• Scanned all 300 rows across {benchResults.seqScanPages} slotted pages</span>
              <span>• Evaluated WHERE predicate on every individual record</span>
            </div>
          </div>

          {/* Card 2: B+ Tree Index Scan */}
          <div className="border border-emerald-800/70 rounded bg-emerald-950/20 p-4 flex flex-col gap-2">
            <div className="flex items-center justify-between pb-2 border-b border-emerald-800/40">
              <span className="text-xs font-semibold text-emerald-400">B+ Tree Index Scan</span>
              <span className="text-[11px] font-mono text-emerald-400">
                {benchResults.speedup} Faster
              </span>
            </div>
            <div className="text-2xl font-bold font-mono text-emerald-300 tabular-nums">
              {benchResults.indexScanTimeMs} ms
            </div>
            <div className="text-xs text-neutral-300 flex flex-col gap-1 mt-1 font-mono">
              <span>• Traversed root → internal router → target leaf in {benchResults.indexScanComparisons} comparisons</span>
              <span>• Fetched target record directly by RecordId (Page 1, Slot X)</span>
            </div>
          </div>
        </div>
      )}

      {/* Subsystem Architecture Navigation & Explanations */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Subsystem Navigation */}
        <div className="lg:col-span-4 flex flex-col gap-2">
          <span className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2">
            Core Subsystems
          </span>
          {MODULES.map((mod) => {
            const Icon = mod.icon;
            const isSelected = mod.id === selectedModuleId;
            return (
              <button
                key={mod.id}
                onClick={() => setSelectedModuleId(mod.id)}
                className={`cursor-pointer text-left p-3.5 rounded border transition-colors flex items-start gap-3 ${
                  isSelected
                    ? 'border-amber-400 bg-neutral-900/90 text-white'
                    : 'border-neutral-800 bg-neutral-900/40 text-neutral-300 hover:bg-neutral-900/70'
                }`}
              >
                <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${isSelected ? 'text-amber-400' : 'text-neutral-500'}`} />
                <div className="flex-1">
                  <div className="text-xs font-semibold">{mod.name}</div>
                  <div className="text-[11px] text-neutral-400 line-clamp-1 mt-0.5">{mod.tagline}</div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Right Active Subsystem Detail */}
        <div className="lg:col-span-8 border border-neutral-800 rounded bg-neutral-900/80 p-6 flex flex-col gap-4">
          <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
            <h3 className="text-base font-bold text-white">{activeModule.name}</h3>
            <span className="text-xs font-mono text-amber-300">ApexDB Architecture</span>
          </div>

          <div className="text-xs text-neutral-300 leading-relaxed whitespace-pre-line">
            {activeModule.description}
          </div>

          <div className="mt-2 flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-neutral-400">Implementation Highlight:</span>
            <pre className="p-4 rounded bg-neutral-950 border border-neutral-800 font-mono text-[11px] text-amber-200/90 overflow-x-auto leading-relaxed">
              {activeModule.code}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
