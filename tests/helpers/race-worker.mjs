// Race harness worker: opens the shared DB (env AIOS_DB) and tries to claim task 'RACE'.
// Prints one JSON line to stdout: {"won":bool,"reason":str|null}. Used by race.test.mjs to
// prove that N concurrent OS processes contending for one task yield exactly one winner.
import { openDb } from '../../db.mjs';
import { claimTask } from '../../state.mjs';

const db = openDb(process.env.AIOS_DB);
const r = claimTask(db, {
  taskId: 'RACE',
  agent: 'claude',
  session: `w-${process.pid}-${Math.random().toString(36).slice(2)}`,
  ttlMs: 60000,
});
process.stdout.write(JSON.stringify({ won: r.won, reason: r.reason ?? null }) + '\n');
db.close();
