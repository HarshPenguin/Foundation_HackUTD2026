import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Loader2, PlugZap } from 'lucide-react';
import './index.css';
import { DbProvider, StdbProvider, STDB_DB, STDB_URI, useDb, useSpacetimeDB } from '@/lib/stdb';
import { ToastProvider } from '@/lib/actions';
import { Layout } from '@/components/Layout';
import HomePage from '@/pages/Home';
import FinancesPage from '@/pages/Finances';
import DevelopersPage from '@/pages/Developers';
import CommunicationsPage from '@/pages/Communications';
import SettingsPage from '@/pages/Settings';
import OnboardingPage from '@/pages/Onboarding';

function Splash({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-canvas px-6">
      <div className="w-full max-w-md text-center">
        <svg viewBox="0 0 32 32" className="mx-auto mb-5 size-12" aria-hidden>
          <rect width="32" height="32" rx="8" fill="#14213a" />
          <path d="M8 22h16M10 18h12M12 14h8M14 10h4" stroke="#f5a524" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
        {children}
      </div>
    </div>
  );
}

function ConnectionGate() {
  const state = useSpacetimeDB();
  const db = useDb();
  if (state.connectionError && !state.isActive) {
    return (
      <Splash>
        <div className="rounded-2xl border border-line bg-white p-6 text-left shadow-sm">
          <div className="flex items-center gap-2 text-ink">
            <PlugZap className="size-5 text-amber-600" />
            <div className="font-semibold">Can't reach your crew's database</div>
          </div>
          <p className="mt-2 text-sm text-muted">
            Foundation couldn't connect to SpacetimeDB at <code className="rounded bg-navy-50 px-1 font-mono text-[12px] text-ink">{STDB_URI}</code>{' '}
            (database <code className="rounded bg-navy-50 px-1 font-mono text-[12px] text-ink">{STDB_DB}</code>). It will keep retrying.
          </p>
          <p className="mt-2 text-xs text-muted">{state.connectionError.message}</p>
          <p className="mt-3 text-xs text-muted">Check that the server is running, or set VITE_STDB_URI and VITE_STDB_DB.</p>
        </div>
      </Splash>
    );
  }
  if (!state.isActive || !db.ready || !db.settings) {
    return (
      <Splash>
        <div className="flex items-center justify-center gap-2 text-sm text-muted">
          <Loader2 className="size-4 animate-spin" />
          {state.isActive ? 'Loading your crew' : 'Connecting to your crew'}
        </div>
      </Splash>
    );
  }
  return (
    <Routes>
      <Route path="onboarding" element={<OnboardingPage />} />
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="finances" element={<FinancesPage />} />
        <Route path="developers" element={<DevelopersPage />} />
        <Route path="communications" element={<CommunicationsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StdbProvider>
      <DbProvider>
        <ToastProvider>
          <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <ConnectionGate />
          </BrowserRouter>
        </ToastProvider>
      </DbProvider>
    </StdbProvider>
  </StrictMode>
);
