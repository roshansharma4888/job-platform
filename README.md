### Option A: Real-Time Job Processing System

**The idea:** A backend service where clients submit long-running jobs (image processing, video transcoding stub, report generation) and observe progress through _every_ communication pattern in the course. Same backend, multiple client APIs, so you can directly compare the trade-offs Hussein teaches.

**What you build:**

A central job orchestrator with workers that process jobs from a queue. Clients can submit a job and then check progress through any of these endpoints:

- `POST /jobs` — submit a job, get an idempotency-keyed job ID back
- `GET /jobs/:id` — short polling (request/response)
- `GET /jobs/:id/wait` — long polling (server holds the request until done or timeout)
- `GET /jobs/:id/stream` — Server-Sent Events streaming progress updates
- `WS /jobs/:id` — WebSocket connection for bidirectional progress and cancellation
- `POST /jobs/batch` — submit many at once, watch via any of the above

Workers communicate over a pub/sub layer (Redis or RabbitMQ — both demo'd in the course).

**Maps to the deck:**

| Course topic                              | Where in project                                                      |
| ----------------------------------------- | --------------------------------------------------------------------- |
| Request/Response (slides 5–12)            | `POST /jobs`, `GET /jobs/:id`                                         |
| Sync vs async (slides 13–21)              | Worker code uses async I/O; you'll compare a blocking version         |
| Push (slides 22–27)                       | WebSocket progress                                                    |
| Short polling (slides 28–33)              | Status endpoint hit in a loop                                         |
| Long polling (slides 34–39)               | The `/wait` endpoint                                                  |
| SSE (slides 40–45)                        | The `/stream` endpoint                                                |
| Pub/Sub (slides 46–52)                    | Worker queue (Redis Streams or RabbitMQ)                              |
| Stateless vs stateful (61–71)             | Sessions in Redis vs in-memory                                        |
| HTTP/1.1, HTTP/2 (slides 129–166)         | Run the same API behind both, measure                                 |
| Idempotency (slides 279–282)              | Idempotency-Key header on `POST /jobs`                                |
| Connection establishment (slides 258–268) | You'll see SYN/Accept queues under load testing                       |
| Process vs thread (slides 251–257)        | Cluster module vs single process workers                              |
| L4 vs L7 load balancing (slides 283–305)  | Deploy 3 worker instances behind nginx (L7) and HAProxy (L4), compare |

**Why this is a good fit:**

- Touches roughly 80% of the deck
- Every endpoint is a direct comparison point — you'll _feel_ the trade-offs, not just read about them
- Forces you to think about real backend concerns: timeouts, retries, idempotency, observability
- Scales naturally — start with one worker, end with a cluster behind a load balancer

**What I'd skip / not cover:**

- WebRTC (it's covered in slides but not really a backend pattern — skip in this project)
- TLS internals (use HTTPS via a reverse proxy; don't roll your own)
- gRPC (could add as a stretch goal in week 4)

---

### Option B: Mini Reverse Proxy + Load Balancer

**The idea:** Build your own version of nginx/HAProxy in Node — start with L4 TCP forwarding, layer on HTTP parsing, then HTTP/2, then TLS termination, then health checks, retries, sticky sessions, and metrics. Run real backends behind it and benchmark.

**What you build:**

A proxy program with a YAML config, like:

yaml

```yaml
listeners:
  - address: 0.0.0.0:8080
    mode: l7_http
    upstream: web_servers
  - address: 0.0.0.0:9000
    mode: l4_tcp
    upstream: db_servers
upstreams:
  web_servers:
    algorithm: round_robin
    health_check: /health
    servers: [127.0.0.1:3001, 127.0.0.1:3002, 127.0.0.1:3003]
```

**Maps to the deck:**

| Course topic                               | Where in project                     |
| ------------------------------------------ | ------------------------------------ |
| OSI model (slides 86–95)                   | You literally implement L4 and L7    |
| TCP (slides 104–117)                       | You manage raw `net.Socket` objects  |
| Connection establishment (slides 258–268)  | Accept queue tuning, `SO_REUSEPORT`  |
| Send/receive buffers (slides 264–268)      | Backpressure between client/upstream |
| Stateless vs stateful (slides 61–71)       | Sticky sessions vs round-robin       |
| Sidecar pattern (slides 72–80)             | What you're building _is_ a sidecar  |
| Protocol properties (slides 81–85)         | You're forced to handle each         |
| TLS (slides 118–128)                       | TLS termination at L7                |
| HTTP/1.1, HTTP/2 (slides 129–181)          | Parse both, multiplex H2 streams     |
| Multiplexing/demultiplexing (slides 53–60) | Core to L7 — you implement it        |
| L4 vs L7 (slides 283–305)                  | This _is_ the project                |
| Idempotency (slides 279–282)               | Retry-safe vs retry-unsafe routing   |
| Process vs thread (slides 251–257)         | Worker processes via cluster module  |

**Why this is a deeper learning experience:**

- You'll have to _internalize_ every protocol detail, not just use it
- The bug you fix on day 19 will teach you more than a week of reading
- The output is a real, useful tool you can run real backends behind

**Why it's harder:**

- HTTP/2 parsing is non-trivial; you'll likely use `http2` module's hooks rather than parse frames yourself
- TLS termination requires understanding certificates, SNI, ALPN
- Less surface area for client-facing patterns (no SSE, no WebSockets, no pub/sub) — narrower coverage of the deck

---

### My honest comparison

| |Job Processor|Reverse Proxy|
|---|---|---|
|Deck coverage|~80%|~60%|
|Depth on covered topics|Medium|Very deep|
|30-day feasibility|Comfortable|Tight|
|Real-world utility|High (everyone needs job queues)|High (everyone uses proxies)|
|Variety of patterns|High|Low — but each one is deep|
|Risk of getting stuck|Low|Medium (TLS, HTTP/2 can eat days)|
|Best for|Breadth + integration|Depth + protocol mastery|

### Schedule

## Week 1 — Foundations: Request/Response, Sync/Async, HTTP basics

**Goal:** A working job submission API. Single-process, in-memory, no fancy patterns yet. By end of week 1 you can submit a job and poll for status.

**Slides to watch before this week:** 4–21 (communication patterns intro + sync/async), 129–144 (HTTP versions), 251–257 (process vs thread), 279–282 (idempotency).

#### Day 1 — Setup & raw TCP warmup

- Watch slides 4–12 (Request/Response).
- Build a "hello world" raw TCP server using `net.createServer()` — no Express yet. Send a hardcoded HTTP/1.1 response by writing bytes manually.
- Then build the same thing with Express, in 8 lines.
- Reflection: write a note comparing the two.

#### Day 2 — Job submission API

- Slides 279–282 (idempotency), 282 (POST + GET).
- Design the job model: `{ id, type, payload, status, progress, result, createdAt, updatedAt }`.
- Implement `POST /jobs` and `GET /jobs/:id` with Express, in-memory `Map<jobId, Job>`.
- Add `Idempotency-Key` header support — store seen keys, return the same job on retry.
- Implement two job types as stubs: `image_resize` (sleep 5s) and `report_generate` (sleep 15s).

#### Day 3 — Sync vs async deep dive

- Slides 13–21 (async I/O).
- Write a deliberately _blocking_ version of a job worker (use a `while` loop that burns CPU for N seconds). Watch the event loop stall — your `GET /jobs/:id` will hang.
- Rewrite using `setTimeout` / `setImmediate` to yield. Notice the API stays responsive.
- Then move work to a `worker_threads` worker. This is your first real worker.
- Reflection: blog post draft — "Why I never want to do CPU work on the main thread again."

#### Day 4 — Short polling client + the chattiness problem

- Slides 28–33 (short polling).
- Write a small CLI client that submits a job then polls `GET /jobs/:id` every 500ms until done.
- Run 100 clients at once. Watch the server logs flood.
- Add a request counter middleware. Measure: how many requests does one job generate? Compare to one request that just returned the answer.

#### Day 5 — Persistence: ditch in-memory state

- Slides 61–71 (stateful vs stateless).
- Add Postgres via Docker. Move jobs into a `jobs` table.
- Restart the server mid-job. The job survives. The _worker_ state doesn't yet — that's fine, we fix it later.
- Key insight to internalize: your _backend process_ is now stateless; the _system_ is stateful (Postgres holds state).

#### Day 6 — Multiple workers via cluster

- Slides 251–257 (process vs thread).
- Use Node's `cluster` module to fork N worker processes, each pulling jobs from the DB with `SELECT ... FOR UPDATE SKIP LOCKED`.
- Two failure modes you should observe: (1) a worker crashes, the job needs reclaiming; (2) two workers grab the same job — what saves you?
- This is also where you'll see why `# workers = # cores` is the rule of thumb.

#### Day 7 — Catch up + write Week 1 retrospective

- Buffer day for things that took longer than expected.
- Blog post: "A job processor in one week — what request/response is good and bad at."
- **Week 1 deliverable on GitHub:** tagged release `v0.1-week1`.

---

## Week 2 — Real-time patterns: Push, Long Polling, SSE, WebSockets

**Goal:** Your job system can now stream progress to clients in four different ways. You can articulate when to use each.

**Slides to watch:** 22–27 (Push), 34–39 (Long polling), 40–45 (SSE), 145–155 (WebSockets), 156–181 (HTTP/2 and /3).

#### Day 8 — Long polling

- Slides 34–39.
- Add `GET /jobs/:id/wait?timeout=30`. The request hangs until the job completes or the timeout hits.
- Implementation hint: use an event emitter keyed by job ID. The HTTP handler does `await once(emitter, jobId)`. The worker emits when it updates the DB.
- Trap: if the job is _already_ done when the request arrives, you'll wait forever. Handle that.
- Trap: client disconnects mid-wait. Clean up the listener (memory leak otherwise).

#### Day 9 — Server-Sent Events

- Slides 40–45.
- Add `GET /jobs/:id/stream`. Response headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`.
- Emit progress events as the worker updates the job. Format: `data: {"progress": 42}\n\n`.
- Test with `curl -N http://localhost:3000/jobs/abc/stream`.
- Hussein notes the HTTP/1.1 6-connection limit (slide 44) — open a browser tab streaming 7 jobs and watch it break.

#### Day 10 — WebSockets, server-to-client

- Slides 145–155.
- Add `ws` library. Endpoint `WS /jobs/:id`.
- Server pushes progress updates. Client can send `{"action": "cancel"}` — bidirectional matters here.
- Implementation hint: the same internal event bus you built for long polling now also feeds WebSocket clients. One source of truth, many transports.

#### Day 11 — The comparison day (very important)

- Build a load test harness using `autocannon` and a custom script.
- Submit 100 jobs. Subscribe to all of them using each transport (polling, long polling, SSE, WebSocket).
- Measure: total bytes transferred, server CPU, time to deliver first progress update.
- Write up the results. Make a table. This is your blog post for the week.

#### Day 12 — HTTP/2 multiplexing

- Slides 156–181.
- Enable HTTP/2 in your server (Node's `http2` module + a self-signed cert for HTTPS — HTTP/2 over cleartext is rare in practice).
- Re-run the SSE test from day 9 with 10 concurrent streams. Watch the 6-connection limit disappear.
- Use Chrome DevTools → Network → Protocol column to confirm h2.

#### Day 13 — Backpressure & slow clients

- Slides 264–268 (send/receive buffers).
- Write a "slow client" that connects to your SSE stream and reads one byte per second.
- Watch what happens to your server's memory.
- Fix it: detect when `response.write()` returns `false`, pause emitting until `drain`.

#### Day 14 — Catch up + Week 2 retrospective

- **Week 2 deliverable:** tagged `v0.2-week2`. Blog post comparing the 4 transports with real numbers.

---

## Week 3 — Pub/Sub, scaling out, multi-protocol

**Goal:** Your system scales horizontally. Workers and API servers can be on different machines. You add a second API protocol (gRPC) to compare.

**Slides to watch:** 46–52 (Pub/Sub), 53–60 (Multiplexing), 182–194 (gRPC), 258–278 (connections, listeners).

#### Day 15 — Replace DB polling with pub/sub

- Slides 46–52.
- Add Redis or RabbitMQ. Workers subscribe to a queue rather than polling Postgres.
- Two queues: `jobs:new` (work to do), `jobs:progress` (broadcast to API servers).
- The API server's event emitter now listens to Redis pub/sub — so progress from a worker on machine A reaches an SSE client on machine B.
- This is the critical moment: your system becomes properly distributed.

#### Day 16 — Run multiple API servers

- Run two API server instances on ports 3001 and 3002.
- Use nginx in front as a round-robin load balancer (config will come from week 4 deck slides on L4 vs L7).
- Open an SSE stream against nginx. It works because Redis carries events across instances.
- Sticky sessions question: does it matter for SSE? For WebSockets?

#### Day 17 — Idempotency at scale

- Slides 279–282 again, harder this time.
- Your `POST /jobs` had an `Idempotency-Key` per process. Now there are 3 processes. Move the key store to Redis with a TTL.
- Stress test: send the same idempotency key to both API servers simultaneously. What wins? Race conditions — use `SET key value NX EX 3600`.

#### Day 18 — gRPC alternative API

- Slides 182–194.
- Define `jobs.proto` with `SubmitJob`, `GetJob` (unary), `StreamJobProgress` (server streaming).
- Run a gRPC server alongside your HTTP one. Same backend, different transport.
- Compare: same logical operations, very different ergonomics. Note the lack of browser support — the cons in slide 192 are real.

#### Day 19 — Connection internals

- Slides 258–278 (connection establishment, listeners, workers).
- `ss -ltn` your server. Look at `Recv-Q` and `Send-Q`.
- Crank up the `net.somaxconn` and Node's `listen(port, backlog)` parameter.
- Load test until you start seeing `SYN cookies` warnings in `dmesg`.
- Try `SO_REUSEPORT` with cluster — slide 277.

#### Day 20 — Observability

- Add Prometheus metrics: requests per second, job duration histogram, active SSE connections, WebSocket count.
- Add structured logging with `pino`.
- Spin up Grafana via Docker. Build one dashboard.
- This is what separates a toy from a real backend.

#### Day 21 — Week 3 retrospective + freeze the feature set

- **Week 3 deliverable:** tagged `v0.3-week3`. System is feature-complete.
- No new features after this point. Week 4 is purely about putting your own proxy in front of it.

---

## Week 4 — Roll your own proxy

**Goal:** Replace nginx with your own Node-based reverse proxy. By the end, you understand L4 vs L7 not because you read about it, but because you implemented both.

**Slides to watch:** 72–80 (Sidecar), 283–305 (L4 vs L7), 86–95 (OSI), 53–60 (Multiplexing again, deeper now).

#### Day 22 — L4 TCP proxy

- Slides 283–296.
- Use `net.createServer()`. On every connection, open a second `net.connect()` to the upstream. Pipe in both directions: `client.pipe(upstream); upstream.pipe(client)`.
- That's it. ~30 lines for a working L4 proxy. Round-robin between 3 backends.
- Test it with HTTP, with raw TCP (`nc`), with anything — it doesn't care, because L4 doesn't look at data.

#### Day 23 — L7 HTTP proxy

- Slides 297–305.
- Now parse the HTTP request. Use Node's built-in `http` module's `IncomingMessage` parsing — you don't need to roll your own parser.
- Route based on path: `/api/jobs` → API servers, `/metrics` → Prometheus.
- Notice: you now have _two_ TCP connections per request (client→proxy, proxy→upstream). That's the cost of L7 — slide 304.

#### Day 24 — Health checks & retries

- Background loop hitting `GET /health` on each upstream every 5s.
- Mark upstreams unhealthy after 3 failures, healthy after 1 success.
- On failure during a request, retry on another upstream — but only for idempotent requests! POSTs without an idempotency key must NOT retry. This is where slide 282 pays off.

#### Day 25 — Sticky sessions

- For WebSocket upgrades, you can't round-robin every packet — they must stick.
- Implement two strategies: (1) hash the client IP, (2) read a cookie.
- Test: connect a WebSocket through the proxy; verify it always lands on the same backend.

#### Day 26 — TLS termination

- Slides 118–128.
- Generate self-signed certs with `openssl`.
- Have your proxy terminate TLS using `tls.createServer()`. Upstream traffic is plain HTTP.
- This is the "two TCP connections, must share TLS certificate" point from slide 304 made real.

#### Day 27 — HTTP/2 frontend → HTTP/1.1 backend

- Slides 53–60 (multiplexing), slide 57 specifically.
- Enable HTTP/2 on the proxy's public listener. Backends stay HTTP/1.1.
- The proxy is now demultiplexing H2 streams into separate H1 connections to upstreams.
- This is exactly what Envoy and modern API gateways do.

#### Day 28 — Benchmarking & comparison

- Run `wrk` against:
    1. Your API server directly
    2. nginx → your API server
    3. Your homemade proxy → your API server (L4 mode)
    4. Your homemade proxy → your API server (L7 mode)
    5. Your homemade proxy → your API server (L7 + TLS termination)
- Make a table. Be honest about how your proxy compares to nginx. nginx will win — by a lot. Understand _why_.

#### Day 29 — Wireshark deep dive

- Capture traffic at each layer: client→proxy, proxy→upstream.
- Trace one request through the entire system. Annotate the screenshot.
- For HTTP/2 traffic, use Wireshark's HTTP/2 dissector — you'll see streams, frames, the whole thing.
- This becomes a fantastic blog post and a portfolio piece.

#### Day 30 — Final retrospective

- **Final deliverable:** tagged `v1.0`. README explains the architecture, the trade-offs, how to run it, what you learned.
- Write a "30 days of backend" blog post linking everything together.
- Pick the _next_ project. By now you'll know what your weak spots are.