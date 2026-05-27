// Shared pieces for the three Day 3 servers. The whole point of today is that
// all three do *identical* CPU work — only the scheduling differs — so the work
// itself lives here and each server decides how to run it.

const crypto = require('crypto');

// Day 2 modelled job types as sleeps (timer I/O — never blocks the loop).
// Day 3 makes them real CPU work: `chunks` progress steps, each doing
// `roundsPerChunk` SHA-256 iterations. On this machine one round is ~1.7us,
// so image_resize ~= 2s of pure CPU, report_generate ~= 5s.
const JOB_TYPES = {
  image_resize: { chunks: 10, roundsPerChunk: 100_000 },
  report_generate: { chunks: 10, roundsPerChunk: 300_000 },
};

// One chunk of pure CPU work: no I/O, no awaits, no yielding. It runs to
// completion on whatever thread calls it. We chain digests (seed -> next seed)
// and return the result so V8 can't prove the loop is dead code and delete it.
function burnChunk(rounds, seed) {
  let h = seed || Buffer.alloc(32);
  for (let i = 0; i < rounds; i++) {
    h = crypto.createHash('sha256').update(h).digest();
  }
  return h;
}

// A heartbeat that fires every 100ms and reports how late it actually ran.
// On a healthy loop drift is ~0ms. When something hogs the thread, the timer
// can't fire on time and the drift is exactly how long the loop was blocked —
// this is the "watch the event loop stall" instrument for today.
function startLagMonitor(label) {
  const intervalMs = 100;
  let last = process.hrtime.bigint();
  const timer = setInterval(() => {
    const now = process.hrtime.bigint();
    const drift = Number(now - last) / 1e6 - intervalMs;
    if (drift > 50) {
      console.log(`[${label}] event loop stalled ${drift.toFixed(0)}ms`);
    }
    last = now;
  }, intervalMs);
  // Don't let the heartbeat keep the process alive on its own.
  timer.unref();
}

module.exports = { JOB_TYPES, burnChunk, startLagMonitor };
