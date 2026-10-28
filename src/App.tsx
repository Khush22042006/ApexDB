/**
 * ApexDB Enterprise Engine App Root
 *
 * An autonomous, AI-agent-ready, relational database engine engineered from scratch.
 */

import { useState, useRef, useReducer, useEffect } from 'react';
import { Database } from './engine/Database.ts';
import { TopBar, ActiveTab } from './components/TopBar.tsx';
import { SqlConsoleView } from './components/SqlConsoleView.tsx';
import { AutonomousOptimizerView } from './components/AutonomousOptimizerView.tsx';
import { BranchingView } from './components/BranchingView.tsx';
import { VectorSearchView } from './components/VectorSearchView.tsx';
import { SlottedPageView } from './components/SlottedPageView.tsx';
import { AgentSafetyView } from './components/AgentSafetyView.tsx';
import { BenchmarkModal } from './components/BenchmarkModal.tsx';
import { ArchitectureView } from './components/ArchitectureView.tsx';
import { BPlusTreeVisualizer } from './components/BPlusTreeVisualizer.tsx';
import { WalRecoveryView } from './components/WalRecoveryView.tsx';
import { LoginView, AuthUser } from './components/LoginView.tsx';
import { apexApi } from './services/apexApi.ts';

type InternalView = 'storage' | 'architecture' | 'btree' | 'wal';

