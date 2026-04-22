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
  downloadMediaMessage,
} from "@whiskeysockets/baileys";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { Sticker, StickerTypes } from "wa-sticker-formatter";
import QRCode from "qrcode";
import { translate } from "@vitalets/google-translate-api";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = pino({ level: "silent" });

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const PREFIX = process.env.PREFIX || ".";
const OWNER_NAME = process.env.OWNER_NAME || "Trailer Liers";
const OWNER_NUMBER = process.env.OWNER_NUMBER || "";
const BOT_NAME = process.env.BOT_NAME || "Trailer Liers Bot";
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

const defaults = {
  aion: false,
  mode: "private",          // private = only owner can use; public = anyone
  autoread: false,
  autoreact: false,
  autotyping: false,
  antidelete: true,
  anticall: false,
  pmblocker: false,
  autostatus: "off",        // off | view | react
  antilink: {},             // { groupJid: true }
  antibadword: {},
  welcome: {},
  goodbye: {},
};
const state = Object.assign({}, defaults, loadJson(STATE_FILE, {}));
const history = loadJson(HISTORY_FILE, {});

function persist() { saveJson(STATE_FILE, state); }

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

async function askGemini(chatId, incomingText, systemHint) {
  if (!genAI) throw new Error("GEMINI_API_KEY env var is not set.");
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
      parts: [{ text: systemHint || "You are replying on behalf of the user in a WhatsApp chat. Match their tone. Keep replies short, casual, human. Reply in the language of the incoming message." }],
    },
  });
  return result.response.text().trim();
}

