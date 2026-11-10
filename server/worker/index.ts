import { config } from '../config.js';
import { closeDb } from '../db/client.js';
import { claimJobs, finishJob, markJobDead, newWorkerId, retryJob } from '../services/jobs.js';
import { processJob } from '../services/worker-core.js';
import { reconcileOldPayments } from '../services/payments.js';
import { renewDueHostingApps } from '../services/hosting.js';

const c = config();
const workerId = newWorkerId();
let stopping = false;
let active = 0;
let lastReconcile = 0;
let lastHostingSweep = 0;

type Outcome = { done?: boolean; retry?: boolean; dead?: boolean; code?: string };

async function runJob(job: Awaited<ReturnType<typeof claimJobs>>[number]) {
  active += 1;
  try {
    const outcome = await processJob(job) as Outcome;
    if (outcome.dead) await markJobDead(job, outcome.code ?? 'JOB_DEAD');
    else if (outcome.done === false || outcome.retry) await retryJob(job, outcome.code ?? 'JOB_RETRY');
    else await finishJob(job);
  } catch (error) {
    const code = error instanceof Error ? `${error.name}:${error.message}`.slice(0, 180) : 'JOB_EXCEPTION';
    console.error('Job failed', { jobId: job.id, kind: job.kind, attempt: job.attempts, code });
    await retryJob(job, code);
  } finally { active -= 1; }
}

function wait(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function loop() {
  console.info(`DevRelay worker ${workerId} started`);
  while (!stopping) {
    try {
      const batch = await claimJobs(workerId, 5);
      if (batch.length) {
        await Promise.allSettled(batch.map(runJob));
      } else {
        await wait(c.WORKER_POLL_MS);
      }
      if (Date.now() - lastReconcile > 120_000) {
        lastReconcile = Date.now();
        await reconcileOldPayments().catch(() => undefined);
      }
      if (Date.now() - lastHostingSweep > 300_000) {
        lastHostingSweep = Date.now();
        await renewDueHostingApps().catch(() => undefined);
      }
    } catch (error) {
      console.error('Worker loop error', { name: error instanceof Error ? error.name : 'unknown' });
      await wait(Math.max(c.WORKER_POLL_MS, 2000));
    }
  }
  while (active > 0) await wait(100);
  await closeDb();
  console.info('DevRelay worker stopped');
}

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.info(`Received ${signal}; finishing active jobs`);
  setTimeout(() => { console.error('Forced worker shutdown'); process.exit(1); }, 30_000).unref();
}
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

await loop();
