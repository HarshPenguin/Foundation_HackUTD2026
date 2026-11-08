import { useCallback } from 'react';
import { useCall } from './actions';
import { useDb } from './stdb';
import { isSwitchNotice } from './domain';
import { usd } from './format';

const UPGRADE_LABEL = usd(20_000_000, 0); // MOCK: the module's upgrade adds $20 of credit.

/** Switch or upgrade, shared by provider cards, the bell and the banner. */
export function useProviderActions() {
  const db = useDb();
  const call = useCall();

  const noticesFor = useCallback(
    (providerId: bigint) => db.notifications.filter(n => isSwitchNotice(n) && n.providerId === providerId),
    [db.notifications]
  );

  /** Stop preferring this provider: move it to the end of every fallback chain and switch any waiting task. */
  const switchAway = useCallback(
    async (providerId: bigint) => {
      const name = db.providers.find(p => p.id === providerId)?.name ?? 'This provider';
      let ok = true;
      for (const c of db.chains) {
        const idx = c.providerIds.indexOf(providerId);
        if (idx === -1 || idx === c.providerIds.length - 1) continue;
        const next = [...c.providerIds.filter(id => id !== providerId), providerId];
        ok = (await call(r => r.setFallbackChain({ taskType: c.taskType, providerIds: next }))) && ok;
      }
      for (const n of noticesFor(providerId)) {
        ok = (await call(r => r.resolveSwitchOrUpgrade({ notificationId: n.id, choice: 'switch' }))) && ok;
      }
      if (ok) await call(async () => undefined, `Switched. ${name} is now the last choice in every chain`);
    },
    [db.chains, db.providers, noticesFor, call]
  );

  const upgrade = useCallback(
    async (providerId: bigint) => {
      const name = db.providers.find(p => p.id === providerId)?.name ?? 'Provider';
      const notices = noticesFor(providerId);
      let ok: boolean;
      if (notices.length) {
        ok = await call(r => r.resolveSwitchOrUpgrade({ notificationId: notices[0].id, choice: 'upgrade' }));
        for (const n of notices.slice(1)) await call(r => r.resolveSwitchOrUpgrade({ notificationId: n.id, choice: 'switch' }));
      } else {
        ok = await call(r => r.upgradeProvider({ providerId }));
      }
      if (ok) await call(async () => undefined, `Upgraded. Added ${UPGRADE_LABEL} of credit to ${name}`);
    },
    [db.providers, noticesFor, call]
  );

  /** Mark a notification as read. */
  const dismiss = useCallback(
    (notificationId: bigint) => call(r => r.dismissNotification({ notificationId })),
    [call]
  );

  return { switchAway, upgrade, dismiss, noticesFor };
}
