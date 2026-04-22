import type { WASocket, proto } from "@whiskeysockets/baileys";

export const PREFIXES = [".", "%", "✨️", "✨", "!"];

export const OWNER_NUMBER = "256752233886";
export const OWNER_JID = `${OWNER_NUMBER}@s.whatsapp.net`;
export const BOT_NAME = "Trailer Liers";

export interface ParsedCommand {
  prefix: string;
  command: string;
  args: string[];
  text: string;
  raw: string;
}

export function parseCommand(body: string): ParsedCommand | null {
  if (!body) return null;
  const trimmed = body.trimStart();
  let used: string | null = null;
  for (const p of PREFIXES) {
    if (trimmed.startsWith(p)) {
      used = p;
      break;
    }
  }
  if (!used) return null;
  const rest = trimmed.slice(used.length).trim();
  if (!rest) return null;
  const parts = rest.split(/\s+/);
  const command = (parts.shift() ?? "").toLowerCase();
  return {
    prefix: used,
    command,
    args: parts,
    text: parts.join(" "),
    raw: body,
  };
}

export function getMessageText(msg: proto.IWebMessageInfo): string {
  const m = msg.message;
  if (!m) return "";
  return (
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    m.documentMessage?.caption ??
    ""
  );
}

export function isGroup(jid: string): boolean {
  return jid.endsWith("@g.us");
}

export function jidNumber(jid: string): string {
  return jid.split("@")[0]?.split(":")[0] ?? "";
}

export function isOwner(jid: string): boolean {
  return jidNumber(jid) === OWNER_NUMBER;
}

export function uptime(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${d}d ${h}h ${m}m ${s}s`;
}

export async function reply(
  sock: WASocket,
  msg: proto.IWebMessageInfo,
  text: string,
): Promise<void> {
  const jid = msg.key?.remoteJid;
  if (!jid) return;
  await sock.sendMessage(jid, { text }, { quoted: msg as never });
}
