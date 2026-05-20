# Day 1 — Raw TCP vs Express

## What I built

- `raw-tcp.js` — `net.createServer()` listening on :3000. On each connection I read the incoming bytes, log the request line, and manually write an HTTP/1.1 response: status line, headers (`Content-Type`, `Content-Length`, `Connection: close`), blank line, body. Then `socket.end()`.
- `express-server.js` — same behavior on :3001 in roughly 6 lines.

Both verified with `curl -is`. Identical body, very different headers.

## Side-by-side response headers

Raw TCP:
```
HTTP/1.1 200 OK
Content-Type: text/plain; charset=utf-8
Content-Length: 19
Connection: close
```

Express:
```
HTTP/1.1 200 OK
X-Powered-By: Express
Content-Type: text/plain; charset=utf-8
Content-Length: 19
ETag: W/"13-ZzHFrlVPdFdPT7b6qsGrA9mzNY8"
Date: Wed, 20 May 2026 10:48:04 GMT
Connection: keep-alive
Keep-Alive: timeout=5
```

The diff is the abstraction made visible. Express gave me:

- `Date` — required by HTTP/1.1 (RFC 7231 §7.1.1.2). I forgot it in the raw version.
- `ETag` — caching support, computed from the body hash.
- `Connection: keep-alive` + `Keep-Alive` — connection reuse. My raw version forces a new TCP handshake per request.
- `X-Powered-By` — framework advertising. Usually you'd turn this off.

## What the raw version forced me to internalize

1. **HTTP is text on top of TCP.** A request is bytes ending in `\r\n\r\n`; a response is bytes starting with a status line. There's no magic.
2. **Line endings matter.** `\r\n`, not `\n`. Get it wrong and clients fail to parse.
3. **`Content-Length` is the contract.** Without it (and without chunked encoding), the client doesn't know when the body ends — which is why I'm also closing the connection.
4. **I'm handling raw `data` events, not "requests".** A real HTTP server would have to buffer until it sees `\r\n\r\n`, parse the request line and headers, possibly read more bytes for the body based on `Content-Length` or `Transfer-Encoding`. I'm cheating by assuming the whole request arrives in one chunk — which usually it does for tiny requests on localhost, but it's not guaranteed.
5. **One connection = one request, by my choice.** No keep-alive, no pipelining. Express handles all of that.

## What Express hides — and the cost

The 8-line Express server is honest about the trade. I get:
- Request parsing (method, path, headers, query, body)
- Routing
- Sensible response defaults
- Keep-alive, chunked encoding, HEAD handling, conditional GET via ETag

In exchange I give up direct control of the bytes. For 99% of work that's the right trade. The point of writing the raw version once is so I know what's underneath when something goes wrong — when a client complains about a missing `Date` header, when a load test reveals I'm not reusing connections, when I need to write SSE and have to send bytes manually anyway (Day 9).

## Connecting to the deck

- **Slides 5–12 (request/response):** the raw version is the pattern in its smallest possible form. Client sends bytes, server sends bytes back, connection closes. That's it.
- **Slides 13–21 (sync vs async):** even my raw server is async — `net.createServer` callbacks, `socket.on('data')`. Node never blocked. Day 3 is where I'll deliberately break that.

## Carry-forward notes

- Node 12 is too old for the rest of the curriculum (worker_threads quirks, http2 ergonomics, modern Express). Upgrade to Node 20 LTS before Day 3.
- For Day 2 I'll keep using Express; the raw server has served its teaching purpose.
