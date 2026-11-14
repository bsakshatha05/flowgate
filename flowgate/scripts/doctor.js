#!/usr/bin/env node
// FlowGate setup check. Run from the flowgate folder:  node scripts/doctor.js
// Prints what is ready, what is optional, and how to fix anything missing.

const fs = require('fs');
const path = require('path');
const net = require('net');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 4000;
let problems = 0;
const ok = (m) => console.log(`  OK    ${m}`);
const warn = (m) => console.log(`  NOTE  ${m}`);
const bad = (m) => { problems++; console.log(`  FIX   ${m}`); };

console.log('\nFlowGate doctor\n');

// 1. Node version (built-in SQLite needs 22.13+ on the 22.x line, or 23.4+)
const [maj, min] = process.versions.node.split('.').map(Number);
const nodeOk = maj > 23 || (maj === 23 && min >= 4) || (maj === 22 && min >= 13);
nodeOk ? ok(`Node.js ${process.version}`) : bad(`Node.js ${process.version} is too old. Install Node 22.13+ (LTS) from https://nodejs.org`);
try { require('node:sqlite'); ok('Built-in SQLite available'); } catch { bad('node:sqlite not available (Node too old)'); }

// 2. Required files
const required = ['server.js', 'src/config.js', 'src/db.js', 'src/simulator.js', 'src/optimizer.js', 'src/copilot.js',
  'public/index.html', 'public/student.html', 'public/gate.html', 'public/admin.html', 'public/sign.html',
  'public/lib/chart.umd.js', 'public/lib/qrcode.js', 'public/lib/jsQR.js'];
const missing = required.filter((f) => !fs.existsSync(path.join(ROOT, f)));
missing.length ? bad(`Missing files: ${missing.join(', ')}. Re-copy the project (public/lib holds the chart and QR libraries).`) : ok('All app files present (including public/lib)');

// 3. Data folder writable
try { fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true }); fs.accessSync(path.join(ROOT, 'data'), fs.constants.W_OK); ok('data/ folder is writable'); }
catch { bad('Cannot write to data/. Move the project somewhere you own (not a read-only or synced folder).'); }

// 4. Optional: Claude SDK + credentials for the AI copilot
let sdk = false; try { require.resolve('@anthropic-ai/sdk', { paths: [ROOT] }); sdk = true; } catch {}
sdk ? ok('Claude SDK installed (AI copilot available)') : warn('Claude SDK not installed. Optional: run `npm install` for AI copilot answers. Offline answers work without it.');
const creds = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE;
creds ? ok('Claude credentials found in environment') : warn('ANTHROPIC_API_KEY not set. Optional: needed only for AI copilot answers (see docs/TECHNICAL.md).');

// 5. Optional: Python for the camera counter
let py = null;
for (const cmd of ['python3 --version', 'python --version']) { try { py = execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim(); break; } catch {} }
py ? ok(`${py} (for yolo/fake_camera.py and yolo/counter.py)`) : warn('Python not found. Optional: only needed for the camera counter scripts.');

// 6. Port free?
const srv = net.createServer();
srv.once('error', () => { warn(`Port ${PORT} is in use. Either FlowGate is already running, or start it on another port: PORT=4100 node server.js`); finish(); });
srv.once('listening', () => { srv.close(); ok(`Port ${PORT} is free`); finish(); });
srv.listen(PORT);

function finish() {
  console.log(problems ? `\n${problems} thing(s) to fix before running.\n` : '\nReady. Start with:  node server.js --reset\n');
  process.exitCode = problems ? 1 : 0;
}
