const express = require('express');
const crypto = require('crypto');

const PORT = 3000;

const JOB_TYPES = {
  image_resize: { durationMs: 5000 },
  report_generate: { durationMs: 15000 },
};

const jobs = new Map();
const idempotencyKeys = new Map();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function newId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return crypto.randomBytes(16).toString('hex');
}

function createJob(type, payload) {
  const now = new Date().toISOString();
  const job = {
    id: newId(),
    type: type,
    payload: payload == null ? null : payload,
    status: 'queued',
    progress: 0,
    result: null,
    createdAt: now,
    updatedAt: now,
  };
  jobs.set(job.id, job);
  return job;
}

function touch(job, patch) {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
}

async function runJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;

  const durationMs = JOB_TYPES[job.type].durationMs;
  const steps = 10;
  const stepMs = durationMs / steps;

  touch(job, { status: 'running', progress: 0 });
  console.log(`[worker] ${job.id} (${job.type}) started`);

  for (let i = 1; i <= steps; i++) {
    await sleep(stepMs);
    touch(job, { progress: Math.round((i / steps) * 100) });
  }

  touch(job, {
    status: 'succeeded',
    progress: 100,
    result: { message: `${job.type} complete`, finishedAt: new Date().toISOString() },
  });
  console.log(`[worker] ${job.id} (${job.type}) done`);
}

const app = express();
app.use(express.json());

app.post('/jobs', (req, res) => {
  const idempotencyKey = req.get('Idempotency-Key');
  if (idempotencyKey) {
    const existingId = idempotencyKeys.get(idempotencyKey);
    if (existingId) {
      const existing = jobs.get(existingId);
      if (existing) {
        res.set('Idempotent-Replay', 'true');
        return res.status(200).json(existing);
      }
    }
  }

  const body = req.body || {};
  const type = body.type;
  const payload = body.payload;

  if (!type || !JOB_TYPES[type]) {
    return res.status(400).json({
      error: 'invalid_type',
      message: `type must be one of: ${Object.keys(JOB_TYPES).join(', ')}`,
    });
  }

  const job = createJob(type, payload);
  if (idempotencyKey) idempotencyKeys.set(idempotencyKey, job.id);

  runJob(job.id).catch((err) => {
    console.error(`[worker] ${job.id} failed:`, err);
    const j = jobs.get(job.id);
    if (j) touch(j, { status: 'failed', result: { error: err.message } });
  });

  res.status(202).location(`/jobs/${job.id}`).json(job);
});

app.get('/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'not_found' });
  res.json(job);
});

app.listen(PORT, () => {
  console.log(`[day2] listening on http://localhost:${PORT}`);
  console.log(`[day2] job types: ${Object.keys(JOB_TYPES).join(', ')}`);
});
