import { config } from './config.js';

export function stripPrefix(text) {
  if (!text) return null;
  for (const p of config.PREFIXES) {
    if (text.startsWith(p)) return text.slice(p.length).trimStart();
  }
  return null;
}

export function parseCmd(text) {
  const stripped = stripPrefix(text);
  if (stripped === null) return null;
  const parts = stripped.split(/\s+/);
  const name = (parts.shift() || '').toLowerCase();
  if (!name) return null;
  return { name, args: parts, argText: stripped.slice(name.length).trim(), raw: text };
}

export function isOwner(jid) {
  if (!jid) return false;
  return jid.split('@')[0].split(':')[0] === config.OWNER_NUMBER;
}

export function isSudo(jid, state) {
  return isOwner(jid) || (state.sudos || []).includes(normalizeJid(jid));
}

export function normalizeJid(jid) {
  if (!jid) return jid;
  return jid.replace(/:\d+@/, '@');
}

export function extractText(msg) {
  const m = msg.message || {};
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.listResponseMessage?.title ||
    ''
  );
}

export function senderJid(msg) {
  if (msg.key.fromMe) return msg.key.participant || msg.key.remoteJid;
  return msg.key.participant || msg.key.remoteJid;
}

export function isGroup(jid) {
  return jid?.endsWith('@g.us');
}
