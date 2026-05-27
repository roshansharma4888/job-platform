# Day 3 — Sync vs async deep dive

> Blog-post draft: **"Why I never want to do CPU work on the main thread again."**

## What I built

Three servers that expose the *exact same* API as Day 2 (`POST /jobs`, `GET /jobs/:id`, plus a `GET /health` to probe) and do the *exact same* work — only the scheduling differs:

- [blocking-server.js](blocking-server.js) — runs the whole job in one tight loop on the main thread.
- [yielding-server.js](yielding-server.js) — does one chunk, yields with `setImmediate`, repeats.
- [worker-server.js](worker-server.js) + [cpu-worker.js](cpu-worker.js) — runs the work on a `worker_threads` thread.

The shared bits live in [job-store.js](job-store.js) (Express plumbing + in-memory `Map`) and [cpu-task.js](cpu-task.js) (the CPU work + an event-loop lag monitor). [probe.js](probe.js) submits a job and then pings `/health` every 50ms to measure how responsive the API stays *while the job runs*.

The big change from Day 2: jobs are no longer `setTimeout` sleeps. A sleep is timer I/O — it never touches the CPU, so it never blocks the loop, which is exactly why Day 2 stayed snappy "for free." Day 3 makes the work **real CPU**: each chunk does 100k–300k SHA-256 iterations. That's the thing that can't be faked async.

## The numbers (one `image_resize` job, ~2s of CPU)

| Strategy | max `/health` latency | avg | progress visible mid-run | worst event-loop stall |
| --- | --- | --- | --- | --- |
| blocking | **1818 ms** | 1818 ms | **no** | one 1793 ms freeze |
| yielding | 406 ms | 182 ms | yes | ~85 ms per chunk |
| worker   | **6 ms** | 2.1 ms | yes | none |

All three returned the **same digest** (`2a5e8b87894fc2d1`) in roughly the same wall time (~2s). Same work. The only thing that changed is who got to use the thread, and when.

## Why the blocking version is a trap

The thing that fooled me: I returned `202` immediately and kicked the work off with `setImmediate`, so it *looks* fire-and-forget, just like Day 2. It is not. `setImmediate` doesn't make code asynchronous — it just defers *when* the synchronous burn starts by one tick. The moment that callback runs, the `for` loop seizes the one and only thread and doesn't give it back until the job is done.

Everything that arrives in that window — the probe's `/health` ping, a `GET /jobs/:id`, the next `POST` — sits in the queue, *unprocessed*. The probe got exactly **one** ping in, and it took 1818ms. The lag monitor confirms it from the inside: `event loop stalled 1793ms`. One job made the whole server unresponsive for the duration.

And note: I update `progress` between chunks in the blocking version too. It's useless. No `GET` handler can run to *read* that progress until the loop returns — so "progress observed climbing: no." Progress is meaningless if the thread that serves reads is the same thread that's busy.

## Why yielding helps — and why it's not the answer

The yielding version does one chunk, then `setImmediate(step)` to hand the loop back before the next chunk. Between chunks the loop drains its queue, so `/health` gets answered and progress visibly climbs (0→100). Responsiveness went from "dead for 1.8s" to "~85ms hiccups."

But two things stop me from being satisfied:

1. **Each chunk still blocks for its whole duration.** Worst ping was 406ms; the floor is the chunk size (~85ms). Responsiveness is *bounded by how finely I chop the work*, not removed. Coarse chunks → stalls return. Fine chunks → scheduling overhead and code that's all bookkeeping.
2. **It's still one core.** I hand-rolled a cooperative scheduler to share a single thread between "serving requests" and "doing work." The work didn't get faster; I just interleaved it. Two concurrent jobs would split that one core and both get slower.

Yielding is the right tool when you can't move the work off-thread (no native addon, simple enough to chunk). It is not the right tool for genuine CPU-bound jobs.

## Why worker_threads is the actual fix

The worker version moves the burn to a different OS thread with its own V8 isolate and event loop. The main thread does only what it's good at — accept connections, route, mutate job state from messages — and **never runs the burn loop at all**. The worker posts a `progress` message after each chunk; the main thread applies it.

The probe got **37 pings in at ~2ms each**, max 6ms, during a job that took the same ~2s. The lag monitor printed nothing. The API was fully responsive the entire time, *and* the job ran in parallel on another core instead of stealing time from request handling.

This is the first "real" worker in the project. Caveats I'm carrying forward:

- **One thread per job is wasteful.** Thread spin-up isn't free, and unbounded jobs = unbounded threads. A fixed-size **worker pool** (size ≈ CPU cores) is the real pattern — that's later in the curriculum.
- **Messages are copied, not shared.** Fine here (a tiny progress int, a short digest). For big payloads I'd reach for `SharedArrayBuffer` or `transferList` to avoid the serialize/copy cost.
- **Failure handling matters more now.** I wired `error` (a throw in the worker) and `exit` (a worker that dies without reporting `done`) to mark the job `failed`, because a crashed thread shouldn't silently leave a job stuck at `running`.

## The one-sentence takeaway

The event loop's superpower is handling thousands of concurrent **I/O-bound** things on one thread, because I/O is just waiting and waiting is free; the instant you put **CPU-bound** work on that thread you've spent the superpower on a single task and frozen everyone else — so CPU work goes on a worker thread, full stop.

## Verifying it

```
# terminal 1
npm run day3:blocking      # then day3:yielding, then day3:worker

# terminal 2
npm run day3:probe         # submits a job, pings /health throughout
```

Live traces are in the table above. Error paths (shared plumbing) confirmed: bad `type` → 400, unknown id → 404, `/health` → `{ ok: true }`.

## Carry-forward notes

- State still lives in `Map`s (in-process, leaks, single-node). Day 5 = Postgres, Day 17 = Redis.
- No idempotency in these three servers — I dropped the `Idempotency-Key` handling from Day 2 to keep the focus on scheduling. It should come back; the cleanest home is the shared `job-store.js` so all transports inherit it.
- Worker-per-job needs to become a **pool**. Flagging it loudly because Day 6 (cluster / multiple workers) is the natural place to confront "how many workers, and why # cores."
- The lag monitor in `cpu-task.js` is a keeper — it's a tiny, honest way to *see* a stall. Worth promoting to a real metric (Day 20, Prometheus).
