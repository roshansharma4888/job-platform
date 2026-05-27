// Runs inside a worker_threads Worker. It has its own V8 isolate and event loop,
// on its own OS thread — so the burn loop here cannot block the main thread.
// It talks to the main thread only through messages: a progress update after
// each chunk, then a final done message with the result.

const { parentPort, workerData } = require('worker_threads');
const { burnChunk } = require('./cpu-task');

const { chunks, roundsPerChunk } = workerData;

let h;
for (let i = 1; i <= chunks; i++) {
  h = burnChunk(roundsPerChunk, h);
  parentPort.postMessage({ type: 'progress', progress: Math.round((i / chunks) * 100) });
}

parentPort.postMessage({
  type: 'done',
  result: { digest: h.toString('hex').slice(0, 16) },
});
