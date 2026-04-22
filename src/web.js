import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pino from 'pino';
import { Boom } from '@hapi/boom';
import { config } from './config.js';

import {
  makeWASocket,
  useMultiAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  DisconnectReason,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys'
const _makeSock = makeWASocket

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = parseInt(process.env.PORT || '5000', 10);
const logger = pino({ level: 'silent' });

// In-memory pair sessions
// id -> { phone, code, status: 'pairing'|'connected'|'failed', sessionId, error, sock }
const sessions = new Map();

function newId() {
  return Math.random().toString(36).slice(2, 10);
}

async function startPairSession(phone) {
  const id = newId();
  const dir = path.join('/tmp', 'pair-' + id);
  fs.mkdirSync(dir, { recursive: true });

  const session = { id, phone, code: null, status: 'pairing', sessionId: null, error: null, dir, createdAt: Date.now() };
  sessions.set(id, session);

  (async () => {
    try {
      const { state, saveCreds } = await useMultiAuthState('./session')
      const { version } = await fetchLatestBaileysVersion();
      const sock = _makeSock({
        version,
        logger,
        auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
        printQRInTerminal: false,
        browser: Browsers.ubuntu('Chrome'),
        markOnlineOnConnect: false,
      });
      session.sock = sock;
      sock.ev.on('creds.update', saveCreds);

      let codeRequested = false;
      const tryRequestCode = async () => {
        if (codeRequested) return;
        if (sock.authState.creds.registered) return;
        codeRequested = true;
        // small delay to let the noise handshake complete
        await new Promise(r => setTimeout(r, 3000));
        try {
          const code = await sock.requestPairingCode(phone);
          session.code = code?.match(/.{1,4}/g)?.join('-') || code;
          console.log('[pair]', session.id, 'code generated for', phone);
        } catch (e) {
          console.error('[pair]', session.id, 'requestPairingCode failed:', e.message);
          session.error = 'Failed to get pair code: ' + e.message + '. Try again.';
          session.status = 'failed';
        }
      };

      // hard fallback: if no event triggers in 8s, force a request anyway
      setTimeout(tryRequestCode, 8000);

      // request as soon as the socket reports any 'connecting' update with qr potential
      sock.ev.on('connection.update', async (u) => {
        const { connection, lastDisconnect, qr } = u;
        if ((qr || connection === 'connecting') && !codeRequested) {
          tryRequestCode();
        }
        if (connection === 'open') {
          // export creds.json as base64 SESSION_ID
          try {
            const credsPath = path.join(dir, 'creds.json');
            const buf = fs.readFileSync(credsPath);
            session.sessionId = 'TRAILER~' + Buffer.from(buf).toString('base64');
            session.status = 'connected';
            // notify owner
            try {
              await sock.sendMessage(`${phone}@s.whatsapp.net`, {
                text: `*${config.BOT_NAME}* ✅ paired!\n\nCopy this SESSION_ID and save it as a secret named *SESSION_ID* on your hosting:\n\n${session.sessionId}`,
              });
            } catch {}
            // close the pair socket cleanly after 5s
            setTimeout(() => { try { sock.end(); } catch {} }, 5000);
          } catch (e) {
            session.error = e.message;
            session.status = 'failed';
          }
        } else if (connection === 'close') {
          const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
          if (session.status !== 'connected' && code === DisconnectReason.loggedOut) {
            session.status = 'failed';
            session.error = 'Pair code expired. Please try again.';
          }
        }
      });
    } catch (e) {
      session.status = 'failed';
      session.error = e.message;
    }
  })();

  return id;
}

// Periodic cleanup of old sessions
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.createdAt > 15 * 60 * 1000) {
      try { s.sock?.end(); } catch {}
      try { fs.rmSync(s.dir, { recursive: true, force: true }); } catch {}
      sessions.delete(id);
    }
  }
}, 60 * 1000);

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (_req, res) => res.type('html').send(renderHome()));

app.post('/api/pair', async (req, res) => {
  const phone = String(req.body.phone || '').replace(/\D/g, '');
  if (!phone || phone.length < 8) {
    return res.status(400).json({ error: 'Enter a valid phone number with country code (digits only).' });
  }
  const id = await startPairSession(phone);
  res.json({ id });
});

app.get('/api/status/:id', (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Session not found or expired.' });
  res.json({
    status: s.status,
    code: s.code,
    sessionId: s.sessionId,
    error: s.error,
    phone: s.phone,
  });
});

