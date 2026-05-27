// Measures how responsive a Day 3 server stays *while a job is running*.
//
// It submits one job, then — without waiting — pings GET /health every 50ms and
// records how long each ping takes. On a healthy server every ping is a few ms.
// On a thread that's been hijacked by a CPU burn, the ping that lands during the
// burn comes back only when the loop is freed, so its latency ~= the stall.
//
// Usage: node week1/day3/probe.js [port]   (start one server first; default 3000)

const PORT = process.env.PORT || process.argv[2] || 3000;
const BASE = `http://localhost:${PORT}`;
const JOB_TYPE = 'image_resize';

async function main() {
  const t0 = Date.now();

  // Submit the job (don't await its completion — we want to observe *during* it).
  const submit = await fetch(`${BASE}/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: JOB_TYPE }),
  });
  const job = await submit.json();
  console.log(`submitted ${JOB_TYPE} -> ${job.id} (HTTP ${submit.status})`);

  const pings = [];
  let done = false;
  let sawProgressClimb = false;
  let lastProgress = 0;

  // Probe loop: hammer /health and poll the job until it finishes.
  while (!done) {
    const pingStart = Date.now();
    try {
      await fetch(`${BASE}/health`);
      pings.push(Date.now() - pingStart);
    } catch {
      pings.push(Date.now() - pingStart);
    }

    const snap = await (await fetch(`${BASE}/jobs/${job.id}`)).json();
    if (snap.progress > lastProgress && snap.progress < 100) sawProgressClimb = true;
    lastProgress = snap.progress;
    if (snap.status === 'succeeded' || snap.status === 'failed') {
      done = true;
      reportResult(snap);
    }

    await sleep(50);
  }

  const max = Math.max(...pings);
  const avg = pings.reduce((a, b) => a + b, 0) / pings.length;
  console.log('—'.repeat(48));
  console.log(`health pings:        ${pings.length}`);
  console.log(`  max latency:       ${max} ms   <-- worst stall the API showed`);
  console.log(`  avg latency:       ${avg.toFixed(1)} ms`);
  console.log(`progress observed climbing mid-run: ${sawProgressClimb ? 'yes' : 'no'}`);
  console.log(`total wall time:     ${Date.now() - t0} ms`);
}

function reportResult(snap) {
  console.log(`job ${snap.status}, result: ${JSON.stringify(snap.result)}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

main().catch((err) => {
  console.error('probe failed — is a server running on', BASE, '?');
  console.error(err.message);
  process.exit(1);
});
