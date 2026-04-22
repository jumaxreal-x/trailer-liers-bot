import express from "express";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pino from "pino";
import { Boom } from "@hapi/boom";
import {
  default as makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  DisconnectReason,
  jidNormalizedUser,
} from "@whiskeysockets/baileys";
import { GoogleGenerativeAI } from "@google/generative-ai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = pino({ level: "silent" });

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY || "AIzaSyBUXGHFFzcP7Qz_pqXaHPyTgYVQ03Tmu3s";
const PREFIX = process.env.PREFIX || ".";
const SESSION_DIR = process.env.SESSION_DIR || path.join(__dirname, "session");
const STATE_FILE = path.join(__dirname, "state.json");
const HISTORY_FILE = path.join(__dirname, "history.json");
const MAX_HISTORY_PER_CHAT = 30;

if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function saveJson(file, data) {
  fsp.writeFile(file, JSON.stringify(data, null, 2)).catch(() => {});
}

const state = loadJson(STATE_FILE, { aion: false });
const history = loadJson(HISTORY_FILE, {});

function recordHistory(chatId, role, text) {
  if (!text) return;
  if (!history[chatId]) history[chatId] = [];
  history[chatId].push({ role, text, ts: Date.now() });
  if (history[chatId].length > MAX_HISTORY_PER_CHAT) {
    history[chatId] = history[chatId].slice(-MAX_HISTORY_PER_CHAT);
  }
  saveJson(HISTORY_FILE, history);
}

const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

async function askGemini(chatId, incomingText) {
  if (!genAI) return null;
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
  const past = (history[chatId] || []).slice(-20);
  const contents = past.map((m) => ({
    role: m.role === "me" ? "model" : "user",
    parts: [{ text: m.text }],
  }));
  contents.push({ role: "user", parts: [{ text: incomingText }] });
  const result = await model.generateContent({
    contents,
    systemInstruction: {
      role: "system",
      parts: [{
        text: "You are replying on behalf of the user in a WhatsApp chat. Match the user's tone and style based on the past messages they've sent. Keep replies short, natural, casual, and human — no preamble, no 'as an AI'. Reply in the language of the incoming message.",
      }],
    },
  });
  return result.response.text().trim();
}

function suggestFromHistory(chatId, incomingText) {
  const past = history[chatId] || [];
  const myPast = past.filter((m) => m.role === "me").map((m) => m.text);
  if (myPast.length === 0) return null;
  const lower = incomingText.toLowerCase();
  const match = myPast.slice().reverse().find((t) => {
    const words = lower.split(/\s+/).filter((w) => w.length > 3);
    return words.some((w) => t.toLowerCase().includes(w));
  });
  return match || myPast[myPast.length - 1];
}

function extractText(message) {
  if (!message) return "";
  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.ephemeralMessage?.message?.conversation ||
    message.ephemeralMessage?.message?.extendedTextMessage?.text ||
    ""
  );
}

let sock = null;
let pairingCode = null;
let pairingNumber = null;
let pendingPairNumber = null;
let connected = false;
let restarting = false;