function suggestFromHistory(chatId, incomingText) {
  const past = history[chatId] || [];
  const myPast = past.filter((m) => m.role === "me").map((m) => m.text);
  if (!myPast.length) return null;
  const lower = incomingText.toLowerCase();
  return (
    myPast.slice().reverse().find((t) => {
      const words = lower.split(/\s+/).filter((w) => w.length > 3);
      return words.some((w) => t.toLowerCase().includes(w));
    }) || myPast[myPast.length - 1]
  );
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

const BAD_WORDS = ["fuck","shit","bitch","asshole","dick","pussy","cunt","slut","retard"];
const REACTIONS = ["👍","❤️","😂","🔥","🙏","💯","😮","🎉","✅","👀"];
const triviaAnswers = {};
const ticTacToe = {};

function decodeHtml(s) {
  return String(s).replace(/&quot;/g,'"').replace(/&#039;/g,"'").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">");
}
function renderBoard(b) {
  return ` ${b[0]} | ${b[1]} | ${b[2]}\n-----------\n ${b[3]} | ${b[4]} | ${b[5]}\n-----------\n ${b[6]} | ${b[7]} | ${b[8]}`;
}
function ticWinner(b) {
  const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  for (const [a,c,d] of lines) if (b[a] === b[c] && b[c] === b[d] && (b[a] === "X" || b[a] === "O")) return b[a];
  return null;
}

let sock = null;
let pairingCode = null;
let pairingNumber = null;
let pendingPairNumber = null;
let connected = false;
let restarting = false;
let botJid = null;

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
      botJid = sock.user?.id?.split(":")[0] + "@s.whatsapp.net";
      console.log("[bot] Connected as", sock.user?.id);
    }
    if (connection === "close") {
      connected = false;
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      console.log("[bot] Closed (code", code, "). Reconnect:", shouldReconnect);
      if (code === DisconnectReason.loggedOut) {
        try { await fsp.rm(SESSION_DIR, { recursive: true, force: true }); } catch {}
        try { await fsp.mkdir(SESSION_DIR, { recursive: true }); } catch {}
      }
      if (shouldReconnect) setTimeout(() => startBot().catch(console.error), 1500);
    }
  });

  // Anti-call
  sock.ev.on("call", async (calls) => {
    if (!state.anticall) return;
    for (const c of calls) {
      try {
        if (c.status === "offer") {
          await sock.rejectCall(c.id, c.from);
          await sock.sendMessage(c.from, { text: "📵 Calls are blocked by the bot owner." });
        }
      } catch {}
    }
  });

  // Group participant updates (welcome / goodbye)
  sock.ev.on("group-participants.update", async (ev) => {
    try {
      const { id, participants, action } = ev;
      if (action === "add" && state.welcome[id]) {
        for (const p of participants) {
          await sock.sendMessage(id, { text: `👋 Welcome @${p.split("@")[0]}!`, mentions: [p] });
        }
      }
      if (action === "remove" && state.goodbye[id]) {
        for (const p of participants) {
          await sock.sendMessage(id, { text: `👋 Goodbye @${p.split("@")[0]}.`, mentions: [p] });
        }
      }
    } catch {}
  });

  // Antidelete
  sock.ev.on("messages.update", async (updates) => {
    for (const u of updates) {
      try {
        const edited =
          u.update?.message?.editedMessage?.message ||
          u.update?.message?.protocolMessage?.editedMessage;
        if (edited) {
          const newText = extractText(edited);
          if (newText) {
            await sock.sendMessage(u.key.remoteJid, { text: `*✏️ Edited message*\n\n${newText}` });
          }
          continue;
        }
        // Detect deletion (protocolMessage type = REVOKE)
        const proto = u.update?.message?.protocolMessage;
        if (state.antidelete && proto && proto.type === 0) {
          await sock.sendMessage(u.key.remoteJid, { text: `*🗑️ A message was deleted in this chat.*` });
        }
      } catch {}
    }
  });

  // Auto-status
  sock.ev.on("messages.upsert", async ({ messages }) => {
    for (const msg of messages) {
      try {
        if (msg.key?.remoteJid === "status@broadcast" && state.autostatus !== "off") {
          await sock.readMessages([msg.key]);
          if (state.autostatus === "react" && msg.key?.participant) {
            try {
              await sock.sendMessage(msg.key.remoteJid, {
                react: { key: msg.key, text: "💚" },
              }, { statusJidList: [msg.key.participant] });
            } catch {}
          }
        }
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

        const isFromMe = !!msg.key.fromMe;
        const isGroup = chatId.endsWith("@g.us");
        const sender = msg.key.participant || msg.key.remoteJid;

        if (text) recordHistory(chatId, isFromMe ? "me" : "them", text);

        // Auto-read
        if (state.autoread && !isFromMe) {
          try { await sock.readMessages([msg.key]); } catch {}
        }
        // Auto-react
        if (state.autoreact && !isFromMe) {
          try {
            const r = REACTIONS[Math.floor(Math.random() * REACTIONS.length)];
            await sock.sendMessage(chatId, { react: { key: msg.key, text: r } });
          } catch {}
        }
        // Antilink
        if (isGroup && state.antilink[chatId] && !isFromMe && /https?:\/\/|wa\.me\/|chat\.whatsapp\.com/i.test(text)) {
          try {
            await sock.sendMessage(chatId, { delete: msg.key });
            await sock.sendMessage(chatId, { text: `🚫 @${sender.split("@")[0]} link removed.`, mentions: [sender] });
          } catch {}
        }
        // Antibadword
        if (isGroup && state.antibadword[chatId] && !isFromMe && text) {
          const lower = text.toLowerCase();
          if (BAD_WORDS.some((w) => lower.includes(w))) {
            try {
              await sock.sendMessage(chatId, { delete: msg.key });
              await sock.sendMessage(chatId, { text: `🚫 @${sender.split("@")[0]} watch your language.`, mentions: [sender] });
            } catch {}
          }
        }
        // PM blocker (warn — true block requires user's manual block)
        if (state.pmblocker && !isFromMe && !isGroup && sender !== botJid) {
          // count messages in last 60s
          const now = Date.now();
          const recent = (history[chatId] || []).filter((h) => h.role === "them" && now - h.ts < 60_000).length;
          if (recent > 5) {
            try { await sock.sendMessage(chatId, { text: "⚠️ Spam detected. Slow down or you'll be blocked." }); } catch {}
          }
        }

        if (text && text.startsWith(PREFIX)) {
          const allowed = state.mode === "public" || isFromMe || (OWNER_NUMBER && sender.startsWith(OWNER_NUMBER));
          if (!allowed) continue;

          // Auto-typing indicator while we process
          if (state.autotyping) {
            try { await sock.sendPresenceUpdate("composing", chatId); } catch {}
          }

          const parts = text.slice(PREFIX.length).trim().split(/\s+/);
          const cmd = parts[0]?.toLowerCase();
          const args = parts.slice(1);
          const argText = args.join(" ");

          const reply = (t, extra = {}) => sock.sendMessage(chatId, { text: t, ...extra }, { quoted: msg });

          try {
            await handleCommand({ cmd, args, argText, msg, chatId, sender, isGroup, isFromMe, reply });
          } catch (e) {
            console.error("Cmd error:", e?.message || e);
            await reply(`❌ Error: ${e?.message || e}`);
          }

          if (state.autotyping) {
            try { await sock.sendPresenceUpdate("paused", chatId); } catch {}
          }
          continue;
        }

        // AI auto-reply (DMs only, not from me, not from bot)
        if (!isFromMe && !isGroup && text && sender !== botJid) {
          let replyText = null;
          if (state.aion) {
            try { replyText = await askGemini(chatId, text); }
            catch (e) { console.error("Gemini err:", e?.message || e); }
          } else {
            replyText = suggestFromHistory(chatId, text);
          }
          if (replyText) {
            await sock.sendMessage(chatId, { text: replyText });
            recordHistory(chatId, "me", replyText);
          }
        }
      } catch (e) {
        console.error("Handler:", e?.message || e);
      }
    }
  });

  return sock;
}

