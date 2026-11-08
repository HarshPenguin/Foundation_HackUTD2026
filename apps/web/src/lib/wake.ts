import { useEffect, useState } from 'react';
import { useDb } from './stdb';
import { tsMs } from './format';

const WAKE_WINDOW_MS = 20_000;

/** True while SpacetimeDB has just woken the crew's Maritime machine and the crew hasn't come online yet. */
export function useWakingCrew(): boolean {
  const db = useDb();
  const latest = db.wakeEvents[0];
  const at = tsMs(latest?.at);
  const online = db.settings?.workerOnline ?? false;
  const [now, setNow] = useState(() => Date.now());
  const fresh = !online && at > 0 && now - at < WAKE_WINDOW_MS;
  useEffect(() => {
    if (online || at === 0) return;
    const left = WAKE_WINDOW_MS - (Date.now() - at);
    if (left <= 0) return;
    setNow(Date.now());
    const t = setTimeout(() => setNow(Date.now()), left + 50);
    return () => clearTimeout(t);
  }, [at, online]);
  return fresh;
}