app.get('/healthz', (_req, res) => res.json({ ok: true, bot: config.BOT_NAME }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[web] ${config.BOT_NAME} pair server on :${PORT}`);
});

// If SESSION_ID is set as env var, also start the bot in-process
if (process.env.SESSION_ID) {
  console.log('[boot] SESSION_ID found in env — launching bot.');
  import('./index.js').catch((e) => console.error('bot boot failed', e));
} else {
  console.log('[boot] No SESSION_ID set. Visit the web page to pair and obtain one.');
}

function renderHome() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${config.BOT_NAME} — Pair</title>
<style>
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body {
  margin: 0; min-height: 100vh; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  background: radial-gradient(1200px 600px at 10% -20%, #1d2540 0%, transparent 60%),
              radial-gradient(800px 500px at 110% 110%, #3a1d40 0%, transparent 55%),
              #0b0d14;
  color: #e6e8ef; display: flex; align-items: center; justify-content: center; padding: 24px;
}
.card {
  width: 100%; max-width: 460px; background: #11141d; border: 1px solid #232838;
  border-radius: 18px; padding: 28px; box-shadow: 0 25px 60px rgba(0,0,0,.5);
}
h1 { margin: 0 0 4px; font-size: 22px; letter-spacing: .5px; }
h1 span { color: #6ee7b7; }
.sub { margin: 0 0 22px; color: #8b93a7; font-size: 14px; }
label { display: block; font-size: 13px; color: #b8bfd1; margin-bottom: 6px; }
input, button {
  width: 100%; font: inherit; border-radius: 10px; padding: 13px 14px; border: 1px solid #2a3045;
  background: #0c0f17; color: #fff; outline: none;
}
input::placeholder { color: #5a6178; }
input:focus { border-color: #6ee7b7; }
button {
  margin-top: 14px; cursor: pointer; background: linear-gradient(135deg, #6ee7b7, #3b82f6);
  color: #0b0d14; font-weight: 700; border: 0; transition: transform .08s ease;
}
button:hover { transform: translateY(-1px); }
button:disabled { opacity: .6; cursor: not-allowed; }
.code-box {
  margin-top: 22px; padding: 18px; border-radius: 12px; background: #0c0f17;
  border: 1px dashed #3a4360; text-align: center;
}
.code { font-size: 30px; letter-spacing: 6px; font-weight: 800; color: #6ee7b7; }
.status { margin-top: 12px; color: #b8bfd1; font-size: 13px; }
.session {
  margin-top: 18px; word-break: break-all; background: #0c0f17; padding: 14px;
  border-radius: 10px; border: 1px solid #2a3045; font-size: 12px; color: #e6e8ef;
  max-height: 180px; overflow: auto;
}
.copy { margin-top: 10px; background: #232838; color: #fff; }
.err { color: #ff8aa6; margin-top: 10px; font-size: 13px; }
.foot { margin-top: 18px; font-size: 11px; color: #5a6178; text-align: center; }
.kbd { background:#1b2030; border:1px solid #2a3045; padding:2px 6px; border-radius:6px; font-family: ui-monospace, monospace; font-size:11px; }
</style>
</head>
<body>
<div class="card">
  <h1><span>${config.BOT_NAME}</span> · Pair</h1>
  <p class="sub">Enter your WhatsApp number with country code. You'll get a pair code to enter under <span class="kbd">Linked devices → Link with phone number</span>.</p>

  <div id="step1">
    <label for="phone">Phone number (digits only)</label>
    <input id="phone" inputmode="numeric" placeholder="e.g. 256706106326" autocomplete="off">
    <button id="go">Get pair code</button>
    <div id="err1" class="err"></div>
  </div>

  <div id="step2" style="display:none">
    <div class="code-box">
      <div class="code" id="code">— — — —</div>
      <div class="status" id="status">Requesting code…</div>
    </div>
    <div id="sessionWrap" style="display:none">
      <p class="sub" style="margin-top:18px">✅ Connected. Save this as a secret named <b>SESSION_ID</b> on your hosting:</p>
      <div class="session" id="session"></div>
      <button class="copy" id="copy">Copy SESSION_ID</button>
    </div>
    <div id="err2" class="err"></div>
  </div>

  <div class="foot">${config.BOT_NAME} · Baileys MD</div>
</div>
<script>
const $ = (id) => document.getElementById(id);
let pollTimer = null;

$('go').onclick = async () => {
  const phone = $('phone').value.replace(/\\D/g,'');
  $('err1').textContent = '';
  if (!phone || phone.length < 8) { $('err1').textContent = 'Enter a valid number with country code.'; return; }
  $('go').disabled = true; $('go').textContent = 'Working…';
  try {
    const r = await fetch('/api/pair', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ phone })});
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Failed');
    $('step1').style.display = 'none'; $('step2').style.display = 'block';
    poll(j.id);
  } catch (e) {
    $('err1').textContent = e.message;
    $('go').disabled = false; $('go').textContent = 'Get pair code';
  }
};

function poll(id) {
  pollTimer = setInterval(async () => {
    try {
      const r = await fetch('/api/status/' + id);
      if (!r.ok) throw new Error('Session expired.');
      const j = await r.json();
      if (j.code) $('code').textContent = j.code;
      if (j.status === 'pairing') $('status').textContent = j.code ? 'Enter the code in WhatsApp now.' : 'Requesting code…';
      if (j.status === 'connected') {
        clearInterval(pollTimer);
        $('status').textContent = 'Paired ✅';
        $('sessionWrap').style.display = 'block';
        $('session').textContent = j.sessionId;
      }
      if (j.status === 'failed') {
        clearInterval(pollTimer);
        $('status').textContent = '';
        $('err2').textContent = j.error || 'Pairing failed. Try again.';
      }
    } catch (e) {
      clearInterval(pollTimer);
      $('err2').textContent = e.message;
    }
  }, 1500);
}

$('copy').onclick = async () => {
  await navigator.clipboard.writeText($('session').textContent);
  $('copy').textContent = 'Copied ✓';
  setTimeout(() => $('copy').textContent = 'Copy SESSION_ID', 1500);
};
</script>
</body>
</html>`;
}
