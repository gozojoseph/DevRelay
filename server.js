// DevRelay Cloud demo app — deployed through the product path to prove the
// full pipeline: dashboard -> Render worker -> host agent -> live HTTPS.
const http = require('node:http');

const port = Number(process.env.PORT) || 3000;
const started = new Date().toISOString();

http
  .createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`DevRelay Cloud demo is live! (started ${started})\n`);
  })
  .listen(port, '0.0.0.0', () => {
    console.log(`devrelay-demo listening on 0.0.0.0:${port}`);
  });
