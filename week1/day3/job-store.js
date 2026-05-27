// In-memory job store + the Express plumbing that's identical across all three
// servers (POST /jobs, GET /jobs/:id, GET /health). Each server requires this,
// gets its own fresh Map (separate process), and supplies a single `runJob`
// function — that function is the only thing Day 3 is really about.

const express = require('express');
const crypto = require('crypto');
const { JOB_TYPES, startLagMonitor } = require('./cpu-task');

function newId() {
  return crypto.randomUUID();
}

function touch(job, patch) {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
}

// Builds and starts a server. `runJob(job, jobs)` is the strategy under test:
// it receives the freshly-created job and the store, and is responsible for
// driving it from queued -> succeeded. It must not block... or it can block,
// and that's the lesson (see blocking-server.js).
function startServer({ label, port, runJob }) {
  const jobs = new Map();

  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ ok: true, at: Date.now() }));

  app.post('/jobs', (req, res) => {
    const { type, payload } = req.body || {};
    if (!type || !JOB_TYPES[type]) {
      return res.status(400).json({
        error: 'invalid_type',
        message: `type must be one of: ${Object.keys(JOB_TYPES).join(', ')}`,
      });
    }

    const now = new Date().toISOString();
    const job = {
      id: newId(),
      type,
      payload: payload ?? null,
      status: 'queued',
      progress: 0,
      result: null,
      createdAt: now,
      updatedAt: now,
    };
    jobs.set(job.id, job);

    runJob(job, jobs);

    res.status(202).location(`/jobs/${job.id}`).json(job);
  });

  app.get('/jobs/:id', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'not_found' });
    res.json(job);
  });

  startLagMonitor(label);
  app.listen(port, () => {
    console.log(`[${label}] listening on http://localhost:${port}`);
    console.log(`[${label}] job types: ${Object.keys(JOB_TYPES).join(', ')}`);
  });
}

module.exports = { startServer, touch };
