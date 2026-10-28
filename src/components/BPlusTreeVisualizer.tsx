/**
 * Interactive B+ Tree Visualizer
 *
 * Renders the hierarchical B+ Tree index with:
 * - Internal routing nodes & child pointers
 * - Leaf data nodes with RecordIds (Page ID & Slot Index)
 * - Doubly-linked leaf pointers (nextLeaf / prevLeaf) for range queries
 * - Step-by-step search and range query path highlighting
 */

import { useState, useMemo } from 'react';
import { Database } from '../engine/Database.ts';
import { BPlusTree, BPlusKey, BPlusNodeVisual } from '../engine/index/BPlusTree.ts';
import { Search, Plus, Trash2, ArrowRight, CornerDownRight, Zap } from 'lucide-react';

interface BPlusTreeVisualizerProps {
  db: Database;
  onRefreshDb: () => void;
}

export function BPlusTreeVisualizer({ db, onRefreshDb }: BPlusTreeVisualizerProps) {
  const indexes = db.getAllIndexes();

  // Selected index or sandbox
  const [selectedIndexKey, setSelectedIndexKey] = useState<string>(
    'sandbox'
  );

  // Local sandbox tree if user wants to play around freely
  const [sandboxTree] = useState<BPlusTree>(() => {
    const t = new BPlusTree(4);
    // Seed sample keys
    const keys = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    keys.forEach((k, idx) => t.insert(k, { pageId: 1, slotIndex: idx }));
    return t;
  });

  const [inputKey, setInputKey] = useState<string>('35');
  const [searchKey, setSearchKey] = useState<string>('34');
  const [rangeMin, setRangeMin] = useState<string>('28');
  const [rangeMax, setRangeMax] = useState<string>('42');

  const [searchFeedback, setSearchFeedback] = useState<{
    found: boolean;
    pathNodeIds: Set<string>;
    comparisons: number;
    message: string;
  } | null>(null);

  const [rangeFeedback, setRangeFeedback] = useState<{
    matchedKeys: BPlusKey[];
    leavesVisited: number;
    comparisons: number;
  } | null>(null);

  const [selectedNode, setSelectedNode] = useState<BPlusNodeVisual | null>(null);

  // Active tree reference
  const currentTree: BPlusTree = useMemo(() => {
    if (selectedIndexKey === 'sandbox') return sandboxTree;
    const [tbl, col] = selectedIndexKey.split('.');
    return db.getIndex(tbl, col) || sandboxTree;
  }, [selectedIndexKey, db, sandboxTree]);
  const isSandbox = selectedIndexKey === 'sandbox';

  // Export visual tree structure
  const visualTree = useMemo(() => {
    return currentTree.exportVisualTree();
  }, [currentTree, db]);

  const handleInsertKey = () => {
    if (!isSandbox) return;
    const num = parseFloat(inputKey);
    const key: BPlusKey = isNaN(num) ? inputKey.trim() : num;
    if (key === '' || key === undefined) return;

    currentTree.insert(key, { pageId: 1, slotIndex: Math.floor(Math.random() * 10) });
    setSearchFeedback(null);
    setRangeFeedback(null);
    onRefreshDb();
  };

  const handleDeleteKey = () => {
    if (!isSandbox) return;
    const num = parseFloat(inputKey);
    const key: BPlusKey = isNaN(num) ? inputKey.trim() : num;
    currentTree.delete(key);
    setSearchFeedback(null);
    setRangeFeedback(null);
    onRefreshDb();
  };

  const handleInsertBatch = () => {
    if (!isSandbox) return;
    const randomBatch = Array.from({ length: 8 }, () => Math.floor(Math.random() * 90) + 10);
    for (const k of randomBatch) {
      currentTree.insert(k, { pageId: 1, slotIndex: Math.floor(Math.random() * 10) });
    }
    setSearchFeedback(null);
    setRangeFeedback(null);
    onRefreshDb();
  };

  const handleSearchKey = () => {
    const num = parseFloat(searchKey);
    const key: BPlusKey = isNaN(num) ? searchKey.trim() : num;
    const res = currentTree.search(key);

    const pathIds = new Set(res.path.map((p) => p.nodeId));
    setSearchFeedback({
      found: res.found,
      pathNodeIds: pathIds,
      comparisons: res.comparisons,
      message: res.found
        ? `Found key '${key}' at leaf slot with ${res.comparisons} key comparisons!`
        : `Key '${key}' not found after ${res.comparisons} comparisons.`,
    });
    setRangeFeedback(null);
  };

  const handleRangeScan = () => {
    const minNum = parseFloat(rangeMin);
    const maxNum = parseFloat(rangeMax);
    const minVal = isNaN(minNum) ? (rangeMin.trim() || null) : minNum;
    const maxVal = isNaN(maxNum) ? (rangeMax.trim() || null) : maxNum;

    const res = currentTree.rangeSearch(minVal, maxVal);
    setRangeFeedback({
      matchedKeys: res.results.map((r) => r.key),
      leavesVisited: res.leavesVisited,
      comparisons: res.comparisons,
    });
    setSearchFeedback(null);
  };

  return (
    <div className="flex flex-col gap-6 p-6 max-w-[1440px] mx-auto w-full">
      {/* Top Controls Ribbon */}
      <div className="border border-neutral-800 rounded bg-neutral-900/70 p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4 flex-wrap">
          {/* Index Selector */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-neutral-300">Target Index:</span>
            <select
              value={selectedIndexKey}
              onChange={(e) => {
                setSelectedIndexKey(e.target.value);
                setSearchFeedback(null);
                setRangeFeedback(null);
                setSelectedNode(null);
              }}
              className="bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1 text-xs font-mono text-amber-300 focus:outline-none"
            >
              {indexes.map((idx) => (
                <option key={`${idx.tableName}.${idx.columnName}`} value={`${idx.tableName}.${idx.columnName}`}>
                  {idx.tableName}.{idx.columnName} (Index)
                </option>
              ))}
              <option value="sandbox">Sandbox Playground Tree</option>
            </select>
          </div>

          {/* Tree Order */}
          <div className="flex items-center gap-2 pl-4 border-l border-neutral-800">
            <span className="text-xs font-medium text-neutral-300">Order M:</span>
            <span className="text-xs font-mono text-neutral-200 tabular-nums">{currentTree.order}</span>
            <span className="text-[11px] text-neutral-400">(max {currentTree.order - 1} keys/node)</span>
          </div>
        </div>

        {/* Tree Height and Summary */}
        <div className="flex items-center gap-4 text-xs font-mono text-neutral-400">
          <span>
            Height: <strong className="text-neutral-200">{currentTree.getHeight()}</strong>
          </span>
          <span>
            Total Keys: <strong className="text-neutral-200">{currentTree.getAllEntries().length}</strong>
          </span>
        </div>
      </div>

      {/* Interactive Actions Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Box 1: Insert / Delete */}
        <div className="border border-neutral-800 rounded bg-neutral-900/60 p-3.5 flex flex-col gap-2.5">
          <span className="text-xs font-semibold text-neutral-200">Key Modification</span>
          {!isSandbox && <span className="text-[11px] text-neutral-400">Live database indexes are read-only here.</span>}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={inputKey}
              onChange={(e) => setInputKey(e.target.value)}
              placeholder="Key value"
              className="w-24 bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1 text-xs font-mono text-neutral-100 focus:outline-none"
            />
            <button
              onClick={handleInsertKey}
              disabled={!isSandbox}
              className="cursor-pointer text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-200 px-2.5 py-1 rounded flex items-center gap-1 transition-colors font-sans"
            >
              <Plus className="w-3 h-3" />
              <span>Insert</span>
            </button>
            <button
              onClick={handleDeleteKey}
              disabled={!isSandbox}
              aria-label="Delete key"
              title={isSandbox ? 'Delete key from sandbox tree' : 'Live database indexes are read-only'}
              className="cursor-pointer text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-300 px-2 py-1 rounded flex items-center gap-1 transition-colors font-sans"
            >
              <Trash2 className="w-3 h-3" />
            </button>
            <button
              onClick={handleInsertBatch}
              disabled={!isSandbox}
              className="cursor-pointer text-[11px] text-amber-300 hover:text-amber-200 ml-auto underline"
            >
              +8 Random
            </button>
          </div>
        </div>

        {/* Box 2: Point Search */}
        <div className="border border-neutral-800 rounded bg-neutral-900/60 p-3.5 flex flex-col gap-2.5">
          <span className="text-xs font-semibold text-neutral-200">Point Search (O(log N))</span>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={searchKey}
              onChange={(e) => setSearchKey(e.target.value)}
              placeholder="Search key"
              className="w-24 bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1 text-xs font-mono text-neutral-100 focus:outline-none"
            />
            <button
              onClick={handleSearchKey}
              className="cursor-pointer text-xs bg-amber-400 hover:bg-amber-300 text-neutral-950 font-medium px-3 py-1 rounded flex items-center gap-1 transition-colors font-sans"
            >
              <Search className="w-3 h-3" />
              <span>Trace Path</span>
            </button>
          </div>
        </div>

        {/* Box 3: Range Scan */}
        <div className="border border-neutral-800 rounded bg-neutral-900/60 p-3.5 flex flex-col gap-2.5">
          <span className="text-xs font-semibold text-neutral-200">Leaf-Chained Range Scan</span>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={rangeMin}
              onChange={(e) => setRangeMin(e.target.value)}
              placeholder="Min"
              className="w-16 bg-neutral-950 border border-neutral-800 rounded px-2 py-1 text-xs font-mono text-neutral-100 focus:outline-none"
            />
            <span className="text-neutral-500 text-xs">to</span>
            <input
              type="text"
              value={rangeMax}
              onChange={(e) => setRangeMax(e.target.value)}
              placeholder="Max"
              className="w-16 bg-neutral-950 border border-neutral-800 rounded px-2 py-1 text-xs font-mono text-neutral-100 focus:outline-none"
            />
            <button
              onClick={handleRangeScan}
              className="cursor-pointer text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-medium px-2.5 py-1 rounded flex items-center gap-1 transition-colors font-sans"
            >
              <Zap className="w-3 h-3" />
              <span>Scan</span>
            </button>
          </div>
        </div>
      </div>

      {/* Search / Range Feedback Banner */}
      {searchFeedback && (
        <div
          className={`p-3 rounded border text-xs font-mono flex items-center justify-between ${
            searchFeedback.found
              ? 'bg-emerald-950/40 border-emerald-800/80 text-emerald-300'
              : 'bg-neutral-900 border-neutral-800 text-neutral-300'
          }`}
        >
          <span>{searchFeedback.message}</span>
          <span className="text-neutral-400 text-[11px]">
            Path highlighted in yellow outline below
          </span>
        </div>
      )}

      {rangeFeedback && (
        <div className="p-3 rounded border border-emerald-800/80 bg-emerald-950/40 text-xs font-mono text-emerald-300 flex items-center justify-between">
          <span>
            Range Scan matched {rangeFeedback.matchedKeys.length} keys: [
            {rangeFeedback.matchedKeys.join(', ')}]
          </span>
          <span className="text-neutral-300 text-[11px]">
            Leaves traversed: {rangeFeedback.leavesVisited} · Comparisons: {rangeFeedback.comparisons}
          </span>
        </div>
      )}

      {/* Visual B+ Tree Canvas */}
      <div className="border border-neutral-800 rounded bg-neutral-950 p-6 overflow-x-auto min-h-[380px] flex flex-col justify-start">
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-neutral-800/80 text-xs text-neutral-400">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-neutral-800 border border-neutral-700"></span>
              <span>Internal Router Node</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-amber-950/60 border border-amber-600/60"></span>
              <span>Leaf Record Node</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm border-2 border-yellow-400"></span>
              <span>Active Search Path</span>
            </span>
          </div>
          <span className="text-[11px] text-neutral-500">Click any node to inspect internal records & pointers</span>
        </div>

        {/* Tree Rendering Hierarchy */}
        <div className="flex flex-col items-center gap-8 py-2 min-w-[700px]">
          <RenderVisualNode
            node={visualTree}
            searchPathIds={searchFeedback?.pathNodeIds}
            onSelectNode={setSelectedNode}
            selectedNodeId={selectedNode?.id}
          />
        </div>
      </div>

      {/* Node Inspector Drawer */}
      {selectedNode && (
        <div className="border border-neutral-800 rounded bg-neutral-900/80 p-4">
          <div className="flex items-center justify-between pb-2 border-b border-neutral-800">
            <h4 className="text-xs font-semibold text-neutral-200">
              Node Details: <span className="font-mono text-amber-300">{selectedNode.id}</span>
            </h4>
            <span className="text-xs font-mono text-neutral-400">
              Type: {selectedNode.isLeaf ? 'Leaf Node' : 'Internal Router Node'} · Depth: {selectedNode.depth}
            </span>
          </div>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
            <div>
              <span className="text-neutral-400 block mb-1">Stored Keys:</span>
              <div className="flex flex-wrap gap-1">
                {selectedNode.keys.map((k, i) => (
                  <span
                    key={i}
                    className="px-2 py-0.5 rounded bg-neutral-950 border border-neutral-800 text-neutral-200"
                  >
                    {String(k)}
                  </span>
                ))}
              </div>
            </div>

            {selectedNode.isLeaf && selectedNode.records && (
              <div>
                <span className="text-neutral-400 block mb-1">Record IDs (pageId:slotIndex):</span>
                <div className="flex flex-wrap gap-1">
                  {selectedNode.records.map((rid, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 rounded bg-amber-950/40 border border-amber-800/60 text-amber-300"
                    >
                      P{rid.pageId}:S{rid.slotIndex}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {selectedNode.isLeaf && (
              <div className="md:col-span-2 pt-2 border-t border-neutral-800/60 flex items-center gap-4 text-neutral-400">
                <span>Prev Leaf: {selectedNode.prevLeafId ? selectedNode.prevLeafId : 'null'}</span>
                <span>Next Leaf: {selectedNode.nextLeafId ? selectedNode.nextLeafId : 'null'}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function RenderVisualNode({
  node,
  searchPathIds,
  onSelectNode,
  selectedNodeId,
}: {
  node: BPlusNodeVisual;
  searchPathIds?: Set<string>;
  onSelectNode: (n: BPlusNodeVisual) => void;
  selectedNodeId?: string;
}) {
  const isHighlighted = searchPathIds?.has(node.id);
  const isSelected = selectedNodeId === node.id;

  return (
    <div className="flex flex-col items-center">
      {/* Node Box */}
      <button
        onClick={() => onSelectNode(node)}
        className={`cursor-pointer px-3 py-1.5 rounded transition-all flex flex-col items-center gap-1 ${
          node.isLeaf
            ? 'bg-amber-950/40 border border-amber-700/50 hover:border-amber-500'
            : 'bg-neutral-900 border border-neutral-700 hover:border-neutral-500'
        } ${isHighlighted ? 'ring-2 ring-yellow-400 shadow-lg shadow-yellow-900/30' : ''} ${
          isSelected ? 'border-white ring-1 ring-white' : ''
        }`}
      >
        <div className="flex items-center gap-1 text-[10px] font-mono text-neutral-400">
          <span>{node.id}</span>
          <span>·</span>
          <span>{node.isLeaf ? 'Leaf' : 'Internal'}</span>
        </div>

        {/* Keys */}
        <div className="flex items-center gap-1">
          {node.keys.length > 0 ? (
            node.keys.map((k, idx) => (
              <span
                key={idx}
                className={`font-mono text-xs px-1.5 py-0.5 rounded ${
                  node.isLeaf
                    ? 'bg-amber-900/40 text-amber-200 border border-amber-800/50'
                    : 'bg-neutral-800 text-neutral-200'
                }`}
              >
                {String(k)}
              </span>
            ))
          ) : (
            <span className="text-[11px] text-neutral-500 italic">empty</span>
          )}
        </div>
      </button>

      {/* Children connector lines */}
      {node.children && node.children.length > 0 && (
        <div className="flex flex-col items-center w-full mt-2">
          {/* Vertical stem */}
          <div className="w-px h-4 bg-neutral-700"></div>

          {/* Children horizontal distribution */}
          <div className="flex items-start justify-center gap-6 pt-2 border-t border-neutral-700 w-full">
            {node.children.map((child) => (
              <div key={child.id} className="flex flex-col items-center">
                <RenderVisualNode
                  node={child}
                  searchPathIds={searchPathIds}
                  onSelectNode={onSelectNode}
                  selectedNodeId={selectedNodeId}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
