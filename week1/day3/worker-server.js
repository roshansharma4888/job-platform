// Strategy 3: move the CPU work off the main thread entirely with worker_threads.
// The main thread does only what it's good at — accepting connections, routing,
// reading/writing job state — and never touches the burn loop. A worker thread
// runs the chunks on a *different* core and posts progress back via messages;
// the main thread applies those messages to the job.
//
// Result: the API isn't just responsive between chunks (like the yielding
// version) — it's responsive *the entire time*, because the work isn't on its
// thread at all. And the job genuinely runs in parallel on another core.
//
// This is the first "real" worker. One thread per job is wasteful (thread spin-up
// cost, unbounded fan-out); a fixed worker pool comes later in the curriculum.

const path = require('path');
const { Worker } = require('worker_threads');
const { startServer, touch } = require('./job-store');
const { JOB_TYPES } = require('./cpu-task');

const PORT = process.env.PORT || 3000;

function runJob(job) {
  const { chunks, roundsPerChunk } = JOB_TYPES[job.type];
  touch(job, { status: 'running', progress: 0 });
  console.log(`[worker] ${job.id} (${job.type}) started on a worker thread`);

  const worker = new Worker(path.join(__dirname, 'cpu-worker.js'), {
    workerData: { chunks, roundsPerChunk },
  });

  worker.on('message', (msg) => {
    if (msg.type === 'progress') {
      touch(job, { progress: msg.progress });
    } else if (msg.type === 'done') {
      touch(job, { status: 'succeeded', progress: 100, result: msg.result });
      console.log(`[worker] ${job.id} done — terminating thread`);
      worker.terminate();
    }
  });

  // A throw inside the worker surfaces here; the 'exit' guard catches a worker
  // that dies without ever reporting done (e.g. process.exit, OOM).
  worker.on('error', (err) => {
    touch(job, { status: 'failed', result: { error: err.message } });
    console.error(`[worker] ${job.id} errored:`, err.message);
  });
  worker.on('exit', (code) => {
    if (job.status !== 'succeeded' && job.status !== 'failed') {
      touch(job, { status: 'failed', result: { error: `worker exited ${code}` } });
    }
  });
}

startServer({ label: 'worker', port: PORT, runJob });
