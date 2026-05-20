const express = require('express');

const app = express();
const PORT = 3001;

app.get('/', (req, res) => res.type('text/plain').send('Hello from Express\n'));

app.listen(PORT, () => console.log(`[express] listening on http://localhost:${PORT}`));
