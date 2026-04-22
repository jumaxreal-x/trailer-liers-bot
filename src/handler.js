import { commands } from './commands/index.js';
import { config, ownerJid } from './config.js';
import { getState, setState } from './state.js';
import { parseCmd, extractText, senderJid, isOwner, isSudo, isGroup, normalizeJid } from './utils.js';
import { aiGenerate, pushHistory } from './ai.js';

export function buildHandler(sock) {
  return async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      try {
        await handleOne(sock, msg);
      } catch (e) {
        console.error('handler error:', e?.message);
      }
    }
  };
}

async function handleOne(sock, msg) {
  if (!msg.message) return;
  const from = msg.key.remoteJid;
  if (!from) return;

  const state = getState();
  const text = extractText(msg);
  const sender = senderJid(msg);
  const fromMe = !!msg.key.fromMe;

  // edit detection — protocolMessage type 14 = MESSAGE_EDIT
  const proto = msg.message?.protocolMessage;
  if (proto && (proto.type === 14 || proto.type === 'MESSAGE_EDIT')) {
    if (state.antiedit && !fromMe) {
      const editedKey = proto.key?.id;
      const oldCached = editedKey ? state.messageCache?.[editedKey] : null;
      const newText = extractText({ message: proto.editedMessage }) || '(non-text edit)';
      const old = oldCached?.text || '(original not cached)';
      try {
        await sock.sendMessage(ownerJid(), {
          text: `✏️ *Edited message detected*\nFrom: ${from}\nSender: ${sender}\n\n*Before:* ${old}\n*After:* ${newText}`,
        });
      } catch {}
    }
    return;
  }

  // status broadcast handling
  if (from === 'status@broadcast') {
    if (state.autostatus) {
      try { await sock.readMessages([msg.key]); } catch {}
    }
    return;
  }

  // cache for antidelete + broadcastdm
  if (text || msg.message) {
    state.messageCache[msg.key.id] = { from, text, sender };
    const keys = Object.keys(state.messageCache);
    if (keys.length > 500) delete state.messageCache[keys[0]];
    setState({ messageCache: state.messageCache });
  }

  // auto features
  if (state.autoread && !fromMe) {
    try { await sock.readMessages([msg.key]); } catch {}
  }
  if (state.autotyping && !fromMe) {
    try { await sock.sendPresenceUpdate('composing', from); } catch {}
  }
  if (state.autoreact && !fromMe && Math.random() < 0.5) {
    const emojis = ['👍', '❤️', '🔥', '😂', '👀', '🙏', '✨'];
    try { await sock.sendMessage(from, { react: { text: emojis[Math.floor(Math.random() * emojis.length)], key: msg.key } }); } catch {}
  }

  // pmblocker
  if (state.pmblocker && !fromMe && !isGroup(from) && !isOwner(sender) && !isSudo(sender, state)) {
    try { await sock.updateBlockStatus(from, 'block'); } catch {}
    return;
  }

  // auto replies
  if (text && !fromMe) {
    const lower = text.toLowerCase();
    const hit = (state.replies || []).find(r => lower.includes(r.trigger));
    if (hit) {
      try { await sock.sendMessage(from, { text: hit.response }, { quoted: msg }); } catch {}
    }
  }

  // record conversation history for AI (DM only, text only)
  if (text && !isGroup(from)) {
    pushHistory(from, fromMe ? 'me' : 'them', text);
  }

  // command parsing
  const parsed = parseCmd(text);
  if (!parsed) {
    // AI auto-reply when .aion or .aimimic is on (DM only)
    if (!fromMe && !isGroup(from) && (state.aiMode === 'on' || state.aiMode === 'mimic')) {
      try {
        const reply = await aiGenerate(from, text);
        if (reply) {
          await sock.sendMessage(from, { text: reply }, { quoted: msg });
          pushHistory(from, 'me', reply);
        }
      } catch (e) {
        console.error('ai reply error:', e?.message);
      }
    }
    return;
  }

  // resolve aliases
  const aliases = state.cmdAliases || {};
  const realName = aliases[parsed.name] || parsed.name;

  let cmd = commands.get(realName);

  // multi-word: ".auto ai reply" -> use first word command
  if (!cmd) {
    cmd = commands.get(parsed.name);
  }
  if (!cmd) return;

  // mode + permissions
  const owner = isOwner(sender);
  const sudo = isSudo(sender, state);

  if (state.maintenance && !owner) {
    try { await sock.sendMessage(from, { text: '🛠 Bot is in maintenance mode. Try later.' }, { quoted: msg }); } catch {}
    return;
  }

  if (state.mode === 'private' && !sudo && !fromMe) return;

  if (cmd.owner && !sudo && !fromMe) {
    try { await sock.sendMessage(from, { text: '⛔ Owner-only command.' }, { quoted: msg }); } catch {}
    return;
  }

  // rent enforcement: rented users get bot in their DM only
  // (everyone else still uses public mode)

  if (state.cmdreact) {
    try { await sock.sendMessage(from, { react: { text: '⚡', key: msg.key } }); } catch {}
  }

  const ctx = buildCtx(sock, msg, parsed, from, sender);

  try {
    await cmd.handler(ctx);
  } catch (e) {
    console.error('cmd error', parsed.name, e?.message);
    try { await sock.sendMessage(from, { text: `❌ Error in .${parsed.name}: ${e.message}` }, { quoted: msg }); } catch {}
  }

  if (state.stealth && fromMe) {
    // try to delete bot's reply trace - not deleting since we want owner to see
  }
}

function buildCtx(sock, msg, parsed, from, sender) {
  const ctxInfo = msg.message?.extendedTextMessage?.contextInfo || {};
  const mentioned = ctxInfo.mentionedJid || [];
  const quoted = ctxInfo.quotedMessage;
  const quotedSender = ctxInfo.participant ? normalizeJid(ctxInfo.participant) : null;
  return {
    sock,
    msg,
    from,
    sender: normalizeJid(sender),
    isGroup: isGroup(from),
    args: parsed.args,
    argText: parsed.argText,
    mentioned,
    quoted,
    quotedSender,
    reply: (text, opts = {}) => sock.sendMessage(from, { text, ...opts }, { quoted: msg }),
  };
}

