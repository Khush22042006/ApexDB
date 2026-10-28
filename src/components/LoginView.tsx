import { FormEvent, useState } from 'react';
import { Database, Eye, EyeOff, LockKeyhole, ShieldCheck, UserPlus, LogIn } from 'lucide-react';

export interface AuthUser {
  id: number;
  username: string;
  email: string;
  role: 'admin' | 'editor' | 'viewer';
}

interface LoginViewProps {
  apiStatus: 'checking' | 'healthy' | 'offline';
  onLogin: (username: string, password: string) => Promise<AuthUser>;
  onRegister: (username: string, email: string, password: string) => Promise<AuthUser>;
}

export function LoginView({ apiStatus, onLogin, onRegister }: LoginViewProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (mode === 'login' && (!username.trim() || !password)) {
      setError('Enter your username and password.');
      return;
    }
    if (mode === 'register' && (username.length < 3 || password.length < 12 || !email.includes('@'))) {
      setError('Use a valid email, username (3+ characters), and password (12+ characters).');
      return;
    }
    setSubmitting(true);
    try {
      if (mode === 'login') await onLogin(username.trim(), password);
      else await onRegister(username.trim(), email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center p-4 sm:p-8 font-sans">
      <div className="w-full max-w-5xl grid lg:grid-cols-[1.08fr_.92fr] border border-neutral-800 rounded-2xl overflow-hidden bg-neutral-900 shadow-2xl shadow-black/40">
        <section className="hidden lg:flex min-h-[620px] flex-col justify-between p-10 border-r border-neutral-800 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,.14),transparent_38%),linear-gradient(145deg,#171717,#0a0a0a)]">
          <div>
            <div className="flex items-center gap-3 mb-16">
              <div className="w-10 h-10 rounded-lg border border-amber-400/30 bg-amber-400/10 flex items-center justify-center text-amber-300">
                <Database size={20} />
              </div>
              <div>
                <div className="font-semibold tracking-tight">ApexDB Enterprise</div>
                <div className="text-[10px] uppercase tracking-[.22em] text-neutral-500 mt-1">Database systems lab</div>
              </div>
            </div>
            <div className="max-w-md">
              <p className="text-xs font-mono uppercase tracking-[.18em] text-amber-400 mb-4">Secure workspace</p>
              <h1 className="text-4xl font-semibold leading-tight tracking-tight">Design, query, and observe.</h1>
              <p className="mt-5 text-sm leading-6 text-neutral-400">
                Explore SQL execution, MVCC, WAL recovery, indexing, branching, and vector search in one focused workspace.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[['WAL', 'Recovery'], ['MVCC', 'Isolation'], ['B+', 'Tree index']].map(([title, caption]) => (
              <div key={title} className="rounded-lg border border-neutral-800 bg-neutral-950/50 px-3 py-3">
                <div className="text-sm font-semibold text-neutral-200">{title}</div>
                <div className="text-[11px] text-neutral-500 mt-1">{caption}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="min-h-[620px] flex items-center justify-center p-6 sm:p-10">
          <div className="w-full max-w-sm">
            <div className="flex items-center gap-2 text-xs mb-8 lg:hidden">
              <div className="w-8 h-8 rounded-lg border border-amber-400/30 bg-amber-400/10 flex items-center justify-center text-amber-300">
                <Database size={16} />
              </div>
              <span className="font-semibold">ApexDB Enterprise</span>
            </div>

            <div className="mb-7">
              <p className="text-xs font-mono uppercase tracking-[.16em] text-neutral-500 mb-2">
                {mode === 'login' ? 'Access workspace' : 'Create workspace account'}
              </p>
              <h2 className="text-2xl font-semibold tracking-tight">{mode === 'login' ? 'Sign in' : 'Register'}</h2>
            </div>

            <form onSubmit={submit} className="space-y-4" noValidate>
              <label className="block">
                <span className="block text-xs font-medium text-neutral-300 mb-2">Username</span>
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  maxLength={32}
                  className="w-full h-11 rounded-lg border border-neutral-700 bg-neutral-950 px-3.5 text-sm outline-none transition focus:border-amber-400/70 focus:ring-2 focus:ring-amber-400/10"
                  placeholder="Enter username"
                />
              </label>

              {mode === 'register' && (
                <label className="block">
                  <span className="block text-xs font-medium text-neutral-300 mb-2">Email</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="email"
                    maxLength={254}
                    className="w-full h-11 rounded-lg border border-neutral-700 bg-neutral-950 px-3.5 text-sm outline-none transition focus:border-amber-400/70 focus:ring-2 focus:ring-amber-400/10"
                    placeholder="name@example.com"
                  />
                </label>
              )}

              <label className="block">
                <span className="block text-xs font-medium text-neutral-300 mb-2">Password</span>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    maxLength={128}
                    className="w-full h-11 rounded-lg border border-neutral-700 bg-neutral-950 px-3.5 pr-11 text-sm outline-none transition focus:border-amber-400/70 focus:ring-2 focus:ring-amber-400/10"
                    placeholder={mode === 'login' ? 'Enter password' : '12 characters minimum'}
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-neutral-500 hover:text-neutral-200"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </label>

              {error && (
                <div role="alert" className="rounded-lg border border-red-900/70 bg-red-950/40 px-3 py-2.5 text-xs text-red-200">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting || apiStatus === 'offline'}
                className="w-full h-11 rounded-lg bg-amber-400 text-neutral-950 text-sm font-semibold hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50 transition flex items-center justify-center gap-2"
              >
                {mode === 'login' ? <LogIn size={16} /> : <UserPlus size={16} />}
                {submitting ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
              </button>
            </form>

            <div className="mt-5 flex items-center justify-center gap-2 text-xs text-neutral-500">
              <span>{mode === 'login' ? 'New to ApexDB?' : 'Already registered?'}</span>
              <button
                type="button"
                onClick={() => { setMode((value) => value === 'login' ? 'register' : 'login'); setError(''); }}
                className="text-neutral-200 hover:text-amber-300 font-medium"
              >
                {mode === 'login' ? 'Create an account' : 'Sign in'}
              </button>
            </div>

            <div className="mt-7 pt-5 border-t border-neutral-800 flex items-center justify-between text-[11px] text-neutral-500">
              <div className="flex items-center gap-1.5"><LockKeyhole size={12} /> Secure API session</div>
              <div className="flex items-center gap-1.5">
                <ShieldCheck size={12} />
                <span className={apiStatus === 'healthy' ? 'text-emerald-400' : apiStatus === 'offline' ? 'text-red-400' : 'text-neutral-400'}>
                  {apiStatus === 'healthy' ? 'API connected' : apiStatus === 'offline' ? 'API offline' : 'Checking API'}
                </span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
