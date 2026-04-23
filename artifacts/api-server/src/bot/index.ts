import path from "node:path";
import fs from "node:fs";
import { Boom } from "@hapi/boom";
import {
  default as makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  jidNormalizedUser,
  Browsers,
  type WASocket,
  type proto,
} from "@whiskeysockets/baileys";
import qrcode from "qrcode";
import { logger } from "../lib/logger";
import { dispatch } from "./commands";
import {
  BOT_NAME,
  OWNER_JID,
  OWNER_NUMBER,
  getMessageText,
  isGroup,
  isOwner,
  jidNumber,
  parseCommand,
} from "./utils";
import { getState, loadState, rememberMessage, saveState } from "./state";

const BAD_WORDS = ["fuck", "shit", "bitch", "asshole", "dick", "cunt"];
const LINK_RE = /(https?:\/\/|wa\.me\/|chat\.whatsapp\.com\/)/i;

let sock: WASocket | null = null;
let latestQR: string | null = null;
let latestQRDataUrl: string | null = null;
let connectionState: "connecting" | "open" | "closed" = "closed";
let pairingCode: string | null = null;

const AUTH_DIR = path.resolve(process.cwd(), ".wa-state", "auth");

export function getBotInfo(): {
  state: string;
  qr: string | null;
  qrDataUrl: string | null;
  pairingCode: string | null;
  user: string | null;
  uptime: number;
} {
  return {
    state: connectionState,
    qr: latestQR,
    qrDataUrl: latestQRDataUrl,
    pairingCode,
    user: sock?.user?.id ?? null,
    uptime: Date.now() - getState().startedAt,
  };
}

