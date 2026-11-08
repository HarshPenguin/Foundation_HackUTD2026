// Resets the demo database (wipe + reseed) as the registered worker, and clears the agent's MediClaim copy.
// Usage: pnpm reset            (from apps/worker)
//        pnpm reset --keep-workspace
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { env } from '../env';
import { connect, registerWorker } from '../stdb';

async function main() {
  const conn = await connect();
  const ok = await registerWorker(conn);
  if (!ok) throw new Error('could not register as the worker (check WORKER_PAIRING_CODE)');
  await conn.reducers.resetDemo({});
  console.log(`reset_demo done on ${env.stdbDb}`);
  if (!process.argv.includes('--keep-workspace')) {
    rmSync(join(env.workspaceDir, 'mediclaim'), { recursive: true, force: true });
    rmSync(join(env.workspaceDir, 'worktrees'), { recursive: true, force: true });
    console.log('cleared the MediClaim workspace copy');
  }
  conn.disconnect();
}

main().then(
  () => process.exit(0),
  err => {
    console.error('reset failed:', (err as Error).message);
    process.exit(1);
  }
);
