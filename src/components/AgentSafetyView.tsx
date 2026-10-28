/**
 * AI Agent Sandbox & Dangerous Query Approval Studio
 *
 * Implements:
 * 1. Query Risk Classifier (CRITICAL, HIGH, MEDIUM, LOW)
 * 2. Human Operator Approval Queue for dangerous agent mutations
 * 3. Interactive simulation of catastrophic queries (DROP, unconstrained DELETE)
 */

import { useState } from 'react';
import { Database } from '../engine/Database.ts';
import { ShieldAlert, CheckCircle, XCircle, Play, AlertTriangle, Lock } from 'lucide-react';

interface AgentSafetyViewProps {
  db: Database;
  onRefreshDb: () => void;
}

export function AgentSafetyView({ db, onRefreshDb }: AgentSafetyViewProps) {
  const sandbox = db.agentSandbox;
  const pendingApprovals = sandbox.getPendingList();
  const allApprovals = sandbox.getAllApprovals();

  const [testSql, setTestSql] = useState<string>('DROP TABLE users;');
  const [lastActionMessage, setLastActionMessage] = useState<string | null>(null);

  const handleSimulateDangerousAgent = (sql: string) => {
    setLastActionMessage(null);
    db.execute(sql, { isAgentQuery: true });
    onRefreshDb();
  };

  const handleApprove = (id: string) => {
    const action = sandbox.approve(id);
    if (action) {
      const previousBranch = db.branchManager.activeBranch;
      try {
        db.branchManager.switchBranch(action.branch);
        const results = db.execute(action.sql, { bypassApproval: true });
        const failure = results.find((result) => !result.success);
        setLastActionMessage(failure
          ? `Ticket #${id} was approved but execution failed: ${failure.error || 'Unknown error'}`
          : `Approved & executed Ticket #${id} on '${action.branch}'.`);
      } catch (caught) {
        setLastActionMessage(`Ticket #${id} was approved but execution failed: ${caught instanceof Error ? caught.message : String(caught)}`);
      } finally {
        db.branchManager.switchBranch(previousBranch);
      }
      onRefreshDb();
    }
  };

  const handleReject = (id: string) => {
    sandbox.reject(id);
    setLastActionMessage(`Rejected Ticket #${id}. Operation was blocked.`);
    onRefreshDb();
  };

  return (
    <div className="flex flex-col gap-6 p-6 max-w-[1440px] mx-auto w-full">
      {/* Top Banner */}
      <div className="border border-neutral-800 rounded bg-neutral-900/70 p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-rose-400" />
            <h2 className="text-base font-bold text-white">
              AI Agent Safety Guardrails & Human Approval Queue
            </h2>
          </div>
          <p className="text-xs text-neutral-400 mt-1 max-w-2xl">
            Protects the database against catastrophic agent hallucination or reckless scripts by
            intercepting unconstrained deletions, drops, and mass mutations.
          </p>
        </div>

        <div className="flex items-center gap-3 text-xs font-mono">
          <span className="text-neutral-400">Pending Approvals:</span>
          <span className="px-2.5 py-1 rounded bg-rose-950 text-rose-300 border border-rose-800 font-bold tabular-nums">
            {pendingApprovals.length} Action(s)
          </span>
        </div>
      </div>

      {/* Simulator Banner: Try Triggering Guardrails */}
      <div className="border border-neutral-800 rounded bg-neutral-900/80 p-4 flex flex-col gap-3">
        <h3 className="text-xs font-semibold text-neutral-200">
          Simulate Autonomous Agent Submitting Dangerous Query:
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleSimulateDangerousAgent('DROP TABLE users;')}
            className="cursor-pointer text-xs bg-rose-950/40 hover:bg-rose-900/50 text-rose-300 border border-rose-800/80 px-3 py-1.5 rounded transition-colors"
          >
            Agent tries: DROP TABLE users;
          </button>
          <button
            onClick={() => handleSimulateDangerousAgent('DELETE FROM users;')}
            className="cursor-pointer text-xs bg-rose-950/40 hover:bg-rose-900/50 text-rose-300 border border-rose-800/80 px-3 py-1.5 rounded transition-colors"
          >
            Agent tries: DELETE FROM users (No WHERE);
          </button>
          <button
            onClick={() => handleSimulateDangerousAgent("UPDATE users SET department = 'Wiped';")}
            className="cursor-pointer text-xs bg-amber-950/40 hover:bg-amber-900/50 text-amber-300 border border-amber-800/80 px-3 py-1.5 rounded transition-colors"
          >
            Agent tries: UPDATE users (Mass Overwrite);
          </button>
        </div>

        {lastActionMessage && (
          <div className="p-2.5 rounded bg-neutral-950 border border-neutral-800 text-xs font-mono text-emerald-400">
            {lastActionMessage}
          </div>
        )}
      </div>

      {/* Pending Approvals Table */}
      <div className="border border-neutral-800 rounded bg-neutral-900/80 p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
          <h3 className="text-sm font-semibold text-neutral-200">
            Pending Approval Queue ({pendingApprovals.length})
          </h3>
          <span className="text-xs font-mono text-neutral-400">Requires Human Authorization</span>
        </div>

        {pendingApprovals.length === 0 ? (
          <div className="py-8 text-center text-xs text-neutral-500 italic">
            Approval queue is clean. No dangerous operations pending review.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {pendingApprovals.map((item) => (
              <div
                key={item.id}
                className="p-4 rounded border border-rose-900/60 bg-neutral-950 flex flex-col gap-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-rose-400 font-bold uppercase px-1.5 py-0.2 rounded bg-rose-950 border border-rose-800">
                      {item.risk.level} RISK
                    </span>
                    <span className="font-mono text-xs text-neutral-300 font-semibold">
                      Ticket #{item.id}
                    </span>
                    <span className="text-xs text-neutral-500">·</span>
                    <span className="text-xs font-mono text-amber-300">Agent: {item.agentId}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleReject(item.id)}
                      className="cursor-pointer text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-300 px-3 py-1.5 rounded flex items-center gap-1 transition-colors"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>Reject</span>
                    </button>
                    <button
                      onClick={() => handleApprove(item.id)}
                      className="cursor-pointer text-xs bg-rose-600 hover:bg-rose-500 text-white font-medium px-3.5 py-1.5 rounded flex items-center gap-1.5 transition-colors"
                    >
                      <CheckCircle className="w-3.5 h-3.5" />
                      <span>Authorize Execution</span>
                    </button>
                  </div>
                </div>

                <pre className="p-2.5 rounded bg-neutral-900 border border-neutral-800 font-mono text-xs text-amber-200">
                  {item.sql}
                </pre>

                <div className="text-xs text-neutral-300 flex flex-col gap-1">
                  {item.risk.reasons.map((r, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-neutral-400 text-[11px]">
                      <AlertTriangle className="w-3 h-3 text-rose-400 shrink-0" />
                      <span>{r}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Historical Audit Trail */}
      <div className="border border-neutral-800 rounded bg-neutral-900/80 p-4">
        <h3 className="text-sm font-semibold text-neutral-200 pb-2 border-b border-neutral-800 mb-3">
          Security Audit Trail ({allApprovals.length} Actions)
        </h3>
        <div className="overflow-x-auto border border-neutral-800 rounded">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-neutral-800 bg-neutral-950 font-mono text-[11px] text-neutral-400">
                <th className="px-3 py-2">Ticket</th>
                <th className="px-3 py-2">Risk</th>
                <th className="px-3 py-2">SQL</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800/60 font-mono text-neutral-300 text-xs">
              {allApprovals.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-4 text-center text-neutral-500 italic">
                    No security tickets recorded.
                  </td>
                </tr>
              ) : (
                allApprovals.map((a) => (
                  <tr key={a.id} className="hover:bg-neutral-850">
                    <td className="px-3 py-2 text-neutral-400">{a.id}</td>
                    <td className="px-3 py-2">
                      <span className="text-[10px] text-rose-400 font-bold">{a.risk.level}</span>
                    </td>
                    <td className="px-3 py-2 max-w-[280px] truncate text-neutral-200">{a.sql}</td>
                    <td className="px-3 py-2 font-bold">
                      <span
                        className={
                          a.status === 'APPROVED'
                            ? 'text-emerald-400'
                            : a.status === 'REJECTED'
                            ? 'text-rose-400'
                            : 'text-amber-400'
                        }
                      >
                        {a.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
