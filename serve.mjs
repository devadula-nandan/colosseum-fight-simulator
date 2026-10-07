// Tiny static server for local testing: node serve.mjs  ->  http://localhost:8765
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.gltf': 'model/gltf+json', '.glb': 'model/gltf-binary',
  '.bin': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg', '.hdr': 'application/octet-stream', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg' };
createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname).slice(1);
  try {
    const file = normalize(join(root, path || 'index.html'));
    if (!file.startsWith(root)) throw new Error('outside root');
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }).end(data);
  } catch { res.writeHead(404).end('not found'); }
}).listen(8765, () => console.log('http://localhost:8765'));
