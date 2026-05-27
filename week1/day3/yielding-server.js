// Strategy 2: cooperative yielding, still on the main thread. Same total CPU
// work, but instead of one long loop we do ONE chunk and then hand control back
// to the event loop with setImmediate before the next chunk. Between chunks the
// loop is free to serve GET /jobs/:id and /health, so the API stays responsive
// and progress is observably climbing.
//
// The honest catch: each individual chunk still blocks the thread for its whole
// duration (~200ms here). Responsiveness is bounded by chunk size, not removed.
// Make chunks too coarse and you're back to stalling; too fine and scheduling
// overhead dominates. You're hand-rolling a scheduler — and you still only have
// one CPU core doing the work. That's what pushes us to worker_threads next.

const { startServer, touch } = require('./job-store');
const { JOB_TYPES, burnChunk } = require('./cpu-task');

const PORT = process.env.PORT || 3000;

function runJob(job) {
  const { chunks, roundsPerChunk } = JOB_TYPES[job.type];
  touch(job, { status: 'running', progress: 0 });
  console.log(`[yielding] ${job.id} (${job.type}) started — yielding between chunks`);

  let i = 0;
  let h;

  function step() {
    i++;
    h = burnChunk(roundsPerChunk, h);
    touch(job, { progress: Math.round((i / chunks) * 100) });

    if (i < chunks) {
      // Yield: let the loop drain its queue (pending HTTP requests, timers)
      // before we grab the thread back for the next chunk.
      setImmediate(step);
    } else {
      touch(job, {
        status: 'succeeded',
        progress: 100,
        result: { digest: h.toString('hex').slice(0, 16) },
      });
      console.log(`[yielding] ${job.id} done`);
    }
  }

  setImmediate(step);
}

startServer({ label: 'yielding', port: PORT, runJob });