// ───── COMMAND HANDLER ─────
async function handleCommand({ cmd, args, argText, msg, chatId, sender, isGroup, isFromMe, reply }) {
  const onoff = (v) => v === "on" ? true : v === "off" ? false : null;
  const ctxMsg = msg.message?.extendedTextMessage?.contextInfo;
  const quoted = ctxMsg?.quotedMessage;
  const quotedKey = ctxMsg?.stanzaId
    ? { remoteJid: chatId, id: ctxMsg.stanzaId, participant: ctxMsg.participant, fromMe: false }
    : null;
  const mentioned = ctxMsg?.mentionedJid || [];

  const needAdmin = async () => {
    if (!isGroup) throw new Error("This is a group-only command.");
    const meta = await sock.groupMetadata(chatId);
    const me = meta.participants.find((p) => p.id === botJid);
    if (!me?.admin) throw new Error("I need to be admin to do that.");
  };

  switch (cmd) {
    // ── CORE ──
    case "alive":
      return reply(`✅ *${BOT_NAME}* is alive!\n\nUptime: ${Math.floor(process.uptime())}s\nMode: *${state.mode}*\nAI auto-reply: *${state.aion ? "ON" : "OFF"}*`);
    case "ping": {
      const t = Date.now();
      const m = await reply("🏓 Pinging...");
      const delta = Date.now() - t;
      return sock.sendMessage(chatId, { text: `🏓 Pong! *${delta}ms*`, edit: m.key });
    }
    case "owner":
      return reply(`👤 *Owner*\n\nName: ${OWNER_NAME}\nNumber: ${OWNER_NUMBER ? "wa.me/" + OWNER_NUMBER : "(not set)"}`);
    case "menu":
    case "help":
      return reply(menuText());
    case "restart":
      await reply("♻️ Restarting...");
      setTimeout(() => process.exit(0), 1000);
      return;
    case "update":
      return reply("🔄 To update: push new code to GitHub. Railway will auto-redeploy.");
    case "mode": {
      if (args[0] === "public" || args[0] === "private") {
        state.mode = args[0]; persist();
        return reply(`✅ Mode set to *${state.mode}*`);
      }
      return reply(`Current mode: *${state.mode}*. Use \`${PREFIX}mode public\` or \`${PREFIX}mode private\`.`);
    }

    // ── AUTO ──
    case "autoreply":
    case "aion":
    case "aioff": {
      let v = onoff(args[0]);
      if (cmd === "aion") v = true;
      if (cmd === "aioff") v = false;
      if (v === null) return reply(`Use \`${PREFIX}autoreply on\` or \`${PREFIX}autoreply off\`. Currently: *${state.aion ? "ON" : "OFF"}*`);
      state.aion = v; persist();
      return reply(`🤖 AI auto-reply: *${v ? "ON" : "OFF"}*`);
    }
    case "aistatus":
      return reply(`AI auto-reply: *${state.aion ? "ON" : "OFF"}*`);
    case "autoread": {
      const v = onoff(args[0]); if (v === null) return reply(`Currently: *${state.autoread ? "ON" : "OFF"}*`);
      state.autoread = v; persist(); return reply(`👁️ Auto-read: *${v ? "ON" : "OFF"}*`);
    }
    case "autoreact": {
      const v = onoff(args[0]); if (v === null) return reply(`Currently: *${state.autoreact ? "ON" : "OFF"}*`);
      state.autoreact = v; persist(); return reply(`💫 Auto-react: *${v ? "ON" : "OFF"}*`);
    }
    case "autotyping": {
      const v = onoff(args[0]); if (v === null) return reply(`Currently: *${state.autotyping ? "ON" : "OFF"}*`);
      state.autotyping = v; persist(); return reply(`⌨️ Auto-typing: *${v ? "ON" : "OFF"}*`);
    }
    case "antidelete": {
      const v = onoff(args[0]); if (v === null) return reply(`Currently: *${state.antidelete ? "ON" : "OFF"}*`);
      state.antidelete = v; persist(); return reply(`🗑️ Anti-delete: *${v ? "ON" : "OFF"}*`);
    }
    case "anticall": {
      const v = onoff(args[0]); if (v === null) return reply(`Currently: *${state.anticall ? "ON" : "OFF"}*`);
      state.anticall = v; persist(); return reply(`📵 Anti-call: *${v ? "ON" : "OFF"}*`);
    }
    case "pmblocker": {
      const v = onoff(args[0]); if (v === null) return reply(`Currently: *${state.pmblocker ? "ON" : "OFF"}*`);
      state.pmblocker = v; persist(); return reply(`🛡️ PM blocker: *${v ? "ON" : "OFF"}*`);
    }
    case "autostatus": {
      const v = args[0]?.toLowerCase();
      if (!["off","view","react"].includes(v)) return reply(`Use \`${PREFIX}autostatus off|view|react\`. Currently: *${state.autostatus}*`);
      state.autostatus = v; persist();
      return reply(`📸 Auto-status: *${v}*`);
    }

    // ── AI ──
    case "gemini":
    case "gpt":
    case "ai": {
      if (!argText) return reply(`Usage: \`${PREFIX}${cmd} your question\``);
      const ans = await askGemini(chatId, argText, "You are a helpful assistant. Give clear, concise answers.");
      return reply(ans);
    }
    case "llama":
    case "mistral":
    case "dalle":
    case "flux":
      return reply(`⚠️ \`.${cmd}\` requires a paid API key (OpenRouter / OpenAI / Replicate). Not configured. Use \`${PREFIX}gemini\` instead — it's free and uses your existing Gemini key.`);

    // ── DOWNLOAD ──
    case "play":
    case "song":
    case "video":
    case "tiktok":
    case "instagram":
    case "facebook":
    case "spotify":
      return reply(`⚠️ Downloaders for *${cmd}* are unstable — YouTube/TikTok/IG keep blocking scrapers. To enable, you'd need to add a paid API like RapidAPI's social-downloader. Not configured.`);

    // ── GROUP ADMIN ──
    case "kick": {
      await needAdmin();
      const targets = mentioned.length ? mentioned : (quotedKey?.participant ? [quotedKey.participant] : []);
      if (!targets.length) return reply("Tag or reply to a user to kick.");
      await sock.groupParticipantsUpdate(chatId, targets, "remove");
      return reply(`✅ Removed ${targets.length} member(s).`);
    }
    case "add": {
      await needAdmin();
      if (!args[0]) return reply(`Usage: \`${PREFIX}add 2348012345678\``);
      const num = args[0].replace(/[^0-9]/g, "") + "@s.whatsapp.net";
      await sock.groupParticipantsUpdate(chatId, [num], "add");
      return reply(`✅ Added ${args[0]}.`);
    }
    case "promote": {
      await needAdmin();
      const targets = mentioned.length ? mentioned : (quotedKey?.participant ? [quotedKey.participant] : []);
      if (!targets.length) return reply("Tag a user to promote.");
      await sock.groupParticipantsUpdate(chatId, targets, "promote");
      return reply(`✅ Promoted.`);
    }
    case "demote": {
      await needAdmin();
      const targets = mentioned.length ? mentioned : (quotedKey?.participant ? [quotedKey.participant] : []);
      if (!targets.length) return reply("Tag a user to demote.");
      await sock.groupParticipantsUpdate(chatId, targets, "demote");
      return reply(`✅ Demoted.`);
    }
    case "tagall": {
      if (!isGroup) return reply("Group only.");
      const meta = await sock.groupMetadata(chatId);
      const ids = meta.participants.map((p) => p.id);
      const text = `📢 *${argText || "Attention!"}*\n\n` + ids.map((j) => `@${j.split("@")[0]}`).join(" ");
      return sock.sendMessage(chatId, { text, mentions: ids });
    }
    case "hidetag": {
      if (!isGroup) return reply("Group only.");
      const meta = await sock.groupMetadata(chatId);
      const ids = meta.participants.map((p) => p.id);
      return sock.sendMessage(chatId, { text: argText || "📢", mentions: ids });
    }
    case "mute": {
      await needAdmin();
      await sock.groupSettingUpdate(chatId, "announcement");
      return reply("🔇 Group muted (admins only can send).");
    }
    case "unmute": {
      await needAdmin();
      await sock.groupSettingUpdate(chatId, "not_announcement");
      return reply("🔊 Group unmuted.");
    }
    case "antilink": {
      if (!isGroup) return reply("Group only.");
      const v = onoff(args[0]); if (v === null) return reply(`Currently: *${state.antilink[chatId] ? "ON" : "OFF"}*`);
      if (v) state.antilink[chatId] = true; else delete state.antilink[chatId];
      persist(); return reply(`🔗 Antilink: *${v ? "ON" : "OFF"}*`);
    }
    case "antibadword": {
      if (!isGroup) return reply("Group only.");
      const v = onoff(args[0]); if (v === null) return reply(`Currently: *${state.antibadword[chatId] ? "ON" : "OFF"}*`);
      if (v) state.antibadword[chatId] = true; else delete state.antibadword[chatId];
      persist(); return reply(`🤬 Anti-badword: *${v ? "ON" : "OFF"}*`);
    }
    case "welcome": {
      if (!isGroup) return reply("Group only.");
      const v = onoff(args[0]); if (v === null) return reply(`Currently: *${state.welcome[chatId] ? "ON" : "OFF"}*`);
      if (v) state.welcome[chatId] = true; else delete state.welcome[chatId];
      persist(); return reply(`👋 Welcome: *${v ? "ON" : "OFF"}*`);
    }
    case "goodbye": {
      if (!isGroup) return reply("Group only.");
      const v = onoff(args[0]); if (v === null) return reply(`Currently: *${state.goodbye[chatId] ? "ON" : "OFF"}*`);
      if (v) state.goodbye[chatId] = true; else delete state.goodbye[chatId];
      persist(); return reply(`👋 Goodbye: *${v ? "ON" : "OFF"}*`);
    }

    // ── STICKERS ──
    case "sticker":
    case "s": {
      const target = quoted || msg.message;
      const isImg = target?.imageMessage || target?.videoMessage;
      if (!isImg) return reply("Reply to (or send with) an image/short video.");
      const dummy = { message: quoted || msg.message };
      const buf = await downloadMediaMessage(dummy, "buffer", {});
      const sticker = new Sticker(buf, {
        pack: argText || BOT_NAME,
        author: OWNER_NAME,
        type: StickerTypes.FULL,
        quality: 60,
      });
      return sock.sendMessage(chatId, await sticker.toMessage(), { quoted: msg });
    }
    case "take": {
      if (!quoted?.stickerMessage) return reply("Reply to a sticker.");
      const dummy = { message: quoted };
      const buf = await downloadMediaMessage(dummy, "buffer", {});
      const sticker = new Sticker(buf, {
        pack: args[0] || BOT_NAME,
        author: args[1] || OWNER_NAME,
        type: StickerTypes.FULL,
      });
      return sock.sendMessage(chatId, await sticker.toMessage(), { quoted: msg });
    }
    case "attp": {
      if (!argText) return reply(`Usage: \`${PREFIX}attp text\``);
      const url = `https://api.popcat.xyz/attp?text=${encodeURIComponent(argText)}`;
      const sticker = new Sticker(url, { pack: BOT_NAME, author: OWNER_NAME, type: StickerTypes.FULL });
      return sock.sendMessage(chatId, await sticker.toMessage(), { quoted: msg });
    }
    case "emojimix": {
      const [a, b] = argText.split(/[, ]+/);
      if (!a || !b) return reply(`Usage: \`${PREFIX}emojimix 😀 😭\``);
      const url = `https://www.gstatic.com/android/keyboard/emojikitchen/20201001/u${a.codePointAt(0).toString(16)}/u${a.codePointAt(0).toString(16)}_u${b.codePointAt(0).toString(16)}.png`;
      try {
        const sticker = new Sticker(url, { pack: BOT_NAME, author: OWNER_NAME, type: StickerTypes.FULL });
        return sock.sendMessage(chatId, await sticker.toMessage(), { quoted: msg });
      } catch {
        return reply("❌ Those two emojis don't have a mix.");
      }
    }

    // ── TOOLS ──
    case "qrcode":
    case "qr": {
      if (!argText) return reply(`Usage: \`${PREFIX}qrcode text or url\``);
      const buf = await QRCode.toBuffer(argText, { width: 512, margin: 2 });
      return sock.sendMessage(chatId, { image: buf, caption: "🔳 Your QR code" }, { quoted: msg });
    }
    case "readqr":
      return reply("⚠️ QR reading needs an extra image-decoding library that's heavy on Railway. Not enabled.");
    case "translate":
    case "tr": {
      const m = argText.match(/^(\S+)\s+(.+)$/);
      const targetLang = m ? m[1] : "en";
      const text = m ? m[2] : (quoted ? extractText(quoted) : "");
      if (!text) return reply(`Usage: \`${PREFIX}translate en Hola amigo\` (or reply to a message with \`${PREFIX}translate en\`)`);
      const r = await translate(text, { to: targetLang });
      return reply(`🌐 *Translation (${targetLang}):*\n${r.text}`);
    }
    case "tts": {
      if (!argText) return reply(`Usage: \`${PREFIX}tts your text\` or \`${PREFIX}tts en your text\``);
      let lang = "en", t = argText;
      const m = argText.match(/^([a-z]{2})\s+(.+)$/i);
      if (m) { lang = m[1]; t = m[2]; }
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(t)}&tl=${lang}&client=tw-ob`;
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
      const buf = Buffer.from(await res.arrayBuffer());
      return sock.sendMessage(chatId, { audio: buf, mimetype: "audio/mpeg", ptt: true }, { quoted: msg });
    }
    case "removebg":
      return reply("⚠️ Background removal requires a remove.bg API key. Not configured.");
    case "tourl": {
      const target = quoted || msg.message;
      const isMedia = target?.imageMessage || target?.videoMessage || target?.documentMessage;
      if (!isMedia) return reply("Reply to an image, video, or file.");
      const dummy = { message: quoted || msg.message };
      const buf = await downloadMediaMessage(dummy, "buffer", {});
      // Use catbox.moe (free, no key)
      const FormData = (await import("form-data")).default.bind?.() || (await import("form-data")).default;
      const form = new (await import("form-data")).default();
      form.append("reqtype", "fileupload");
      form.append("fileToUpload", buf, { filename: "file.bin" });
      const r = await fetch("https://catbox.moe/user/api.php", { method: "POST", body: form });
      const url = (await r.text()).trim();
      return reply(`🔗 ${url}`);
    }
    case "screenshot":
      return reply("⚠️ Website screenshots require a browser engine (Puppeteer) that's heavy on Railway. Not enabled.");

    // ── GAMES + FUN ──
    case "joke": {
      const r = await fetch("https://official-joke-api.appspot.com/random_joke");
      const j = await r.json();
      return reply(`😂 *${j.setup}*\n\n${j.punchline}`);
    }
    case "meme": {
      const r = await fetch("https://meme-api.com/gimme");
      const j = await r.json();
      return sock.sendMessage(chatId, { image: { url: j.url }, caption: `😂 ${j.title}\n— r/${j.subreddit}` }, { quoted: msg });
    }
    case "trivia": {
      const r = await fetch("https://opentdb.com/api.php?amount=1&type=multiple");
      const j = await r.json();
      const q = j.results[0];
      const opts = [...q.incorrect_answers, q.correct_answer]
        .map((s) => decodeHtml(s))
        .sort(() => Math.random() - 0.5);
      triviaAnswers[chatId] = decodeHtml(q.correct_answer);
      return reply(`🧠 *${decodeHtml(q.question)}*\n\n${opts.map((o, i) => `${i+1}. ${o}`).join("\n")}\n\nReply with \`${PREFIX}answer <text>\``);
    }
    case "answer": {
      const correct = triviaAnswers[chatId];
      if (!correct) return reply("No active trivia. Send `.trivia` first.");
      delete triviaAnswers[chatId];
      const ok = argText.trim().toLowerCase() === correct.toLowerCase();
      return reply(ok ? `✅ Correct! It was *${correct}*.` : `❌ Wrong. Correct answer: *${correct}*.`);
    }
    case "truth": {
      const list = ["What's your biggest secret?","Who was your first crush?","What's the most embarrassing thing you've done?","What's a lie you've told recently?","Who do you secretly admire?","What's your worst habit?","What's your guilty pleasure?","Who in this chat would you date?","What's a fear you've never told anyone?","What's the worst gift you've ever received?"];
      return reply(`💬 *Truth:* ${list[Math.floor(Math.random()*list.length)]}`);
    }
    case "dare": {
      const list = ["Send your last selfie.","Sing a song in voice note.","Text your crush 'I miss you'.","Speak in a fake accent for 5 minutes.","Post an embarrassing status for 10 minutes.","Send a voice note saying 'I love you' to the next person who messages you.","Do 20 push-ups and send a video.","Show the last 5 emojis you used.","Change your profile picture to a baby photo for 1 hour.","Send your screen-time report."];
      return reply(`🔥 *Dare:* ${list[Math.floor(Math.random()*list.length)]}`);
    }
    case "tictactoe":
    case "ttt": {
      if (!isGroup && args[0] !== "solo") return reply("Use in a group, or `.tictactoe solo` for solo board demo.");
      ticTacToe[chatId] = { board: ["1","2","3","4","5","6","7","8","9"], turn: "X" };
      return reply(`🎮 *TicTacToe started*\n\n${renderBoard(ticTacToe[chatId].board)}\n\nPlay: \`${PREFIX}move <1-9>\`. Turn: *X*`);
    }
    case "move": {
      const g = ticTacToe[chatId];
      if (!g) return reply("No active game. Send `.tictactoe` first.");
      const pos = parseInt(args[0]) - 1;
      if (isNaN(pos) || pos < 0 || pos > 8 || g.board[pos] === "X" || g.board[pos] === "O")
        return reply("Pick an empty square 1–9.");
      g.board[pos] = g.turn;
      const winner = ticWinner(g.board);
      if (winner) { delete ticTacToe[chatId]; return reply(`🏆 *${winner} wins!*\n\n${renderBoard(g.board)}`); }
      if (!g.board.some((c) => c === "X" || c === "O" ? false : true)) {
        delete ticTacToe[chatId]; return reply(`🤝 Draw!\n\n${renderBoard(g.board)}`);
      }
      g.turn = g.turn === "X" ? "O" : "X";
      return reply(`${renderBoard(g.board)}\n\nTurn: *${g.turn}*`);
    }

    // ── INFO ──
    case "weather": {
      if (!argText) return reply(`Usage: \`${PREFIX}weather <city>\``);
      const r = await fetch(`https://wttr.in/${encodeURIComponent(argText)}?format=j1`);
      if (!r.ok) return reply("❌ Couldn't fetch weather.");
      const j = await r.json();
      const cur = j.current_condition[0];
      const area = j.nearest_area[0];
      return reply(`☁️ *Weather: ${area.areaName[0].value}, ${area.country[0].value}*\n\n🌡️ ${cur.temp_C}°C (feels ${cur.FeelsLikeC}°C)\n${cur.weatherDesc[0].value}\n💧 Humidity: ${cur.humidity}%\n💨 Wind: ${cur.windspeedKmph} km/h`);
    }
    case "define":
    case "dictionary": {
      if (!argText) return reply(`Usage: \`${PREFIX}define <word>\``);
      const r = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(argText)}`);
      if (!r.ok) return reply("❌ Word not found.");
      const j = await r.json();
      const e = j[0];
      const out = [`📖 *${e.word}* ${e.phonetic || ""}`];
      e.meanings.slice(0, 3).forEach((m) => {
        out.push(`\n_${m.partOfSpeech}_`);
        m.definitions.slice(0, 2).forEach((d, i) => out.push(`  ${i+1}. ${d.definition}`));
      });
      return reply(out.join("\n"));
    }
    case "wiki":
    case "wikipedia": {
      if (!argText) return reply(`Usage: \`${PREFIX}wiki <topic>\``);
      const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(argText)}`);
      if (!r.ok) return reply("❌ Topic not found.");
      const j = await r.json();
      const text = `📚 *${j.title}*\n\n${j.extract}\n\n${j.content_urls?.desktop?.page || ""}`;
      if (j.thumbnail?.source) {
        return sock.sendMessage(chatId, { image: { url: j.thumbnail.source }, caption: text }, { quoted: msg });
      }
      return reply(text);
    }
    case "news": {
      const r = await fetch("https://hnrss.org/frontpage.jsonfeed");
      if (!r.ok) return reply("❌ News fetch failed.");
      const j = await r.json();
      const top = j.items.slice(0, 5).map((it, i) => `${i+1}. *${it.title}*\n${it.url}`).join("\n\n");
      return reply(`📰 *Top stories*\n\n${top}`);
    }
    case "movie":
      return reply("⚠️ Movie lookups need an OMDb API key (free at omdbapi.com). Add `OMDB_KEY` env var to enable.");
    case "quran": {
      const ref = argText.trim() || `${1 + Math.floor(Math.random()*114)}`;
      const r = await fetch(`https://api.alquran.cloud/v1/ayah/${encodeURIComponent(ref)}/editions/quran-uthmani,en.asad`);
      if (!r.ok) return reply(`Usage: \`${PREFIX}quran 2:255\` (surah:ayah)`);
      const j = await r.json();
      const ar = j.data[0], en = j.data[1];
      return reply(`🕌 *${ar.surah.englishName} ${ar.surah.number}:${ar.numberInSurah}*\n\n${ar.text}\n\n_${en.text}_`);
    }

    default:
      return reply(`❓ Unknown command \`${PREFIX}${cmd}\`. Send \`${PREFIX}menu\` to see all commands.`);
  }
}

