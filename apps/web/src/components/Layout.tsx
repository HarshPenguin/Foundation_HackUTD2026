import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import * as Popover from '@radix-ui/react-popover';
import {
  Bell,
  Code,
  Home,
  Mail,
  Menu,
  Settings as SettingsIcon,
  ShieldAlert,
  Wallet,
  ArrowLeftRight,
  X,
  Info,
  CircleAlert,
} from 'lucide-react';
import { useDb } from '@/lib/stdb';
import { isSwitchNotice, openNotifications } from '@/lib/domain';
import { useProviderActions } from '@/lib/providerActions';
import { ago, tsDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import type { Notification } from '@/module_bindings/types';

const NAV = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/finances', label: 'My Finances', icon: Wallet },
  { to: '/developers', label: 'My Developers', icon: Code },
  { to: '/communications', label: 'My Communications', icon: Mail },
];

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2.5 px-2">
      <svg viewBox="0 0 32 32" className="size-8" aria-hidden>
        <rect width="32" height="32" rx="8" fill="#14213a" />
        <path d="M8 22h16M10 18h12M12 14h8M14 10h4" stroke="#f5a524" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
      <div className="leading-tight">
        <div className="text-[15px] font-semibold tracking-tight text-ink">Foundation</div>
        <div className="text-[11px] text-muted">Your software crew</div>
      </div>
    </Link>
  );
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const db = useDb();
  return (
    <div className="flex h-full flex-col">
      <div className="py-5">
        <Logo />
      </div>
      {db.project && (
        <div className="mx-2 mb-4 rounded-xl border border-line bg-white px-3 py-2.5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted">Project</div>
          <div className="flex items-center justify-between gap-2">
            <div className="truncate text-sm font-semibold text-ink">{db.project.name}</div>
            <span
              className={cn(
                'rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums',
                db.project.healthScore >= 70 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
              )}
              title="Health score"
            >
              {db.project.healthScore}/100
            </span>
          </div>
        </div>
      )}
      <nav className="flex flex-col gap-1 px-2">
        {NAV.map(n => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors [&_svg]:size-[18px]',
                isActive ? 'bg-navy-800 text-white shadow-sm' : 'text-navy-700 hover:bg-navy-50'
              )
            }
          >
            <n.icon />
            {n.label}
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto px-2 pb-4">
        <NavLink
          to="/settings"
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors [&_svg]:size-[18px]',
              isActive ? 'bg-navy-800 text-white' : 'text-navy-700 hover:bg-navy-50'
            )
          }
        >
          <SettingsIcon />
          Settings
        </NavLink>
        <div className="mt-3 flex items-center gap-2.5 rounded-xl px-3 py-2">
          <div className="flex size-8 items-center justify-center rounded-full bg-amber-100 text-sm font-semibold text-amber-700">
            {(db.settings?.ownerName ?? 'Y').charAt(0)}
          </div>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-sm font-medium text-ink">{db.settings?.ownerName ?? 'You'}</div>
            <div className="text-[11px] text-muted">Owner</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function WorkerPill() {
  const db = useDb();
  const online = db.settings?.workerOnline ?? false;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
        online ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-line bg-white text-muted'
      )}
      title={online ? 'The worker is connected and picking up tasks' : `The worker is not connected${db.settings?.workerLastSeenAt ? `. Last seen ${ago(tsDate(db.settings.workerLastSeenAt))}` : ''}`}
    >
      <span className={cn('size-1.5 rounded-full', online ? 'bg-emerald-500 animate-pulse' : 'bg-navy-300')} />
      {online ? 'Crew online' : 'Crew offline'}
    </span>
  );
}

function NoticeIcon({ n }: { n: Notification }) {
  if (n.kind === 'budget_halt') return <ShieldAlert className="size-4 text-red-600" />;
  if (isSwitchNotice(n)) return <ArrowLeftRight className="size-4 text-amber-600" />;
  if (n.kind === 'needs_input') return <CircleAlert className="size-4 text-amber-600" />;
  return <Info className="size-4 text-navy-500" />;
}

