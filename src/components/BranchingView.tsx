/**
 * Git-like Database Branching, Diff/Merge & Time-Travel Studio
 *
 * Implements:
 * 1. Zero-copy Copy-on-Write (CoW) database branches
 * 2. Visual Branch Diff (Added, Modified, Deleted records)
 * 3. Three-way branch merge with conflict detection
 * 4. Time-Travel Query Timeline with AS OF SYSTEM TIME scrubber & point-in-time restore
 */

import { useState } from 'react';
import { Database } from '../engine/Database.ts';
import { GitBranch, GitMerge, Clock, Plus, ArrowRight, RotateCcw, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Row } from '../engine/types.ts';

interface BranchingViewProps {
  db: Database;
  onRefreshDb: () => void;
}

export function BranchingView({ db, onRefreshDb }: BranchingViewProps) {
  const branchManager = db.branchManager;
  const branches = branchManager.getAllBranches();
  const activeBranch = branchManager.getActiveBranch();

  const [newBranchName, setNewBranchName] = useState<string>('');
  const [newBranchDesc, setNewBranchDesc] = useState<string>('');
  const [diffBase, setDiffBase] = useState<string>('main');
  const [mergeMessage, setMergeMessage] = useState<string | null>(null);

  // Time-Travel state
  const [timeTravelClock, setTimeTravelClock] = useState<number>(1005);
  const [timeTravelRows, setTimeTravelRows] = useState<Row[]>([]);
  const [isTimeTraveling, setIsTimeTraveling] = useState<boolean>(false);

  const diffs = branchManager.diff(diffBase, activeBranch.name);

  const handleCreateBranch = () => {
    if (!newBranchName.trim()) return;
    db.createBranch(newBranchName, activeBranch.name, newBranchDesc);
    branchManager.switchBranch(newBranchName);
    setNewBranchName('');
    setNewBranchDesc('');
    setMergeMessage(null);
    onRefreshDb();
  };

  const handleSwitchBranch = (name: string) => {
    branchManager.switchBranch(name);
    setMergeMessage(null);
    onRefreshDb();
  };

  const handleMergeBranch = () => {
    const res = db.mergeBranch(activeBranch.name, 'main');

    if (res.success) {
      setMergeMessage(`Merged ${res.appliedChanges} changes from '${activeBranch.name}' into 'main' cleanly!`);
    } else {
      setMergeMessage(`Merge had ${res.conflicts.length} conflict(s).`);
    }
    onRefreshDb();
  };

  const handleRunTimeTravel = () => {
    setIsTimeTraveling(true);
    const res = db.execute(`SELECT * FROM users;`, { asOfTimestamp: timeTravelClock })[0];
    setTimeTravelRows(res.rows || []);
  };

  return (
    <div className="flex flex-col gap-6 p-6 max-w-[1440px] mx-auto w-full">
      {/* Top Banner */}
      <div className="border border-neutral-800 rounded bg-neutral-900/70 p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-amber-400" />
            <h2 className="text-base font-bold text-white">
              Git-like Database Branching & Time-Travel
            </h2>
          </div>
          <p className="text-xs text-neutral-400 mt-1 max-w-2xl">
            Instantaneous copy-on-write database branches for sandbox testing, schema experiments,
            and agent safety, alongside point-in-time historical time-travel queries.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-neutral-400">Active Branch:</span>
          <span className="px-2.5 py-1 rounded bg-amber-400 text-neutral-950 font-mono font-bold text-xs">
            {activeBranch.name}
          </span>
        </div>
      </div>

      {/* Grid: Branch Management & Diffs vs Time-Travel Scrubber */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Branch Switcher & Diff/Merge (7 cols) */}
        <div className="lg:col-span-7 flex flex-col gap-5">
          {/* Branch List & Switcher */}
          <div className="border border-neutral-800 rounded bg-neutral-900/80 p-4">
            <div className="flex items-center justify-between pb-3 border-b border-neutral-800 mb-3">
              <h3 className="text-sm font-semibold text-neutral-200">Database Branches</h3>
              <span className="text-xs font-mono text-neutral-400">{branches.length} Branches</span>
            </div>

            <div className="flex flex-wrap gap-2 mb-4">
              {branches.map((b) => (
                <button
                  key={b.name}
                  onClick={() => handleSwitchBranch(b.name)}
                  className={`cursor-pointer px-3 py-1.5 rounded text-xs font-mono transition-colors flex items-center gap-1.5 ${
                    activeBranch.name === b.name
                      ? 'bg-amber-400 text-neutral-950 font-semibold'
                      : 'bg-neutral-950 text-neutral-300 hover:bg-neutral-800 border border-neutral-800'
                  }`}
                >
                  <GitBranch className="w-3 h-3" />
                  <span>{b.name}</span>
                </button>
              ))}
            </div>

            {/* Create Branch Box */}
            <div className="p-3 rounded bg-neutral-950 border border-neutral-800/80 flex flex-col gap-2">
              <span className="text-xs font-semibold text-neutral-300">Create Zero-Copy Branch:</span>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  placeholder="e.g. agent-sandbox-01"
                  className="w-48 bg-neutral-900 border border-neutral-800 rounded px-2.5 py-1 text-xs font-mono text-neutral-100 focus:outline-none"
                />
                <input
                  type="text"
                  value={newBranchDesc}
                  onChange={(e) => setNewBranchDesc(e.target.value)}
                  placeholder="Branch purpose description"
                  className="flex-1 bg-neutral-900 border border-neutral-800 rounded px-2.5 py-1 text-xs text-neutral-100 focus:outline-none"
                />
                <button
                  onClick={handleCreateBranch}
                  className="cursor-pointer text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-200 px-3 py-1 rounded transition-colors flex items-center gap-1 font-sans"
                >
                  <Plus className="w-3 h-3" />
                  <span>Create</span>
                </button>
              </div>
            </div>
          </div>

          {/* Branch Diff & Merge Box */}
          <div className="border border-neutral-800 rounded bg-neutral-900/80 p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
              <div className="flex items-center gap-2">
                <GitMerge className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-semibold text-neutral-200">
                  Branch Diff ({activeBranch.name} ↔ {diffBase})
                </h3>
              </div>
              {activeBranch.name !== 'main' && diffs.length > 0 && (
                <button
                  onClick={handleMergeBranch}
                  className="cursor-pointer text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-medium px-3 py-1 rounded transition-colors flex items-center gap-1.5 font-sans"
                >
                  <span>Merge into main</span>
                </button>
              )}
            </div>

            {mergeMessage && (
              <div className="p-2.5 rounded bg-emerald-950/40 border border-emerald-800/80 text-xs font-mono text-emerald-300">
                {mergeMessage}
              </div>
            )}

            {diffs.length === 0 ? (
              <div className="py-6 text-center text-xs text-neutral-500 italic">
                Branch '{activeBranch.name}' has no uncommitted diffs relative to '{diffBase}'.
              </div>
            ) : (
              <div className="overflow-x-auto border border-neutral-800 rounded">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-neutral-800 bg-neutral-950 font-mono text-[11px] text-neutral-400">
                      <th className="px-3 py-2">Action</th>
                      <th className="px-3 py-2">Table</th>
                      <th className="px-3 py-2">Primary Key</th>
                      <th className="px-3 py-2">Row Values</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-800/60 font-mono text-neutral-300 text-xs">
                    {diffs.map((d, i) => (
                      <tr key={i} className="hover:bg-neutral-850">
                        <td className="px-3 py-2">
                          <span
                            className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                              d.action === 'ADDED'
                                ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                                : d.action === 'MODIFIED'
                                ? 'bg-amber-950 text-amber-300 border border-amber-800'
                                : 'bg-rose-950 text-rose-300 border border-rose-800'
                            }`}
                          >
                            {d.action}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-amber-300">{d.tableName}</td>
                        <td className="px-3 py-2 font-medium">{String(d.primaryKey)}</td>
                        <td className="px-3 py-2 max-w-[260px] truncate text-[11px] text-neutral-400">
                          {d.targetRow ? JSON.stringify(d.targetRow) : 'DELETED'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Time-Travel Queries (5 cols) */}
        <div className="lg:col-span-5 flex flex-col gap-5">
          <div className="border border-neutral-800 rounded bg-neutral-900/80 p-4 flex flex-col gap-4">
            <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-sky-400" />
                <h3 className="text-sm font-semibold text-neutral-200">
                  Time-Travel Query Studio (MVCC)
                </h3>
              </div>
              <span className="text-xs font-mono text-neutral-400">Point-in-Time</span>
            </div>

            <p className="text-xs text-neutral-400 leading-relaxed">
              Scrub backwards along the database logical timeline to view table state exactly as it
              existed at any historical commit epoch using Multi-Version Concurrency Control.
            </p>

            {/* Time Slider */}
            <div className="p-3 rounded bg-neutral-950 border border-neutral-800 flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-neutral-400">Logical Clock Epoch:</span>
                <span className="text-amber-400 font-bold tabular-nums">#{timeTravelClock}</span>
              </div>

              <input
                type="range"
                min={1000}
                max={1020}
                step={1}
                value={timeTravelClock}
                onChange={(e) => setTimeTravelClock(parseInt(e.target.value, 10))}
                className="w-full accent-amber-400 cursor-pointer"
              />

              <div className="flex justify-between text-[10px] font-mono text-neutral-500 pt-1">
                <span>1000 (Database Genesis)</span>
                <span>1020 (Head)</span>
              </div>
            </div>

            <button
              onClick={handleRunTimeTravel}
              className="cursor-pointer text-xs bg-sky-600 hover:bg-sky-500 text-white font-medium px-4 py-2 rounded transition-colors flex items-center justify-center gap-2 font-sans"
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Query 'users' AS OF SYSTEM TIME #{timeTravelClock}</span>
            </button>

            {/* Time Travel Query Results */}
            {isTimeTraveling && (
              <div className="mt-2 flex flex-col gap-2">
                <span className="text-xs font-semibold text-neutral-300">
                  Historical Snapshot ({timeTravelRows.length} Rows Visible):
                </span>
                <div className="max-h-64 overflow-y-auto border border-neutral-800 rounded">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-neutral-800 bg-neutral-950 font-mono text-[11px] text-neutral-400">
                        <th className="px-3 py-1.5">ID</th>
                        <th className="px-3 py-1.5">Username</th>
                        <th className="px-3 py-1.5">Age</th>
                        <th className="px-3 py-1.5">Dept</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-800/60 font-mono text-neutral-300 text-xs">
                      {timeTravelRows.map((r, i) => (
                        <tr key={i} className="hover:bg-neutral-850">
                          <td className="px-3 py-1.5 font-medium">{String(r.id)}</td>
                          <td className="px-3 py-1.5 text-neutral-200">{String(r.username)}</td>
                          <td className="px-3 py-1.5 tabular-nums text-emerald-400">{String(r.age)}</td>
                          <td className="px-3 py-1.5 text-neutral-400">{String(r.department)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