function menuText() {
  return `╭───⬣ *${BOT_NAME}* ──⬣
│ Mode: *${state.mode}*  ·  AI: *${state.aion ? "ON" : "OFF"}*
│ Prefix: *${PREFIX}*
╰─────────────⬣

╭───⬣ *CORE* ──⬣
│ ${PREFIX}alive ${PREFIX}menu ${PREFIX}ping
│ ${PREFIX}owner ${PREFIX}restart ${PREFIX}update
│ ${PREFIX}mode public/private
╰─⬣
╭───⬣ *AUTO* ──⬣
│ ${PREFIX}autoreply on/off
│ ${PREFIX}autoread on/off
│ ${PREFIX}autoreact on/off
│ ${PREFIX}autostatus off/view/react
│ ${PREFIX}autotyping on/off
│ ${PREFIX}antidelete on/off
│ ${PREFIX}anticall on/off
│ ${PREFIX}pmblocker on/off
╰─⬣
╭───⬣ *AI* ──⬣
│ ${PREFIX}gemini <prompt>  (free)
│ ${PREFIX}gpt <prompt>     (uses Gemini)
│ ${PREFIX}llama ${PREFIX}mistral ${PREFIX}dalle ${PREFIX}flux  (need paid keys)
╰─⬣
╭───⬣ *DOWNLOAD* ──⬣
│ ${PREFIX}play ${PREFIX}song ${PREFIX}video
│ ${PREFIX}tiktok ${PREFIX}instagram ${PREFIX}facebook ${PREFIX}spotify
│ ⚠️ Need paid scraper API
╰─⬣
╭───⬣ *GROUP ADMIN* ──⬣
│ ${PREFIX}kick ${PREFIX}add ${PREFIX}promote ${PREFIX}demote
│ ${PREFIX}tagall ${PREFIX}hidetag
│ ${PREFIX}mute ${PREFIX}unmute
│ ${PREFIX}antilink on/off
│ ${PREFIX}antibadword on/off
│ ${PREFIX}welcome on/off
│ ${PREFIX}goodbye on/off
╰─⬣
╭───⬣ *STICKERS* ──⬣
│ ${PREFIX}sticker (reply image/video)
│ ${PREFIX}attp <text>
│ ${PREFIX}take <pack> <author>
│ ${PREFIX}emojimix 😀 😭
╰─⬣
╭───⬣ *TOOLS* ──⬣
│ ${PREFIX}qrcode <text>
│ ${PREFIX}translate <lang> <text>
│ ${PREFIX}tts <text>
│ ${PREFIX}tourl (reply to media)
│ ${PREFIX}removebg ${PREFIX}readqr ${PREFIX}screenshot ⚠️
╰─⬣
╭───⬣ *GAMES + FUN* ──⬣
│ ${PREFIX}tictactoe ${PREFIX}move <1-9>
│ ${PREFIX}trivia ${PREFIX}answer <text>
│ ${PREFIX}truth ${PREFIX}dare
│ ${PREFIX}meme ${PREFIX}joke
╰─⬣
╭───⬣ *INFO* ──⬣
│ ${PREFIX}weather <city>
│ ${PREFIX}news
│ ${PREFIX}define <word>
│ ${PREFIX}wiki <topic>
│ ${PREFIX}movie ⚠️ (needs OMDb key)
│ ${PREFIX}quran <surah:ayah>
╰─⬣

Owner: ${OWNER_NAME}`;
}