export async function requestPairingCode(phoneNumber: string): Promise<string> {
  if (!sock) throw new Error("bot not initialized");
  if (sock.authState.creds.registered) {
    throw new Error("already registered — clear auth to re-pair");
  }
  // wait briefly for socket to be ready to accept the request
  for (let i = 0; i < 20; i++) {
    if (sock.ws.isOpen) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  const code = await sock.requestPairingCode(phoneNumber.replace(/\D/g, ""));
  pairingCode = code;
  return code;
}

async function handleMessages(messages: proto.IWebMessageInfo[]): Promise<void> {
  if (!sock) return;
  for (const msg of messages) {
    try {
      if (!msg.message) continue;
      const jid = msg.key?.remoteJid;
      if (!jid || !msg.key) continue;

      const state = getState();

      // auto status view
      if (jid === "status@broadcast") {
        if (state.features.autostatus) {
          await sock.readMessages([msg.key as never]);
        }
        continue;
      }

      const sender = msg.key.participant ?? jid;
      const text = getMessageText(msg);
      const fromMe = msg.key.fromMe ?? false;

      // remember for antidelete
      if (msg.key.id) {
        rememberMessage(msg.key.id, { text, sender });
      }

      if (state.features.autoread) {
        await sock.readMessages([msg.key as never]);
      }

      // anti-link in groups
      if (isGroup(jid) && state.features.antilink[jid] && !fromMe && LINK_RE.test(text)) {
        try {
          const meta = await sock.groupMetadata(jid);
          const me = jidNumber(sock.user?.id ?? "");
          const botAdmin = meta.participants.find(
            (p) => jidNumber(p.id) === me && (p.admin === "admin" || p.admin === "superadmin"),
          );
          if (botAdmin) {
            await sock.sendMessage(jid, { delete: msg.key as never });
          }
        } catch {/* ignore */}
      }

      // anti badword
      if (
        isGroup(jid) &&
        state.features.antibadword[jid] &&
        !fromMe &&
        BAD_WORDS.some((w) => text.toLowerCase().includes(w))
      ) {
        try {
          await sock.sendMessage(jid, { delete: msg.key as never });
        } catch {/* ignore */}
      }

      // pmblocker
      if (
        !isGroup(jid) &&
        state.features.pmblocker &&
        !fromMe &&
        !isOwner(sender) &&
        !text.startsWith(".") &&
        !text.startsWith("!")
      ) {
        await sock.sendMessage(jid, {
          text: `Hi! ${BOT_NAME} doesn't accept random DMs. Owner: wa.me/${OWNER_NUMBER}`,
        });
      }

      // auto react
      if (state.features.autoreact && !fromMe) {
        const e = ["👍", "❤️", "🔥", "😂", "🎉"][Math.floor(Math.random() * 5)]!;
        try {
          await sock.sendMessage(jid, { react: { text: e, key: msg.key as never } });
        } catch {/* ignore */}
      }

      // command
      const cmd = parseCommand(text);
      if (cmd) {
        if (state.features.autotyping) {
          await sock.sendPresenceUpdate("composing", jid);
        }
        const handled = await dispatch(sock, msg, cmd);
        if (handled) continue;
      }

      // autoreply (AI) for non-commands when not from me
      if (state.features.autoreply && !fromMe && text && !isGroup(jid)) {
        // reply only to DMs to avoid noise
        try {
          const OpenAI = (await import("openai")).default;
          const ai = new OpenAI({
            apiKey:
              process.env["OPENAI_API_KEY"] ??
              process.env["AI_INTEGRATIONS_OPENAI_API_KEY"] ??
              "x",
            baseURL:
              process.env["OPENAI_BASE_URL"] ??
              process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"],
          });
          const r = await ai.chat.completions.create({
            model: "gpt-5-nano",
            max_completion_tokens: 256,
            messages: [
              { role: "system", content: `You are ${BOT_NAME}, a friendly WhatsApp bot.` },
              { role: "user", content: text },
            ],
          });
          const ans = r.choices[0]?.message?.content;
          if (ans) await sock.sendMessage(jid, { text: ans }, { quoted: msg as never });
        } catch (e) {
          logger.warn({ err: e }, "autoreply failed");
        }
      }
    } catch (e) {
      logger.error({ err: e }, "message handler error");
    }
  }
}

async function start(): Promise<void> {
  loadState();
  if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });
  const { state: authState, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  connectionState = "connecting";
  sock = makeWASocket({
    version,
    auth: authState,
    printQRInTerminal: false,
    logger: logger.child({ scope: "baileys" }) as never,
    browser: Browsers.ubuntu("Chrome"),
    syncFullHistory: false,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: true,
  });

  sock.ev.on("creds.update", saveCreds);

  // Auto-request pairing code on startup if not yet registered
  if (!authState.creds.registered) {
    setTimeout(() => {
      void (async () => {
        try {
          for (let i = 0; i < 20; i++) {
            if (sock?.ws.isOpen) break;
            await new Promise((r) => setTimeout(r, 250));
          }
          if (sock && !sock.authState.creds.registered) {
            const code = await sock.requestPairingCode(OWNER_NUMBER);
            pairingCode = code;
            logger.info({ code }, `Pairing code ready for +${OWNER_NUMBER}`);
          }
        } catch (e) {
          logger.warn({ err: e }, "auto pairing code failed");
        }
      })();
    }, 1500);
  }

  sock.ev.on("connection.update", async (u) => {
    const { connection, lastDisconnect, qr } = u;
    if (qr) {
      latestQR = qr;
      try {
        latestQRDataUrl = await qrcode.toDataURL(qr, { width: 320 });
      } catch {
        latestQRDataUrl = null;
      }
      logger.info("New QR code available at /api/wa");
    }
    if (connection === "open") {
      connectionState = "open";
      latestQR = null;
      latestQRDataUrl = null;
      pairingCode = null;
      logger.info({ user: sock?.user?.id }, `${BOT_NAME} connected`);
      // greet owner
      try {
        await sock?.sendMessage(OWNER_JID, {
          text: `*${BOT_NAME}* is online ✅\nMode: ${getState().mode}\nType .menu`,
        });
      } catch {/* ignore */}
    } else if (connection === "close") {
      connectionState = "closed";
      const code = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      const wasRegistered = sock?.authState.creds.registered ?? false;
      logger.warn({ code, loggedOut, wasRegistered }, "connection closed");
      if (loggedOut) {
        try {
          fs.rmSync(AUTH_DIR, { recursive: true, force: true });
          logger.warn("cleared stale auth — re-link the bot");
        } catch {/* ignore */}
        setTimeout(() => void start(), 3000);
        return;
      }
      // If we are not yet registered AND we already have an outstanding pairing code,
      // delay reconnect by 90s so the user can finish entering the code without it being
      // invalidated by a fresh requestPairingCode call.
      if (!wasRegistered && pairingCode) {
        logger.warn("close before pair completed — waiting 90s before retry to preserve pairing code");
        setTimeout(() => void start(), 90_000);
      } else {
        setTimeout(() => void start(), 3000);
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify" && type !== "append") return;
    await handleMessages(messages);
  });

  sock.ev.on("messages.update", async (updates) => {
    if (!sock) return;
    const state = getState();
    if (!state.features.antidelete) return;
    for (const u of updates) {
      const stub = (u.update as { messageStubType?: number }).messageStubType;
      const isDelete =
        stub === 68 || // REVOKE
        (u.update as { message?: unknown }).message === null;
      if (!isDelete) continue;
      const cached = state.messageCache[u.key.id ?? ""];
      if (!cached) continue;
      const jid = u.key.remoteJid;
      if (!jid) continue;
      try {
        await sock.sendMessage(jid, {
          text: `🗑️ *Anti-Delete*\nFrom: @${jidNumber(cached.sender)}\n\n${cached.text}`,
          mentions: [cached.sender],
        });
      } catch {/* ignore */}
    }
  });

  sock.ev.on("call", async (calls) => {
    if (!sock) return;
    if (!getState().features.anticall) return;
    for (const c of calls) {
      if (c.status === "offer") {
        try {
          await sock.rejectCall(c.id, c.from);
          await sock.sendMessage(c.from, {
            text: `Calls are not allowed. ${BOT_NAME} auto-rejects.`,
          });
        } catch {/* ignore */}
      }
    }
  });

  sock.ev.on("group-participants.update", async (ev) => {
    if (!sock) return;
    const state = getState();
    const jid = ev.id;
    try {
      const meta = await sock.groupMetadata(jid);
      for (const part of ev.participants) {
        const pid = typeof part === "string" ? part : part.id;
        if (ev.action === "add" && state.features.welcome[jid]) {
          await sock.sendMessage(jid, {
            text: `Welcome @${jidNumber(pid)} to *${meta.subject}*!`,
            mentions: [pid],
          });
        } else if (ev.action === "remove" && state.features.goodbye[jid]) {
          await sock.sendMessage(jid, {
            text: `Goodbye @${jidNumber(pid)}!`,
            mentions: [pid],
          });
        }
      }
    } catch {/* ignore */}
  });
}

export function startBot(): void {
  start().catch((e) => {
    logger.error({ err: e }, "bot start failed");
    setTimeout(() => startBot(), 5000);
  });
  // periodic save
  setInterval(() => saveState(), 30_000);
}

void jidNormalizedUser;
