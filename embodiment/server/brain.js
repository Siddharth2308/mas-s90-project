// Vite plugin: runs the robot's "brain" next to the dev server.
//   POST /api/ask   {text}  -> streams NDJSON lines: {"delta": "..."} ... {"done": true}
//   POST /api/reset         -> new visitor, fresh conversation
//   POST /api/tts   {text}  -> audio/wav from the local Piper server (if installed)
//
// The brain is one long-running headless Claude Code process (Haiku) with every tool,
// MCP server, setting and slash command turned off, running inside ./quarantine.
// Visitors can only talk to it; it can't touch the laptop.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import readline from 'node:readline';

const ROOT = resolve(import.meta.dirname, '..');
const QUARANTINE = resolve(ROOT, 'quarantine');
const MODEL = process.env.BRAIN_MODEL ?? 'haiku';
const IDLE_RESET_MS = 120_000; // nobody talked for 2 min -> next visitor starts fresh
const MAX_TURNS = 20;          // keep the context short (and fast)

const PIPER_PORT = 5181;
const PIPER_PY = resolve(ROOT, 'tts/.venv/bin/python');
const PIPER_VOICE = resolve(ROOT, 'tts/voices', `${process.env.PIPER_VOICE ?? 'en_US-ryan-medium'}.onnx`);

class Claude {
  constructor() {
    this.proc = null;
    this.turn = null;  // { onDelta, resolve, reject }
    this.queue = Promise.resolve();
    this.turns = 0;
    this.idleTimer = null;
  }

  start() {
    const args = [
      '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      '--include-partial-messages', '--model', MODEL,
      '--tools', '', '--strict-mcp-config', '--setting-sources', '', '--disable-slash-commands',
      '--no-session-persistence', '--system-prompt-file', resolve(QUARANTINE, 'persona.md'),
    ];
    const proc = spawn('claude', args, { cwd: QUARANTINE, stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc = proc;
    this.turns = 0;
    proc.stderr.on('data', (d) => console.error('[brain]', d.toString().trim()));
    proc.stdin.on('error', () => {}); // process died; 'exit'/'error' below handle it
    const died = (why) => {
      if (this.proc !== proc) return; // an old process we replaced
      this.proc = null;
      this.turn?.reject(new Error(why));
      this.turn = null;
    };
    proc.on('exit', (code) => died(`claude exited (${code})`));
    proc.on('error', (e) => {
      console.error(`[brain] can't run Claude Code (${e.code}), canned lines only`);
      died(e.code);
    });
    readline.createInterface({ input: proc.stdout }).on('line', (line) => {
      if (this.proc !== proc) return;
      let m;
      try { m = JSON.parse(line); } catch { return; }
      const t = this.turn;
      if (!t) return;
      if (m.type === 'stream_event' && m.event?.delta?.type === 'text_delta') t.onDelta(m.event.delta.text);
      if (m.type === 'result') { this.turn = null; m.is_error ? t.reject(new Error(m.result)) : t.resolve(); }
    });
  }

  reset() {
    this.turn?.reject(new Error('reset'));
    this.turn = null;
    this.proc?.kill();
    this.proc = null;
    this.start(); // warm for the next visitor
  }

  // One question at a time; later ones wait their turn.
  ask(text, onDelta) {
    const run = () => new Promise((res, rej) => {
      clearTimeout(this.idleTimer);
      if (!this.proc || this.turns >= MAX_TURNS) this.reset();
      this.turns++;
      this.turn = { onDelta, resolve: res, reject: rej };
      this.proc.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n');
    }).finally(() => {
      this.idleTimer = setTimeout(() => this.reset(), IDLE_RESET_MS);
    });
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }
}

function readJson(req) {
  return new Promise((res, rej) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => { try { res(JSON.parse(body || '{}')); } catch (e) { rej(e); } });
  });
}

function startPiper() {
  if (!existsSync(PIPER_PY) || !existsSync(PIPER_VOICE)) {
    console.log('[tts] Piper not installed, the browser voice will be used (see README)');
    return null;
  }
  const proc = spawn(PIPER_PY, ['server.py', String(PIPER_PORT), PIPER_VOICE], { cwd: resolve(ROOT, 'tts'), stdio: ['pipe', 'pipe', 'pipe'] }); // exits when its stdin closes
  proc.on('error', (e) => console.error(`[tts] can't start Piper (${e.code})`));
  proc.stdout.on('data', (d) => console.log('[tts]', d.toString().trim()));
  proc.stderr.on('data', (d) => console.error('[tts]', d.toString().trim()));
  return proc;
}

export function brain() {
  return {
    name: 'brain',
    configureServer(server) {
      const claude = new Claude();
      claude.start();
      const piper = startPiper();
      const stop = () => { claude.proc?.kill(); piper?.kill(); };
      server.httpServer?.on('close', stop);
      process.once('exit', stop);

      server.middlewares.use('/api/ask', async (req, res) => {
        const { text } = await readJson(req);
        res.setHeader('Content-Type', 'application/x-ndjson');
        res.setHeader('Cache-Control', 'no-cache');
        const send = (o) => res.write(JSON.stringify(o) + '\n');
        try {
          await claude.ask(text, (delta) => send({ delta }));
          send({ done: true });
        } catch (e) {
          send({ error: e.message });
        }
        res.end();
      });

      server.middlewares.use('/api/reset', (req, res) => {
        claude.reset();
        res.end('ok');
      });

      server.middlewares.use('/api/tts', async (req, res) => {
        try {
          const r = await fetch(`http://127.0.0.1:${PIPER_PORT}/tts`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(await readJson(req)),
          });
          res.setHeader('Content-Type', 'audio/wav');
          res.end(Buffer.from(await r.arrayBuffer()));
        } catch {
          res.statusCode = 503;
          res.end('no tts');
        }
      });
    },
  };
}