async function startBot() {
  if (restarting) return;
  const { state: authState, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    logger: log,
    printQRInTerminal: false,
    auth: authState,
    browser: Browsers.macOS("Safari"),
    markOnlineOnConnect: true,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    connectTimeoutMs: 60_000,
    defaultQueryTimeoutMs: 60_000,
    keepAliveIntervalMs: 25_000,
    getMessage: async () => ({ conversation: "" }),
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // The socket is ready for pairing when a QR is offered.
    if (qr && pendingPairNumber && !sock.authState.creds.registered) {
      const num = pendingPairNumber;
      pendingPairNumber = null;
      try {
        await new Promise((r) => setTimeout(r, 500));
        const raw = await sock.requestPairingCode(num);
        pairingCode = raw.match(/.{1,4}/g)?.join("-") ?? raw;
        pairingNumber = num;
        console.log(`[pair] Code for ${num}: ${pairingCode}`);
      } catch (e) {
        console.error("[pair] Failed:", e?.message || e);
        pairingCode = null;
      }
    }

    if (connection === "open") {
      connected = true;
      pairingCode = null;
      pendingPairNumber = null;
      console.log("[bot] Connected as", sock.user?.id);
    }
    if (connection === "close") {
      connected = false;
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      console.log("[bot] Connection closed (code", code, "). Reconnect:", shouldReconnect);
      if (code === DisconnectReason.loggedOut) {
        try { await fsp.rm(SESSION_DIR, { recursive: true, force: true }); } catch {}
        try { await fsp.mkdir(SESSION_DIR, { recursive: true }); } catch {}
      }
      if (shouldReconnect) setTimeout(() => startBot().catch(console.error), 1500);
    }
  });

  sock.ev.on("messages.update", async (updates) => {
    for (const u of updates) {
      const edited =
        u.update?.message?.editedMessage?.message ||
        u.update?.message?.protocolMessage?.editedMessage;
      if (!edited) continue;
      const newText = extractText(edited);
      if (!newText) continue;
      const chatId = u.key.remoteJid;
      try {
        await sock.sendMessage(chatId, {
          text: `*✏️ Edited message detected*\n\nNew text:\n${newText}`,
        });
      } catch {}
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      try {
        if (!msg.message) continue;
        const chatId = msg.key.remoteJid;
        if (!chatId || chatId === "status@broadcast") continue;
        const text = extractText(msg.message).trim();
        if (!text) continue;

        const isFromMe = !!msg.key.fromMe;
        recordHistory(chatId, isFromMe ? "me" : "them", text);

        if (isFromMe && text.startsWith(PREFIX)) {
          const cmd = text.slice(PREFIX.length).trim().split(/\s+/)[0]?.toLowerCase();
          if (cmd === "aion") {
            state.aion = true; saveJson(STATE_FILE, state);
            await sock.sendMessage(chatId, { text: "🤖 AI auto-reply: *ON* (Gemini)" });
            continue;
          }
          if (cmd === "aioff") {
            state.aion = false; saveJson(STATE_FILE, state);
            await sock.sendMessage(chatId, { text: "💤 AI auto-reply: *OFF*. Replies will now suggest from past conversations." });
            continue;
          }
          if (cmd === "aistatus") {
            await sock.sendMessage(chatId, { text: `AI auto-reply is *${state.aion ? "ON" : "OFF"}*` });
            continue;
          }
        }

        const isGroup = chatId.endsWith("@g.us");
        if (isFromMe || isGroup) continue;

        let reply = null;
        if (state.aion) {
          try { reply = await askGemini(chatId, text); }
          catch (e) { console.error("Gemini error:", e?.message || e); }
        } else {
          reply = suggestFromHistory(chatId, text);
        }

        if (reply) {
          await sock.sendMessage(chatId, { text: reply });
          recordHistory(chatId, "me", reply);
        }
      } catch (e) {
        console.error("Handler error:", e?.message || e);
      }
    }
  });

  return sock;
}

async function requestPairing(number) {
  const cleaned = String(number || "").replace(/[^0-9]/g, "");
  if (!cleaned || cleaned.length < 8) throw new Error("Enter a valid number with country code (digits only).");
  if (connected) throw new Error("Already paired and connected.");

  // Wipe any previous half-paired session so each request gets a fresh code.
  try {
    restarting = true;
    if (sock) { try { sock.end(); } catch {} sock = null; }
    await fsp.rm(SESSION_DIR, { recursive: true, force: true });
    await fsp.mkdir(SESSION_DIR, { recursive: true });
  } finally {
    restarting = false;
  }

  pairingCode = null;
  pairingNumber = null;
  pendingPairNumber = cleaned;

  await startBot();

  // Wait up to 25s for connection.update -> qr to fire and produce the code.
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    if (pairingCode) return pairingCode;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("Timed out generating code. Try again.");
}

const app = express();
app.use(express.json());

app.get("/", (_req, res) => {
  res.type("html").send(PAGE);
});

app.get("/api/status", (_req, res) => {
  res.json({
    connected,
    pairingCode,
    pairingNumber,
    aion: state.aion,
  });
});

app.post("/api/pair", async (req, res) => {
  try {
    const code = await requestPairing(req.body?.number);
    res.json({ code });
  } catch (e) {
    res.status(400).json({ error: e?.message || "Failed to pair" });
  }
});

