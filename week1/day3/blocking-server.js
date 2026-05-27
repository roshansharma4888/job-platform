// Strategy 1: the naive worker. Do the CPU work inline, in one tight loop, on
// the main thread. POST /jobs returns 202 immediately and *schedules* the work
// with setImmediate — so you'd think the API stays free. It doesn't: the moment
// that setImmediate callback runs, the burn loop seizes the only thread and
// holds it until the job is done. Every request that arrives meanwhile —
// GET /jobs/:id, GET /health, the next POST — sits in the queue, unprocessed,
// until the loop is handed back.
//
// Run it, then in another terminal: `node week1/day3/probe.js`. Watch the
// [blocking] event-loop-stall lines and the health pings that take ~2s.

const { startServer, touch } = require('./job-store');
const { JOB_TYPES, burnChunk } = require('./cpu-task');

const PORT = process.env.PORT || 3000;

function runJob(job) {
  // setImmediate doesn't make this async — it just defers the start by one
  // tick. Once it fires, nothing else runs until the for-loop completes.
  setImmediate(() => {
    const { chunks, roundsPerChunk } = JOB_TYPES[job.type];
    touch(job, { status: 'running', progress: 0 });
    console.log(`[blocking] ${job.id} (${job.type}) started — about to hog the thread`);

    let h;
    for (let i = 1; i <= chunks; i++) {
      h = burnChunk(roundsPerChunk, h);
      // We dutifully update progress between chunks, but no one can read it:
      // the GET handler can't run until this whole loop returns.
      touch(job, { progress: Math.round((i / chunks) * 100) });
    }

    touch(job, {
      status: 'succeeded',
      progress: 100,
      result: { digest: h.toString('hex').slice(0, 16) },
    });
    console.log(`[blocking] ${job.id} done — thread released`);
  });
}

startServer({ label: 'blocking', port: PORT, runJob });