export function NoticeActions({ n, compact }: { n: Notification; compact?: boolean }) {
  const { switchAway, upgrade, dismiss } = useProviderActions();
  const [busy, setBusy] = useState(false);
  const wrap = (f: () => Promise<unknown>) => async () => {
    setBusy(true);
    try {
      await f();
    } finally {
      setBusy(false);
    }
  };
  if (isSwitchNotice(n) && n.providerId != null) {
    const pid = n.providerId;
    return (
      <div className="flex flex-wrap gap-2">
        <Button size={compact ? 'xs' : 'sm'} variant="outline" disabled={busy} onClick={wrap(() => switchAway(pid))}>
          Switch
        </Button>
        <Button size={compact ? 'xs' : 'sm'} variant="accent" disabled={busy} onClick={wrap(() => upgrade(pid))}>
          Upgrade
        </Button>
      </div>
    );
  }
  if (n.kind === 'budget_halt') {
    return (
      <Button size={compact ? 'xs' : 'sm'} asChild>
        <Link to="/finances?tab=limits">Review limits</Link>
      </Button>
    );
  }
  return (
    <Button size={compact ? 'xs' : 'sm'} variant="ghost" disabled={busy} onClick={wrap(() => dismiss(n.id))}>
      Mark as read
    </Button>
  );
}

function NotificationBell() {
  const db = useDb();
  const open = openNotifications(db);
  const urgent = open.some(n => n.kind === 'budget_halt' || n.kind === 'switch_or_upgrade');
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          className="relative inline-flex size-9 items-center justify-center rounded-lg border border-line bg-white text-navy-700 hover:bg-navy-50"
          aria-label={`Notifications (${open.length})`}
        >
          <Bell className="size-[18px]" />
          {open.length > 0 && (
            <span
              className={cn(
                'absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold',
                urgent ? 'bg-amber-400 text-navy-950' : 'bg-navy-800 text-white'
              )}
            >
              {open.length}
            </span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={8} className="z-50 w-[min(94vw,400px)] rounded-2xl border border-line bg-white shadow-xl focus:outline-none">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="text-sm font-semibold text-ink">Notifications</div>
            <div className="text-xs text-muted">{open.length ? `${open.length} open` : 'All caught up'}</div>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {open.length === 0 && <div className="px-4 py-8 text-center text-sm text-muted">Nothing needs your attention.</div>}
            {open.map(n => (
              <div
                key={n.id.toString()}
                className={cn('border-b border-line px-4 py-3 last:border-0', n.kind === 'budget_halt' && 'bg-red-50/60')}
              >
                <div className="flex items-start gap-2.5">
                  <div className="mt-0.5">
                    <NoticeIcon n={n} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-ink">{n.title}</div>
                    <div className="mt-0.5 text-[13px] leading-snug text-muted">{n.body}</div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <NoticeActions n={n} compact />
                      <span className="text-[11px] text-muted">{ago(tsDate(n.createdAt))}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Banners() {
  const db = useDb();
  const open = openNotifications(db);
  const halt = open.find(n => n.kind === 'budget_halt');
  const sw = open.find(n => isSwitchNotice(n));
  const [hidden, setHidden] = useState<string | null>(null);
  if (!halt && !sw) return null;
  return (
    <div className="mb-5 flex flex-col gap-2">
      {halt && (
        <div className="animate-fade-up flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 sm:flex-row sm:items-center">
          <ShieldAlert className="size-5 shrink-0 text-red-600" />
          <div className="flex-1">
            <div className="text-sm font-semibold text-red-800">{halt.title}</div>
            <div className="text-[13px] text-red-800/80">{halt.body}</div>
          </div>
          <NoticeActions n={halt} />
        </div>
      )}
      {sw && hidden !== sw.id.toString() && (
        <div className="animate-fade-up flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 sm:flex-row sm:items-center">
          <ArrowLeftRight className="size-5 shrink-0 text-amber-600" />
          <div className="flex-1">
            <div className="text-sm font-semibold text-amber-900">
              Switch or upgrade <span className="font-normal text-amber-800">· {sw.title}</span>
            </div>
            <div className="text-[13px] text-amber-900/80">{sw.body}</div>
          </div>
          <div className="flex items-center gap-1">
            <NoticeActions n={sw} />
            <button className="ml-1 rounded-md p-1 text-amber-700 hover:bg-amber-100" aria-label="Hide" onClick={() => setHidden(sw.id.toString())}>
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const title = NAV.find(n => (n.end ? location.pathname === n.to : location.pathname.startsWith(n.to)))?.label ?? (location.pathname.startsWith('/settings') ? 'Settings' : '');
  return (
    <div className="flex min-h-full">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-line bg-canvas lg:block">
        <SidebarNav />
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-navy-950/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-canvas shadow-xl">
            <SidebarNav onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-canvas/85 px-4 backdrop-blur sm:px-6">
          <button className="rounded-lg p-1.5 text-navy-700 hover:bg-navy-50 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <div className="text-sm font-medium text-muted lg:hidden">{title}</div>
          <div className="ml-auto flex items-center gap-2.5">
            <WorkerPill />
            <NotificationBell />
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <Banners />
          <Outlet />
        </main>
      </div>
    </div>
  );
}
