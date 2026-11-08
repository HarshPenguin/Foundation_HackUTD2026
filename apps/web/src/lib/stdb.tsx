import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { SpacetimeDBProvider, useSpacetimeDB, useTable } from 'spacetimedb/react';
import { DbConnection, tables } from '@/module_bindings';
import type {
  Activity,
  Budget,
  ChatMessage,
  Employee,
  FallbackChain,
  Notification,
  Project,
  Provider,
  Report,
  Review,
  Run,
  Settings,
  SpendEvent,
  Task,
} from '@/module_bindings/types';

export const STDB_URI: string = import.meta.env.VITE_STDB_URI || 'ws://127.0.0.1:3000';
export const STDB_DB: string = import.meta.env.VITE_STDB_DB || 'foundation';
const TOKEN_KEY = `foundation.stdb.token.${STDB_DB}`;

function readToken(): string | undefined {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}
function writeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: the identity just won't persist */
  }
}

const connectionBuilder = DbConnection.builder()
  .withUri(STDB_URI)
  .withDatabaseName(STDB_DB)
  .withToken(readToken())
  .onConnect((conn, _identity, token) => {
    writeToken(token);
    void conn; // Ownership is claimed with the owner passcode (Settings), not on connect.
  })
  .onConnectError((_ctx, err) => {
    // A token minted by another server is rejected; start fresh next attempt.
    if (/token|unauthor|401/i.test(String(err?.message ?? ''))) writeToken(null);
  });

export function StdbProvider({ children }: { children: ReactNode }) {
  return <SpacetimeDBProvider connectionBuilder={connectionBuilder}>{children}</SpacetimeDBProvider>;
}

export interface Db {
  ready: boolean;
  settings?: Settings;
  budget?: Budget;
  project?: Project;
  employees: readonly Employee[];
  providers: readonly Provider[];
  chains: readonly FallbackChain[];
  spendEvents: readonly SpendEvent[];
  runs: readonly Run[];
  tasks: readonly Task[];
  activity: readonly Activity[];
  notifications: readonly Notification[];
  chat: readonly ChatMessage[];
  reports: readonly Report[];
  reviews: readonly Review[];
}

const DbContext = createContext<Db | null>(null);

const byId = <T extends { id: bigint }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function DbProvider({ children }: { children: ReactNode }) {
  const [settings, r1] = useTable(tables.settings);
  const [project, r2] = useTable(tables.project);
  const [employees, r3] = useTable(tables.employee);
  const [providers, r4] = useTable(tables.provider);
  const [chains, r5] = useTable(tables.fallbackChain);
  const [budget, r6] = useTable(tables.budget);
  const [spendEvents, r7] = useTable(tables.spendEvent);
  const [runs, r8] = useTable(tables.run);
  const [tasks, r9] = useTable(tables.task);
  const [activity, r10] = useTable(tables.activity);
  const [notifications, r11] = useTable(tables.notification);
  const [chat, r12] = useTable(tables.chatMessage);
  const [reports, r13] = useTable(tables.report);
  const [reviews, r14] = useTable(tables.review);
  const ready = r1 && r2 && r3 && r4 && r5 && r6 && r7 && r8 && r9 && r10 && r11 && r12 && r13 && r14;

  const value = useMemo<Db>(
    () => ({
      ready,
      settings: settings[0],
      budget: budget[0],
      project: project[0],
      employees: [...employees].sort(byId),
      providers: [...providers].sort(byId),
      chains,
      spendEvents: [...spendEvents].sort(byId),
      runs: [...runs].sort(byId),
      tasks: [...tasks].sort(byId),
      activity: [...activity].sort(byId),
      notifications: [...notifications].sort(byId),
      chat: [...chat].sort(byId),
      reports: [...reports].sort(byId),
      reviews: [...reviews].sort(byId),
    }),
    [ready, settings, budget, project, employees, providers, chains, spendEvents, runs, tasks, activity, notifications, chat, reports, reviews]
  );
  return <DbContext.Provider value={value}>{children}</DbContext.Provider>;
}

export function useDb(): Db {
  const v = useContext(DbContext);
  if (!v) throw new Error('useDb outside DbProvider');
  return v;
}

export function useConn(): DbConnection | null {
  const state = useSpacetimeDB();
  return (state.getConnection() as DbConnection | null) ?? null;
}

export { useSpacetimeDB };