export default function App() {
  const dbRef = useRef<Database | null>(null);
  if (!dbRef.current) {
    dbRef.current = new Database(16);
    try {
      const snapshot = localStorage.getItem('apexdb.database.snapshot.v1');
      if (snapshot) dbRef.current.restoreState(JSON.parse(snapshot));
    } catch {
      localStorage.removeItem('apexdb.database.snapshot.v1');
    }
  }
  const db = dbRef.current;

  const [activeTab, setActiveTab] = useState<ActiveTab>('sql');
  const [internalView, setInternalView] = useState<InternalView>('storage');
  const [isBenchmarkOpen, setIsBenchmarkOpen] = useState<boolean>(false);
  const [, forceUpdate] = useReducer((x) => x + 1, 0);

  useEffect(() => {
    const save = () => {
      try {
        localStorage.setItem('apexdb.database.snapshot.v1', JSON.stringify(db.exportState()));
      } catch { /* no-op */ }
    };
    save();
    window.addEventListener('beforeunload', save);
    return () => window.removeEventListener('beforeunload', save);
  }, [db]);

  const pendingApprovalsCount = db.agentSandbox.getPendingList().length;
  const activeBranch = db.branchManager.activeBranch;

  const [apiStatus, setApiStatus] = useState<'checking' | 'healthy' | 'offline'>('checking');
  const [authUser, setAuthUser] = useState<AuthUser | null>(() => {
    try {
      const saved = sessionStorage.getItem('apexdb.auth.user');
      return saved ? JSON.parse(saved) as AuthUser : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const response = await fetch('/api/v1/health');
        if (active) setApiStatus(response.ok ? 'healthy' : 'offline');
      } catch {
        if (active) setApiStatus('offline');
      }
    };
    poll();
    const interval = window.setInterval(poll, 15000);
    return () => { active = false; window.clearInterval(interval); };
  }, []);

  useEffect(() => {
    const access = sessionStorage.getItem('apexdb.auth.access');
    const refresh = sessionStorage.getItem('apexdb.auth.refresh');
    if (access && refresh) apexApi.setSession(access, refresh);
  }, []);

  const handleLogin = async (username: string, password: string): Promise<AuthUser> => {
    const response = await fetch('/api/v1/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }), credentials: 'same-origin',
    });
    const body = await response.json().catch(() => ({ error: 'Authentication failed' }));
    if (!response.ok) throw new Error(body.error || 'Authentication failed');
    apexApi.setSession(body.accessToken, body.refreshToken);
    sessionStorage.setItem('apexdb.auth.access', body.accessToken);
    sessionStorage.setItem('apexdb.auth.refresh', body.refreshToken);
    sessionStorage.setItem('apexdb.auth.user', JSON.stringify(body.user));
    setAuthUser(body.user as AuthUser);
    return body.user as AuthUser;
  };

  const handleRegister = async (username: string, email: string, password: string): Promise<AuthUser> => {
    const response = await fetch('/api/v1/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password }), credentials: 'same-origin',
    });
    const body = await response.json().catch(() => ({ error: 'Registration failed' }));
    if (!response.ok) throw new Error(body.error || 'Registration failed');
    apexApi.setSession(body.accessToken, body.refreshToken);
    sessionStorage.setItem('apexdb.auth.access', body.accessToken);
    sessionStorage.setItem('apexdb.auth.refresh', body.refreshToken);
    setAuthUser(body.user as AuthUser);
    return body.user as AuthUser;
  };

  const handleLogout = async () => {
    try { await apexApi.logout(); } finally {
      apexApi.clearSession();
      sessionStorage.removeItem('apexdb.auth.user');
      sessionStorage.removeItem('apexdb.auth.access');
      sessionStorage.removeItem('apexdb.auth.refresh');
      sessionStorage.removeItem('apexdb.auth.debug');
      setAuthUser(null);
    }
  };

  const handleRefreshDb = () => {
    try {
      localStorage.setItem('apexdb.database.snapshot.v1', JSON.stringify(db.exportState()));
    } catch {
      // Storage quota or privacy mode should not break the in-memory application.
    }
    forceUpdate();
  };

  if (!authUser) {
    return <LoginView apiStatus={apiStatus} onLogin={handleLogin} onRegister={handleRegister} />;
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col font-sans selection:bg-neutral-800">
      {/* Strict 3-zone Top Navigation Bar */}
      <TopBar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onOpenBenchmark={() => setIsBenchmarkOpen(true)}
        pendingApprovalsCount={pendingApprovalsCount}
        activeBranch={activeBranch}
        onLogout={handleLogout}
        currentUser={{ username: authUser.username, role: authUser.role }}
      />

      {/* Main View Area */}
      <main className="flex-1 flex flex-col">
        {activeTab === 'sql' && (
          <SqlConsoleView db={db} onRefreshDb={handleRefreshDb} />
        )}
        {activeTab === 'autonomous' && (
          <AutonomousOptimizerView db={db} onRefreshDb={handleRefreshDb} />
        )}
        {activeTab === 'branching' && (
          <BranchingView db={db} onRefreshDb={handleRefreshDb} />
        )}
        {activeTab === 'vector' && (
          <VectorSearchView db={db} onRefreshDb={handleRefreshDb} />
        )}
        {activeTab === 'internals' && (
          <section className="flex flex-col">
            <nav aria-label="Database internals" className="flex flex-wrap gap-2 px-6 pt-5 max-w-[1440px] mx-auto w-full">
              {([
                ['storage', 'Storage & Integrity'],
                ['architecture', 'Architecture & Benchmark'],
                ['btree', 'B+ Tree Visualizer'],
                ['wal', 'WAL Recovery'],
              ] as const).map(([view, label]) => (
                <button
                  key={view}
                  type="button"
                  aria-pressed={internalView === view}
                  onClick={() => setInternalView(view)}
                  className={`cursor-pointer px-3 py-2 text-xs border-b-2 transition-colors ${
                    internalView === view
                      ? 'border-amber-400 text-white'
                      : 'border-transparent text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </nav>
            {internalView === 'storage' && <SlottedPageView db={db} onRefreshDb={handleRefreshDb} />}
            {internalView === 'architecture' && <ArchitectureView db={db} onRefreshDb={handleRefreshDb} />}
            {internalView === 'btree' && <BPlusTreeVisualizer db={db} onRefreshDb={handleRefreshDb} />}
            {internalView === 'wal' && <WalRecoveryView db={db} onRefreshDb={handleRefreshDb} />}
          </section>
        )}
        {activeTab === 'safety' && (
          <AgentSafetyView db={db} onRefreshDb={handleRefreshDb} />
        )}
      </main>

      {/* Minimal Footer adhering to anti-slop guidelines */}
      <footer className="border-t border-neutral-900 py-3.5 px-6 text-xs text-neutral-500 flex flex-wrap items-center justify-between gap-4 mt-auto">
        <div className="flex items-center gap-2">
          <span>ApexDB Enterprise</span>
          <span aria-hidden="true">·</span>
          <span>MVCC Snapshot Isolation</span>
          <span aria-hidden="true">·</span>
          <span>Zero-Copy CoW Branching</span>
          <span aria-hidden="true">·</span>
          <span>Autonomous Shadow Indexing</span>
          <span aria-hidden="true">·</span>
          <span>Vector & Hybrid Retrieval</span>
          <span aria-hidden="true">·</span>
          <span>AI Agent Guardrails</span>
        </div>
        <div className="text-[11px] font-mono text-neutral-600 flex items-center gap-2">
          <span aria-label={`Persisted API ${apiStatus}`} className={`inline-block h-2 w-2 rounded-full ${apiStatus === 'healthy' ? 'bg-emerald-500' : apiStatus === 'offline' ? 'bg-red-500' : 'bg-neutral-600'}`} />
          <span>API: {apiStatus}</span>
          <span>· Branch: {activeBranch} · Apache-2.0</span>
        </div>
      </footer>

      {/* Benchmark Modal */}
      <BenchmarkModal
        db={db}
        isOpen={isBenchmarkOpen}
        onClose={() => setIsBenchmarkOpen(false)}
        onRefreshDb={handleRefreshDb}
      />
    </div>
  );
}