app.get("/healthz", (_req, res) => res.json({ status: "ok" }));

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Trailer Bot · Pair</title>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:radial-gradient(circle at 20% 0%,#1f3a5f 0%,#0a0f1c 60%,#05070d 100%);color:#e8edf5}
body{display:flex;align-items:center;justify-content:center;padding:24px}
.card{width:100%;max-width:460px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:18px;padding:32px;backdrop-filter:blur(12px);box-shadow:0 20px 60px rgba(0,0,0,0.4)}
h1{margin:0 0 6px;font-size:22px;font-weight:600}
p.sub{margin:0 0 24px;color:#9aa6b8;font-size:14px;line-height:1.5}
label{display:block;font-size:12px;color:#9aa6b8;margin-bottom:8px;letter-spacing:.04em;text-transform:uppercase}
input{width:100%;padding:14px 16px;font-size:16px;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.25);color:#fff;outline:none}
input:focus{border-color:#4f8cff}
button{margin-top:18px;width:100%;padding:14px 16px;font-size:16px;font-weight:600;border:0;border-radius:10px;background:linear-gradient(135deg,#4f8cff,#2a5fd1);color:#fff;cursor:pointer}
button:disabled{opacity:.6;cursor:not-allowed}
.box{margin-top:22px;padding:18px;border-radius:12px;text-align:center;display:none}
.box.show{display:block}
.code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:28px;font-weight:700;letter-spacing:.12em;color:#fff;margin:8px 0 4px}
.hint{color:#9aa6b8;font-size:12px;line-height:1.5}
.ok{background:rgba(40,200,120,0.08);border:1px solid rgba(40,200,120,0.3);color:#9be7b8}
.info{background:rgba(79,140,255,0.08);border:1px solid rgba(79,140,255,0.25)}
.err{background:rgba(255,80,80,0.08);border:1px solid rgba(255,80,80,0.3);color:#ffb4b4;font-size:14px;padding:12px 14px;border-radius:10px;margin-top:18px;display:none}
.err.show{display:block}
.pill{display:inline-block;padding:4px 10px;border-radius:999px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;background:rgba(255,255,255,0.08);color:#9aa6b8;margin-bottom:14px}
footer{margin-top:18px;font-size:11px;color:#6b7588;text-align:center}
</style>
</head>
<body>
<div class="card">
  <span class="pill" id="status-pill">checking…</span>
  <h1>Pair Trailer Bot</h1>
  <p class="sub">Enter your WhatsApp number with country code (digits only). You'll get an 8-character code to enter in WhatsApp → Settings → Linked Devices → Link with phone number.</p>

  <div id="connected-box" class="box ok">
    <div class="hint">Status</div>
    <div class="code" style="font-size:18px">✅ Bot is paired and online</div>
    <div class="hint">Send <b>.aion</b> to yourself on WhatsApp to enable AI auto-reply, <b>.aioff</b> to disable.</div>
  </div>

  <form id="form">
    <label for="number">Phone number</label>
    <input id="number" inputmode="numeric" placeholder="e.g. 2348012345678" required />
    <button id="submit" type="submit">Get pairing code</button>
  </form>

  <div class="err" id="error"></div>

  <div class="box info" id="result">
    <div class="hint">Your pairing code</div>
    <div class="code" id="code">----</div>
    <div class="hint">Code expires in ~60 seconds. Once linked, this page will show "online".</div>
  </div>

  <footer>Trailer Bot · Baileys + Gemini</footer>
</div>
<script>
const pill = document.getElementById('status-pill');
const form = document.getElementById('form');
const btn = document.getElementById('submit');
const errEl = document.getElementById('error');
const resEl = document.getElementById('result');
const codeEl = document.getElementById('code');
const connBox = document.getElementById('connected-box');

async function refresh(){
  try{
    const r = await fetch('/api/status'); const s = await r.json();
    if(s.connected){
      pill.textContent='online'; pill.style.color='#9be7b8';
      connBox.classList.add('show'); form.style.display='none'; resEl.classList.remove('show');
    } else {
      pill.textContent='not paired'; pill.style.color='#ffb4b4';
      connBox.classList.remove('show'); form.style.display='block';
      if(s.pairingCode){ codeEl.textContent = s.pairingCode; resEl.classList.add('show'); }
    }
  }catch{}
}
setInterval(refresh, 3000); refresh();

form.addEventListener('submit', async (e)=>{
  e.preventDefault(); errEl.classList.remove('show'); resEl.classList.remove('show');
  const number = document.getElementById('number').value.replace(/[^0-9]/g,'');
  if(!number){ errEl.textContent='Please enter a valid number.'; errEl.classList.add('show'); return; }
  btn.disabled=true; btn.textContent='Generating…';
  try{
    const r = await fetch('/api/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({number})});
    const data = await r.json(); if(!r.ok) throw new Error(data.error||'Failed');
    codeEl.textContent = data.code; resEl.classList.add('show');
  }catch(err){ errEl.textContent = err.message||'Something went wrong.'; errEl.classList.add('show'); }
  finally{ btn.disabled=false; btn.textContent='Get pairing code'; }
});
</script>
</body>
</html>`;

app.listen(PORT, () => console.log(`[web] listening on ${PORT}`));

// If we already have a saved session, resume it on boot.
if (fs.existsSync(path.join(SESSION_DIR, "creds.json"))) {
  startBot().catch((e) => console.error("Resume failed:", e));
}
