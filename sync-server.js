/**
 * sync-server.js - ZenMatrix Local Network Sync Server
 * Runs a dependency-free Node.js HTTP server on your local Wi-Fi network.
 * Allows multiple local PWA clients (laptop, phone, tablet) to sync tasks.
 * 
 * Run with: node sync-server.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const DATA_DIR = path.join(__dirname, 'sync_data');

// Ensure sync data persistence directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
}

// Regex to match client sync endpoints: /sync/<key>
const SYNC_ROUTE_REGEX = /^\/sync\/([a-zA-Z0-9_-]+)$/;

const server = http.createServer((req, res) => {
  // 1. Setup CORS Headers (allows client PWA to talk to local server)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle CORS preflight pre-requests
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const match = req.url.match(SYNC_ROUTE_REGEX);
  
  if (match) {
    const syncKey = match[1];
    const filePath = path.join(DATA_DIR, `${syncKey}.json`);

    // ==========================================
    // GET /sync/:key - Retrieve synced tasks
    // ==========================================
    if (req.method === 'GET') {
      console.log(`[SyncServer] [GET] SyncKey: ${syncKey}`);
      
      fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) {
          // File does not exist yet (first time sync)
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ tasks: [], timestamp: 0 }));
          return;
        }
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(data);
      });
      return;
    }

    // ==========================================
    // POST /sync/:key - Upload updated tasks
    // ==========================================
    if (req.method === 'POST') {
      let body = '';
      
      req.on('data', chunk => {
        body += chunk.toString();
      });
      
      req.on('end', () => {
        try {
          // Validate incoming JSON
          const payload = JSON.parse(body);
          if (!payload.tasks || !Array.isArray(payload.tasks)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid payload: tasks must be an array.' }));
            return;
          }

          console.log(`[SyncServer] [POST] SyncKey: ${syncKey} - Persisting ${payload.tasks.length} tasks`);
          
          // Write payload to JSON file
          fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8', (err) => {
            if (err) {
              console.error('[SyncServer] Write failed:', err);
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Failed to write sync database' }));
              return;
            }
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'success', timestamp: payload.timestamp || Date.now() }));
          });
          
        } catch (e) {
          console.error('[SyncServer] JSON Parse Error:', e);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Malformed JSON payload.' }));
        }
      });
      return;
    }
  }

  // Handle generic 404
  console.log(`[SyncServer] 404 Not Found: ${req.method} ${req.url}`);
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Route not found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('====================================================');
  console.log(` ZenMatrix Sync Server is active!`);
  console.log(` Listening on: http://localhost:${PORT}`);
  console.log(` Local Network Access: http://<YOUR-IP-ADDRESS>:${PORT}`);
  console.log('====================================================');
  console.log(' To find your Local IP Address, run ipconfig (Windows) or ifconfig (Mac/Linux).');
  console.log(' Make sure your mobile phone is connected to the SAME Wi-Fi network.');
  console.log('====================================================');
});