// ───── PAIRING ─────
async function requestPairing(number) {
  const cleaned = String(number || "").replace(/[^0-9]/g, "");
  if (!cleaned || cleaned.length < 8) throw new Error("Enter a valid number with country code (digits only).");
  if (connected) throw new Error("Already paired and connected.");
  try {
    restarting = true;
    if (sock) { try { sock.end(); } catch {} sock = null; }
    await fsp.rm(SESSION_DIR, { recursive: true, force: true });
    await fsp.mkdir(SESSION_DIR, { recursive: true });
  } finally { restarting = false; }
  pairingCode = null; pairingNumber = null; pendingPairNumber = cleaned;
  await startBot();
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    if (pairingCode) return pairingCode;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("Timed out generating code. Try again.");
}

const app = express();
app.use(express.json());
app.get("/", (_req, res) => res.type("html").send(PAGE));
app.get("/api/status", (_req, res) => res.json({ connected, pairingCode, pairingNumber, aion: state.aion }));
app.post("/api/pair", async (req, res) => {
  try { res.json({ code: await requestPairing(req.body?.number) }); }
  catch (e) { res.status(400).json({ error: e?.message || "Failed to pair" }); }
});
app.get("/healthz", (_req, res) => res.json({ status: "ok" }));

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${BOT_NAME} · Pair</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}
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
</style></head><body>
<div class="card">
  <span class="pill" id="status-pill">checking…</span>
  <h1>Pair ${BOT_NAME}</h1>
  <p class="sub">Enter your WhatsApp number with country code (digits only). You'll get an 8-character code to enter in WhatsApp → Settings → Linked Devices → Link with phone number.</p>
  <div id="connected-box" class="box ok">
    <div class="hint">Status</div>
    <div class="code" style="font-size:18px">✅ Bot paired and online</div>
    <div class="hint">Send <b>.menu</b> to yourself on WhatsApp to see all commands.</div>
  </div>
  <form id="form">
    <label for="number">Phone number</label>
    <input id="number" inputmode="numeric" placeholder="e.g. 256752233886" required />
    <button id="submit" type="submit">Get pairing code</button>
  </form>
  <div class="err" id="error"></div>
  <div class="box info" id="result">
    <div class="hint">Your pairing code</div>
    <div class="code" id="code">----</div>
    <div class="hint">Code expires in ~60 seconds.</div>
  </div>
  <footer>${BOT_NAME}</footer>
