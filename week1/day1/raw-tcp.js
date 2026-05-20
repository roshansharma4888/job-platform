const net = require('net');

const PORT = 3000;

const server = net.createServer((socket) => {
  socket.on('data', (chunk) => {
    const requestLine = chunk.toString().split('\r\n')[0];
    console.log('[raw-tcp] request:', requestLine);

    const body = 'Hello from raw TCP\n';
    const response =
      'HTTP/1.1 200 OK\r\n' +
      'Content-Type: text/plain; charset=utf-8\r\n' +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      'Connection: close\r\n' +
      '\r\n' +
      body;

    socket.write(response);
    socket.end();
  });

  socket.on('error', (err) => console.error('[raw-tcp] socket error:', err.message));
});

server.listen(PORT, () => {
  console.log(`[raw-tcp] listening on http://localhost:${PORT}`);
});
