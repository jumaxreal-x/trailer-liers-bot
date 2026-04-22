import baileys from '@whiskeysockets/baileys';
const {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  Browsers,
  makeCacheableSignalKeyStore,
} = baileys;
const _makeSock = baileys.default || makeWASocket;
import pino from 'pino';
import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { Boom } from '@hapi/boom';
import { config, ownerJid } from './config.js';
import { AUTH_DIR, ensureAuthDir, hydrateFromSessionId, exportSessionId } from './session.js';
import { loadAllCommands } from './commands/index.js';
import { buildHandler } from './handler.js';
import { getState } from './state.js';

const logger = pino({ level: 'silent' });

function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(q, ans => { rl.close(); res(ans.trim()); }));
}

async function start() {
  ensureAuthDir();

  // Hydrate from SESSION_ID secret if present and creds.json missing
  const credsPath = path.join(AUTH_DIR, 'creds.json');
  if (config.SESSION_ID && !fs.existsSync(credsPath)) {
    if (hydrateFromSessionId(config.SESSION_ID)) {
      console.log('[session] Loaded auth from SESSION_ID secret.');
    } else {
      console.log('[session] SESSION_ID provided but could not be decoded.');
    }
  }

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = _makeSock({
    version,
    logger,
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
    printQRInTerminal: false,
    browser: Browsers.ubuntu('Chrome'),
    syncFullHistory: false,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: true,
  });

  // Pairing code flow if not registered
  if (!sock.authState.creds.registered) {
    const phone = (process.env.PAIR_NUMBER || config.OWNER_NUMBER).replace(/\D/g, '');
    console.log('\n========================================');
    console.log(`📱 First-time setup. Requesting pairing code for: +${phone}`);
    console.log('========================================');
    // brief delay to let the websocket open, then request code immediately
    await new Promise(r => setTimeout(r, 1500));
    try {
      const code = await sock.requestPairingCode(phone);
      const formatted = code?.match(/.{1,4}/g)?.join('-') || code;
      console.log('\n========================================');
      console.log(`🔑 PAIRING CODE: ${formatted}`);
      console.log(`📱 On +${phone}: WhatsApp → Settings → Linked Devices`);
      console.log(`        → Link a device → Link with phone number`);
      console.log(`        → Enter the code above`);
      console.log('⏱  Code valid for ~60 seconds. Bot will auto-recycle if unused.');
      console.log('========================================\n');
    } catch (e) {
      console.error('Pairing code error:', e.message);
    }
  }

  loadAllCommands();

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect, qr } = u;
    if (qr) {
      // qr fallback (shouldn't trigger since printQRInTerminal=false and we use pair code)
      console.log('[qr] received (ignored — use pairing code).');
    }
    if (connection === 'close') {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      const wasRegistered = sock.authState.creds.registered;
      console.log(`[conn] closed. code=${code} loggedOut=${loggedOut} registered=${wasRegistered}`);

      if (loggedOut && wasRegistered) {
        console.log('[conn] Real logout — clearing auth and starting fresh pairing.');
        const { clearAuth } = await import('./session.js');
        clearAuth();
        setTimeout(start, 2000);
      } else if (!wasRegistered) {
        // pairing never completed — wipe partial auth and request a new code
        console.log('[pair] Pairing did not complete (code likely expired). Generating a new one in 3s...');
        const { clearAuth } = await import('./session.js');
        clearAuth();
        setTimeout(start, 3000);
      } else {
        // transient disconnect — reconnect
        setTimeout(start, 3000);
      }
    } else if (connection === 'open') {
      console.log(`[conn] ✅ ${config.BOT_NAME} connected as ${sock.user?.id}`);
      // Print SESSION_ID once so the user can save it as a secret
      const sid = exportSessionId();
      if (sid && !config.SESSION_ID) {
        console.log('\n========================================');
        console.log('💾 Save this as the SESSION_ID secret to skip pairing next time:');
        console.log(sid);
        console.log('========================================\n');
        try {
          await sock.sendMessage(ownerJid(), {
            text: `*${config.BOT_NAME} is online* ✅\n\nSave this as SESSION_ID secret:\n\n${sid}`,
          });
        } catch {}
      } else {
        try {
          await sock.sendMessage(ownerJid(), {
            text: `*${config.BOT_NAME}* online ✅\nMode: ${getState().mode}\nType .help`,
          });
        } catch {}
      }
    }
  });

  // anticall
  sock.ev.on('call', async (calls) => {
    if (!getState().anticall) return;
    for (const c of calls) {
      if (c.status === 'offer') {
        try { await sock.rejectCall(c.id, c.from); } catch {}
        try { await sock.sendMessage(c.from, { text: `🚫 Calls are not allowed. (anticall)` }); } catch {}
      }
    }
  });

  // antidelete
  sock.ev.on('messages.update', async (updates) => {
    if (!getState().antidelete) return;
    for (const u of updates) {
      if (u.update?.message === null) {
        const cached = getState().messageCache?.[u.key.id];
        if (cached?.text) {
          try {
            await sock.sendMessage(ownerJid(), {
              text: `🗑 *Deleted message recovered*\nFrom: ${cached.from}\nSender: ${cached.sender}\n\n${cached.text}`,
            });
          } catch {}
        }
      }
    }
  });

  sock.ev.on('messages.upsert', buildHandler(sock));
}

start().catch((e) => {
  console.error('fatal:', e);
  setTimeout(() => start(), 5000);
});

process.on('uncaughtException', (e) => console.error('uncaught:', e?.message));
process.on('unhandledRejection', (e) => console.error('rejection:', e?.message));
