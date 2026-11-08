import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertTriangle, X } from 'lucide-react';
import { useConn } from './stdb';
import type { DbConnection } from '@/module_bindings';
import { cn } from './utils';

type Toast = { id: number; tone: 'ok' | 'error'; text: string };
const ToastContext = createContext<{ push: (tone: Toast['tone'], text: string) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast['tone'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t.slice(-3), { id, tone, text }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), tone === 'error' ? 6000 : 3200);
  }, []);
  const value = useMemo(() => ({ push }), [push]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(92vw,380px)] flex-col gap-2">
        {toasts.map(t => (
          <div
            key={t.id}
            className={cn(
              'pointer-events-auto animate-fade-up flex items-start gap-2 rounded-xl border bg-white px-4 py-3 text-sm shadow-lg',
              t.tone === 'error' ? 'border-amber-300' : 'border-navy-100'
            )}
          >
            {t.tone === 'error' ? (
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
            ) : (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-navy-600" />
            )}
            <span className="flex-1 text-ink">{t.text}</span>
            <button className="text-muted hover:text-ink" onClick={() => setToasts(x => x.filter(y => y.id !== t.id))} aria-label="Dismiss">
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const v = useContext(ToastContext);
  if (!v) throw new Error('useToast outside ToastProvider');
  return v.push;
}

type Reducers = DbConnection['reducers'];

function cleanError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const clean = msg.replace(/^(SenderError|Error):\s*/i, '');
  if (/owner or (worker|admin) only/i.test(clean)) return "Only the owner's browser can do that. In this demo, the first browser to connect is the owner";
  return clean || 'Something went wrong';
}

/**
 * Calls a reducer and reports the outcome as a toast. Returns true on success.
 * Usage: const call = useCall(); await call(r => r.startRun({ trigger: 'manual' }), 'Run started');
 */
export function useCall() {
  const conn = useConn();
  const toast = useToast();
  return useCallback(
    async (fn: (r: Reducers) => Promise<void>, success?: string): Promise<boolean> => {
      if (!conn) {
        toast('error', 'Not connected to the database yet');
        return false;
      }
      try {
        await fn(conn.reducers);
        if (success) toast('ok', success);
        return true;
      } catch (e) {
        toast('error', cleanError(e));
        return false;
      }
    },
    [conn, toast]
  );
}
