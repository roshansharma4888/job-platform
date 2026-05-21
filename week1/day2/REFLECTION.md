# Day 2 — Job submission API

## What I built

`week1/day2/server.js` — an Express server on :3000 with:

- `POST /jobs` — accepts `{ type, payload }`, validates `type` against a registry, creates a job, kicks off async work, returns `202 Accepted` with a `Location: /jobs/:id` header and the full job.
- `GET /jobs/:id` — returns the current job snapshot, or `404 { error: "not_found" }`.
- `Idempotency-Key` header — a `Map<key, jobId>` short-circuits replays and returns the original job with `Idempotent-Replay: true`.
- Two stub job types: `image_resize` (5s) and `report_generate` (15s). Each worker runs as an async function that ticks progress 10%→100% in equal steps and writes `result` on completion.

State lives in two `Map`s: `jobs` (id → job) and `idempotencyKeys` (key → jobId). No DB yet — that's Day 5.

## The job model

```
{ id, type, payload, status, progress, result, createdAt, updatedAt }
```

`status` is `queued` → `running` → `succeeded` | `failed`. `progress` is `0..100`. Every mutation goes through `touch(job, patch)` which also bumps `updatedAt`, so I never forget to refresh the timestamp.

## Idempotency — what the slides made click

`POST` is not safe to retry by default. If the client times out mid-request, retrying might create a second job. The `Idempotency-Key` pattern fixes this: the *client* generates a unique key per logical operation, and the server promises "same key → same result, no double-work."

Concretely:

1. First request with key `abc-123` → create job `J`, store `abc-123 → J.id`, return `202`.
2. Network blips, client retries with the same key → server finds the mapping, returns the *existing* `J` with `200` and `Idempotent-Replay: true`.

The header lets the client (and me, debugging) tell a replay from a fresh submission.

What this version doesn't do yet (deliberate, per the curriculum):

- **No TTL.** The key map grows unbounded. In Day 17 I move this to Redis with `SET … NX EX 3600`.
- **No request-body fingerprinting.** RFC 7240-style implementations also hash the body and reject if the same key arrives with a *different* payload. I'm trusting the client for now.
- **No cross-process coordination.** Two API processes wouldn't share this map. Also a Day 17 problem.
- **Race on concurrent first-time requests.** Two simultaneous requests with the same key would both miss the map and create two jobs. A real fix is a `SETNX`-style atomic claim.

## POST vs GET — the asymmetry

- `POST /jobs` is *not* idempotent by default (each call creates a job), which is why the `Idempotency-Key` header exists at all.
- `GET /jobs/:id` is naturally safe to retry, and naturally cacheable — though I'm not setting cache headers because the resource mutates rapidly while running.

I'm returning `202 Accepted` on submit, not `201 Created`. `202` says "I've accepted this for processing; come back later." That matches reality — the work hasn't happened yet. `Location: /jobs/:id` tells the client *where* to come back.

## How the "worker" runs

`runJob(id)` is fire-and-forget: `POST /jobs` calls it without `await`, attaches a `.catch`, and returns immediately. The HTTP handler returns in ~1ms; the work proceeds on the event loop via `setTimeout`-based `sleep`. Each tick mutates the in-memory job.

This is honest async I/O — the loop never blocks, so `GET /jobs/:id` stays snappy even while 10 jobs are "running." Day 3 is where I deliberately break this by writing a CPU-burning version and watching the API hang.

## Verifying it

Live trace from one run:

```
POST /jobs            { type: image_resize }   → 202   id=b6eb…7c, status=running, progress=0
POST /jobs (replay)   Idempotency-Key: abc-123 → 200   Idempotent-Replay: true, same id
GET  /jobs/b6eb…7c                             → 200   progress=0
GET  /jobs/b6eb…7c    (+3s)                    → 200   progress=60
GET  /jobs/does-not-exist                      → 404   { error: "not_found" }
GET  /jobs/b6eb…7c    (+8s total)              → 200   status=succeeded, progress=100, result populated
POST /jobs            { type: bogus }          → 400   { error: "invalid_type" }
```

## Carry-forward notes

- Node 12 is still the local toolchain (`crypto.randomUUID` missing, optional chaining / nullish-coalescing not supported). I kept this file syntactically conservative — but Day 3 needs `worker_threads` semantics that are messy pre-Node 16, so I'm upgrading before then.
- The two `Map`s leak. Acceptable for Day 2; flagging it because Day 5 (Postgres) and Day 17 (Redis + TTL) are exactly the right places to fix it.
- The `runJob` failure path writes `{ status: "failed", result: { error } }`. I haven't actually exercised a failure yet — worth adding a synthetic-failure job type later just to have something to test against.
- The progress steps are uniform. Real workers won't be — that's fine for now; SSE on Day 9 needs *some* stream of updates to push, doesn't matter that they're regular.
