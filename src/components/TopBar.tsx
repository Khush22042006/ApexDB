/**
 * TopBar Component
 * Adheres strictly to the 3-zone contract:
 * [Zone 1: Single text brand wordmark] - [Zone 2: Single-line nav links] - [Zone 3: 1 primary action]
 */

export type ActiveTab = 'sql' | 'autonomous' | 'branching' | 'vector' | 'internals' | 'safety';

interface TopBarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  onOpenBenchmark: () => void;
  onLogout: () => void;
  pendingApprovalsCount?: number;
  activeBranch?: string;
  currentUser?: { username: string; role: string };
}

export function TopBar({
  activeTab,
  onSelectTab,
  onOpenBenchmark,
  onLogout,
  pendingApprovalsCount = 0,
  activeBranch = 'main',
  currentUser = { username: '', role: '' },
}: TopBarProps) {
  return (
    <header className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 lg:gap-8 px-4 lg:px-6 py-3 border-b border-neutral-800 bg-neutral-900/90 backdrop-blur-md sticky top-0 z-50">
      <div className="flex w-full lg:w-auto items-center justify-between gap-3">
        {/* Zone 1: Brand Wordmark */}
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-base font-semibold tracking-tight text-white whitespace-nowrap">
            ApexDB Enterprise
          </span>
          <span className="text-xs font-mono text-amber-300 border border-neutral-700/80 rounded px-1.5 py-0.5">
            branch:{activeBranch}
          </span>
        </div>

        {/* Zone 3: User and Primary Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onOpenBenchmark}
            className="cursor-pointer px-3.5 py-1.5 text-xs font-medium text-neutral-950 bg-amber-400 hover:bg-amber-300 rounded transition-colors whitespace-nowrap font-sans"
          >
            Workload Benchmark
          </button>
          <div className="hidden xl:flex items-center gap-2 border-l border-neutral-700 pl-2 ml-1">
            <div className="text-right leading-tight">
              <div className="text-xs text-neutral-200">{currentUser.username}</div>
              <div className="text-[10px] text-neutral-500 uppercase tracking-wide">{currentUser.role}</div>
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="cursor-pointer px-2 py-1.5 text-xs text-neutral-400 border border-neutral-700 rounded hover:text-white hover:border-neutral-500 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>

      {/* Zone 2: Single-line Navigation Links */}
      <nav className="hidden lg:flex items-center gap-5 text-xs font-medium">
        <button
          onClick={() => onSelectTab('sql')}
          className={`cursor-pointer whitespace-nowrap shrink-0 transition-colors py-1 ${
            activeTab === 'sql'
              ? 'text-white border-b-2 border-amber-400 font-semibold'
              : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          SQL Studio & X-Ray
        </button>
        <button
          onClick={() => onSelectTab('autonomous')}
          className={`cursor-pointer whitespace-nowrap shrink-0 transition-colors py-1 ${
            activeTab === 'autonomous'
              ? 'text-white border-b-2 border-amber-400 font-semibold'
              : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          Autonomous Optimizer
        </button>
        <button
          onClick={() => onSelectTab('branching')}
          className={`cursor-pointer whitespace-nowrap shrink-0 transition-colors py-1 ${
            activeTab === 'branching'
              ? 'text-white border-b-2 border-amber-400 font-semibold'
              : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          Branching & Time-Travel
        </button>
        <button
          onClick={() => onSelectTab('vector')}
          className={`cursor-pointer whitespace-nowrap shrink-0 transition-colors py-1 ${
            activeTab === 'vector'
              ? 'text-white border-b-2 border-amber-400 font-semibold'
              : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          Vector & Hybrid Search
        </button>
        <button
          onClick={() => onSelectTab('internals')}
          className={`cursor-pointer whitespace-nowrap shrink-0 transition-colors py-1 ${
            activeTab === 'internals'
              ? 'text-white border-b-2 border-amber-400 font-semibold'
              : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          Storage & Chaos Lab
        </button>
        <button
          onClick={() => onSelectTab('safety')}
          className={`cursor-pointer whitespace-nowrap shrink-0 transition-colors py-1 flex items-center gap-1.5 ${
            activeTab === 'safety'
              ? 'text-white border-b-2 border-amber-400 font-semibold'
              : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          <span>Agent Safety</span>
          {pendingApprovalsCount > 0 && (
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-rose-500 text-white font-bold">
              {pendingApprovalsCount}
            </span>
          )}
        </button>
      </nav>

      <label className="lg:hidden w-full">
        <span className="sr-only">Navigate to view</span>
        <select
          aria-label="Navigate to view"
          value={activeTab}
          onChange={(event) => onSelectTab(event.target.value as ActiveTab)}
          className="w-full bg-neutral-950 border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-100"
        >
          <option value="sql">SQL Studio &amp; X-Ray</option>
          <option value="autonomous">Autonomous Optimizer</option>
          <option value="branching">Branching &amp; Time-Travel</option>
          <option value="vector">Vector &amp; Hybrid Search</option>
          <option value="internals">Storage &amp; Chaos Lab</option>
          <option value="safety">Agent Safety</option>
        </select>
      </label>

      <button
        onClick={onLogout}
        className="hidden lg:block text-sm font-medium text-neutral-950 bg-amber-400 hover:bg-amber-300 rounded transition-colors"
      >
        Logout
      </button>
    </header>
  );
}