</div>
<script>
const pill=document.getElementById('status-pill'),form=document.getElementById('form'),btn=document.getElementById('submit'),errEl=document.getElementById('error'),resEl=document.getElementById('result'),codeEl=document.getElementById('code'),connBox=document.getElementById('connected-box');
async function refresh(){try{const r=await fetch('/api/status'),s=await r.json();if(s.connected){pill.textContent='online';pill.style.color='#9be7b8';connBox.classList.add('show');form.style.display='none';resEl.classList.remove('show');}else{pill.textContent='not paired';pill.style.color='#ffb4b4';connBox.classList.remove('show');form.style.display='block';if(s.pairingCode){codeEl.textContent=s.pairingCode;resEl.classList.add('show');}}}catch{}}
setInterval(refresh,3000);refresh();
form.addEventListener('submit',async(e)=>{e.preventDefault();errEl.classList.remove('show');resEl.classList.remove('show');const number=document.getElementById('number').value.replace(/[^0-9]/g,'');if(!number){errEl.textContent='Please enter a valid number.';errEl.classList.add('show');return;}btn.disabled=true;btn.textContent='Generating…';try{const r=await fetch('/api/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({number})});const data=await r.json();if(!r.ok)throw new Error(data.error||'Failed');codeEl.textContent=data.code;resEl.classList.add('show');}catch(err){errEl.textContent=err.message||'Something went wrong.';errEl.classList.add('show');}finally{btn.disabled=false;btn.textContent='Get pairing code';}});
</script></body></html>`;

app.listen(PORT, () => console.log(`[web] listening on ${PORT}`));

if (fs.existsSync(path.join(SESSION_DIR, "creds.json"))) {
  startBot().catch((e) => console.error("Resume failed:", e));
}
