import type { WASocket, proto, GroupMetadata } from "@whiskeysockets/baileys";
import { downloadMediaMessage } from "@whiskeysockets/baileys";
import sharp from "sharp";
import OpenAI from "openai";
import { logger } from "../lib/logger";
import {
  BOT_NAME,
  OWNER_JID,
  OWNER_NUMBER,
  isGroup,
  isOwner,
  jidNumber,
  reply,
  uptime,
  type ParsedCommand,
} from "./utils";
import { getState, saveState } from "./state";

const openai = new OpenAI({
  apiKey:
    process.env["OPENAI_API_KEY"] ??
    process.env["AI_INTEGRATIONS_OPENAI_API_KEY"] ??
    "missing",
  baseURL:
    process.env["OPENAI_BASE_URL"] ??
    process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"],
});

interface Ctx {
  sock: WASocket;
  msg: proto.IWebMessageInfo;
  jid: string;
  sender: string;
  cmd: ParsedCommand;
  isGroupChat: boolean;
  groupMeta?: GroupMetadata;
  isAdmin: boolean;
  isBotAdmin: boolean;
}

type Handler = (ctx: Ctx) => Promise<void>;

interface CommandDef {
  name: string;
  aliases?: string[];
  desc: string;
  category: string;
  ownerOnly?: boolean;
  groupOnly?: boolean;
  adminOnly?: boolean;
  botAdmin?: boolean;
  handler: Handler;
}

const cmds: CommandDef[] = [];

const reg = (def: CommandDef): void => {
  cmds.push(def);
};

const fetchJson = async (url: string): Promise<unknown> => {
  const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

const fetchBuffer = async (url: string): Promise<Buffer> => {
  const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
};

const aiChat = async (
  prompt: string,
  model = "gpt-5-mini",
  system?: string,
): Promise<string> => {
  const messages: { role: "system" | "user"; content: string }[] = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: prompt });
  const r = await openai.chat.completions.create({
    model,
    max_completion_tokens: 1024,
    messages,
  });
  return r.choices[0]?.message?.content ?? "(no response)";
};

const requireText = async (ctx: Ctx, hint: string): Promise<string | null> => {
  if (!ctx.cmd.text) {
    await reply(ctx.sock, ctx.msg, `Usage: ${ctx.cmd.prefix}${ctx.cmd.command} ${hint}`);
    return null;
  }
  return ctx.cmd.text;
};

// ───── CORE ─────
reg({
  name: "menu",
  aliases: ["help", "list"],
  desc: "Show all commands",
  category: "CORE",
  handler: async (ctx) => {
    const groups = new Map<string, string[]>();
    for (const c of cmds) {
      if (!groups.has(c.category)) groups.set(c.category, []);
      groups.get(c.category)!.push(`${ctx.cmd.prefix}${c.name} - ${c.desc}`);
    }
    const state = getState();
    const up = uptime(Date.now() - state.startedAt);
    let out = `╭───⬣ *${BOT_NAME}* ──⬣\n`;
    out += `│ Owner: ${OWNER_NUMBER}\n`;
    out += `│ Mode: ${state.mode}\n`;
    out += `│ Uptime: ${up}\n`;
    out += `│ Prefixes: . % ✨️ !\n`;
    for (const [cat, items] of groups) {
      out += `├───⬣ *${cat}* ──⬣\n`;
      for (const it of items) out += `│ ● ${it}\n`;
    }
    out += `╰─────⬣`;
    await reply(ctx.sock, ctx.msg, out);
  },
});

reg({
  name: "alive",
  desc: "Bot status",
  category: "CORE",
  handler: async (ctx) => {
    const state = getState();
    if (state.features.stealth && !isOwner(ctx.sender)) return;
    const up = uptime(Date.now() - state.startedAt);
    await reply(
      ctx.sock,
      ctx.msg,
      `*${BOT_NAME}* is alive\n\nUptime: ${up}\nMode: ${state.mode}\nOwner: wa.me/${OWNER_NUMBER}`,
    );
  },
});

reg({
  name: "ping",
  desc: "Speed test",
  category: "CORE",
  handler: async (ctx) => {
    const t = Date.now();
    await reply(ctx.sock, ctx.msg, `Pong! ${Date.now() - t}ms`);
  },
});

reg({
  name: "owner",
  desc: "Owner info",
  category: "CORE",
  handler: async (ctx) => {
    const jid = ctx.jid;
    await ctx.sock.sendMessage(
      jid,
      {
        contacts: {
          displayName: BOT_NAME + " Owner",
          contacts: [
            {
              displayName: BOT_NAME + " Owner",
              vcard:
                `BEGIN:VCARD\nVERSION:3.0\nFN:${BOT_NAME} Owner\n` +
                `TEL;type=CELL;type=VOICE;waid=${OWNER_NUMBER}:+${OWNER_NUMBER}\nEND:VCARD`,
            },
          ],
        },
      },
      { quoted: ctx.msg as never },
    );
  },
});

reg({
  name: "mode",
  desc: "Switch public/private",
  category: "CORE",
  ownerOnly: true,
  handler: async (ctx) => {
    const arg = ctx.cmd.args[0]?.toLowerCase();
    if (arg !== "public" && arg !== "private") {
      await reply(ctx.sock, ctx.msg, `Usage: ${ctx.cmd.prefix}mode public|private`);
      return;
    }
    getState().mode = arg;
    saveState();
    await reply(ctx.sock, ctx.msg, `Mode set to *${arg}*`);
  },
});

reg({
  name: "update",
  desc: "Update bot",
  category: "CORE",
  ownerOnly: true,
  handler: async (ctx) => {
    await reply(
      ctx.sock,
      ctx.msg,
      "No update channel configured. Pull the latest code from your repo and restart.",
    );
  },
});

reg({
  name: "restart",
  desc: "Restart bot",
  category: "CORE",
  ownerOnly: true,
  handler: async (ctx) => {
    await reply(ctx.sock, ctx.msg, "Restarting...");
    setTimeout(() => process.exit(0), 500);
  },
});

// ───── AUTO FEATURES ─────
const toggleable = [
  "autoreply",
  "autoread",
  "autotyping",
  "autoreact",
  "antidelete",
  "anticall",
  "pmblocker",
  "stealth",
] as const;

for (const key of toggleable) {
  reg({
    name: key,
    desc: `Toggle ${key} on/off`,
    category: "AUTO FEATURES",
    ownerOnly: true,
    handler: async (ctx) => {
      const v = ctx.cmd.args[0]?.toLowerCase();
      if (v !== "on" && v !== "off") {
        await reply(ctx.sock, ctx.msg, `Usage: ${ctx.cmd.prefix}${key} on|off`);
        return;
      }
      const features = getState().features as Record<string, unknown>;
      features[key] = v === "on";
      saveState();
      await reply(ctx.sock, ctx.msg, `${key} is now *${v}*`);
    },
  });
}

reg({
  name: "autostatus",
  desc: "Auto view status",
  category: "AUTO FEATURES",
  ownerOnly: true,
  handler: async (ctx) => {
    const v = ctx.cmd.args[0]?.toLowerCase();
    if (v !== "view" && v !== "off") {
      await reply(ctx.sock, ctx.msg, `Usage: ${ctx.cmd.prefix}autostatus view|off`);
      return;
    }
    getState().features.autostatus = v === "view";
    saveState();
    await reply(ctx.sock, ctx.msg, `autostatus: ${v}`);
  },
});

// ───── AI ─────
reg({
  name: "gpt",
  aliases: ["ai", "chatgpt"],
  desc: "ChatGPT",
  category: "AI",
  handler: async (ctx) => {
    const text = await requireText(ctx, "<question>");
    if (!text) return;
    try {
      const ans = await aiChat(text, "gpt-5-mini");
      await reply(ctx.sock, ctx.msg, ans);
    } catch (e) {
      await reply(ctx.sock, ctx.msg, `AI error: ${(e as Error).message}`);
    }
  },
});

reg({
  name: "llama",
  desc: "Llama AI",
  category: "AI",
  handler: async (ctx) => {
    const text = await requireText(ctx, "<question>");
    if (!text) return;
    try {
      const ans = await aiChat(text, "gpt-5-mini", "Respond like Llama assistant.");
      await reply(ctx.sock, ctx.msg, ans);
    } catch (e) {
      await reply(ctx.sock, ctx.msg, `AI error: ${(e as Error).message}`);
    }
  },
});

reg({
  name: "mistral",
  desc: "Mistral AI",
  category: "AI",
  handler: async (ctx) => {
    const text = await requireText(ctx, "<question>");
    if (!text) return;
    try {
      const ans = await aiChat(text, "gpt-5-mini", "Respond like Mistral assistant.");
      await reply(ctx.sock, ctx.msg, ans);
    } catch (e) {
      await reply(ctx.sock, ctx.msg, `AI error: ${(e as Error).message}`);
    }
  },
});

const genImage = async (ctx: Ctx, prompt: string): Promise<void> => {
  try {
    const r = await openai.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024",
    });
    const b64 = r.data?.[0]?.b64_json;
    if (!b64) throw new Error("no image");
    const buf = Buffer.from(b64, "base64");
    await ctx.sock.sendMessage(
      ctx.jid,
      { image: buf, caption: prompt },
      { quoted: ctx.msg as never },
    );
  } catch (e) {
    await reply(ctx.sock, ctx.msg, `Image error: ${(e as Error).message}`);
  }
};

reg({
  name: "dalle",
  desc: "AI image gen",
  category: "AI",
  handler: async (ctx) => {
    const text = await requireText(ctx, "<prompt>");
    if (!text) return;
    await genImage(ctx, text);
  },
});

reg({
  name: "flux",
  desc: "AI image gen",
  category: "AI",
  handler: async (ctx) => {
    const text = await requireText(ctx, "<prompt>");
    if (!text) return;
    await genImage(ctx, text);
  },
});

// ───── DOWNLOADER ─────
const ytSearch = async (q: string): Promise<{ title: string; url: string } | null> => {
  try {
    const html = await (await fetch(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
      { headers: { "user-agent": "Mozilla/5.0" } },
    )).text();
    const m = html.match(/"videoId":"([\w-]{11})".*?"title":\{"runs":\[\{"text":"([^"]+)"/);
    if (!m) return null;
    return { title: m[2]!, url: `https://www.youtube.com/watch?v=${m[1]}` };
  } catch {
    return null;
  }
};

const ytDownload = async (
  ctx: Ctx,
  query: string,
  kind: "audio" | "video",
): Promise<void> => {
  const r = await ytSearch(query);
  if (!r) {
    await reply(ctx.sock, ctx.msg, "No results found.");
    return;
  }
  await reply(
    ctx.sock,
    ctx.msg,
    `Found: *${r.title}*\n${r.url}\n\nDownload via your preferred service. (Direct media downloading requires a third-party API.)`,
  );
};

reg({
  name: "play",
  desc: "YouTube audio",
  category: "DOWNLOADER",
  handler: async (ctx) => {
    const t = await requireText(ctx, "<song>");
    if (!t) return;
    await ytDownload(ctx, t, "audio");
  },
});
reg({
  name: "song",
  desc: "Download song",
  category: "DOWNLOADER",
  handler: async (ctx) => {
    const t = await requireText(ctx, "<song>");
    if (!t) return;
    await ytDownload(ctx, t, "audio");
  },
});
reg({
  name: "video",
  desc: "Download video",
  category: "DOWNLOADER",
  handler: async (ctx) => {
    const t = await requireText(ctx, "<query>");
    if (!t) return;
    await ytDownload(ctx, t, "video");
  },
});

const linkDownload = (label: string) => async (ctx: Ctx) => {
  const t = await requireText(ctx, "<url>");
  if (!t) return;
  await reply(
    ctx.sock,
    ctx.msg,
    `${label} download requires a third-party API. URL received: ${t}`,
  );
};

reg({ name: "tiktok", desc: "TikTok no watermark", category: "DOWNLOADER", handler: linkDownload("TikTok") });
reg({ name: "instagram", desc: "IG reel/story/post", category: "DOWNLOADER", handler: linkDownload("Instagram") });
reg({ name: "facebook", desc: "FB video", category: "DOWNLOADER", handler: linkDownload("Facebook") });
reg({ name: "twitter", desc: "Twitter/X video", category: "DOWNLOADER", handler: linkDownload("Twitter") });
reg({ name: "spotify", desc: "Spotify song", category: "DOWNLOADER", handler: linkDownload("Spotify") });
reg({ name: "apkdl", desc: "Download APK", category: "DOWNLOADER", handler: linkDownload("APK") });

// ───── GROUP ADMIN ─────
const getMentioned = (msg: proto.IWebMessageInfo): string[] => {
  const ctxInfo = msg.message?.extendedTextMessage?.contextInfo;
  return ctxInfo?.mentionedJid ?? [];
};
const getQuotedSender = (msg: proto.IWebMessageInfo): string | null => {
  return msg.message?.extendedTextMessage?.contextInfo?.participant ?? null;
};
const targetUsers = (msg: proto.IWebMessageInfo, args: string[]): string[] => {
  const mentioned = getMentioned(msg);
  if (mentioned.length) return mentioned;
  const quoted = getQuotedSender(msg);
  if (quoted) return [quoted];
  const fromArgs = args
    .filter((a) => /^\d{6,}$/.test(a))
    .map((n) => `${n}@s.whatsapp.net`);
  return fromArgs;
};

reg({
  name: "kick",
  desc: "Remove user",
  category: "GROUP ADMIN",
  groupOnly: true,
  adminOnly: true,
  botAdmin: true,
  handler: async (ctx) => {
    const t = targetUsers(ctx.msg, ctx.cmd.args);
    if (!t.length) {
      await reply(ctx.sock, ctx.msg, "Mention or reply to user.");
      return;
    }
    await ctx.sock.groupParticipantsUpdate(ctx.jid, t, "remove");
    await reply(ctx.sock, ctx.msg, "Removed.");
  },
});

reg({
  name: "add",
  desc: "Add user",
  category: "GROUP ADMIN",
  groupOnly: true,
  adminOnly: true,
  botAdmin: true,
  handler: async (ctx) => {
    const t = targetUsers(ctx.msg, ctx.cmd.args);
    if (!t.length) {
      await reply(ctx.sock, ctx.msg, "Provide number(s).");
      return;
    }
    await ctx.sock.groupParticipantsUpdate(ctx.jid, t, "add");
    await reply(ctx.sock, ctx.msg, "Added.");
  },
});

reg({
  name: "promote",
  desc: "Make admin",
  category: "GROUP ADMIN",
  groupOnly: true,
  adminOnly: true,
  botAdmin: true,
  handler: async (ctx) => {
    const t = targetUsers(ctx.msg, ctx.cmd.args);
    if (!t.length) return reply(ctx.sock, ctx.msg, "Mention user.");
    await ctx.sock.groupParticipantsUpdate(ctx.jid, t, "promote");
    await reply(ctx.sock, ctx.msg, "Promoted.");
  },
});

reg({
  name: "demote",
  desc: "Remove admin",
  category: "GROUP ADMIN",
  groupOnly: true,
  adminOnly: true,
  botAdmin: true,
  handler: async (ctx) => {
    const t = targetUsers(ctx.msg, ctx.cmd.args);
    if (!t.length) return reply(ctx.sock, ctx.msg, "Mention user.");
    await ctx.sock.groupParticipantsUpdate(ctx.jid, t, "demote");
    await reply(ctx.sock, ctx.msg, "Demoted.");
  },
});

reg({
  name: "tagall",
  desc: "Tag all members",
  category: "GROUP ADMIN",
  groupOnly: true,
  adminOnly: true,
  handler: async (ctx) => {
    const meta = ctx.groupMeta!;
    const mentions = meta.participants.map((p) => p.id);
    const text =
      `*Tagged by ${jidNumber(ctx.sender)}*\n${ctx.cmd.text || "Heads up!"}\n\n` +
      mentions.map((m) => `@${jidNumber(m)}`).join(" ");
    await ctx.sock.sendMessage(ctx.jid, { text, mentions }, { quoted: ctx.msg as never });
  },
});

reg({
  name: "hidetag",
  desc: "Hidden tag",
  category: "GROUP ADMIN",
  groupOnly: true,
  adminOnly: true,
  handler: async (ctx) => {
    const meta = ctx.groupMeta!;
    const mentions = meta.participants.map((p) => p.id);
    await ctx.sock.sendMessage(
      ctx.jid,
      { text: ctx.cmd.text || "📢", mentions },
      { quoted: ctx.msg as never },
    );
  },
});

reg({
  name: "mute",
  desc: "Close group",
  category: "GROUP ADMIN",
  groupOnly: true,
  adminOnly: true,
  botAdmin: true,
  handler: async (ctx) => {
    await ctx.sock.groupSettingUpdate(ctx.jid, "announcement");
    await reply(ctx.sock, ctx.msg, "Group closed (admins only).");
  },
});

reg({
  name: "unmute",
  desc: "Open group",
  category: "GROUP ADMIN",
  groupOnly: true,
  adminOnly: true,
  botAdmin: true,
  handler: async (ctx) => {
    await ctx.sock.groupSettingUpdate(ctx.jid, "not_announcement");
    await reply(ctx.sock, ctx.msg, "Group opened.");
  },
});

const groupToggle =
  (key: "antilink" | "antibadword" | "welcome" | "goodbye") =>
  async (ctx: Ctx): Promise<void> => {
    const v = ctx.cmd.args[0]?.toLowerCase();
    if (v !== "on" && v !== "off") {
      await reply(ctx.sock, ctx.msg, `Usage: ${ctx.cmd.prefix}${key} on|off`);
      return;
    }
    getState().features[key][ctx.jid] = v === "on";
    saveState();
    await reply(ctx.sock, ctx.msg, `${key}: ${v}`);
  };

reg({ name: "antilink", desc: "Auto delete links", category: "GROUP ADMIN", groupOnly: true, adminOnly: true, handler: groupToggle("antilink") });
reg({ name: "antibadword", desc: "Auto delete bad words", category: "GROUP ADMIN", groupOnly: true, adminOnly: true, handler: groupToggle("antibadword") });
reg({ name: "welcome", desc: "Welcome message", category: "GROUP ADMIN", groupOnly: true, adminOnly: true, handler: groupToggle("welcome") });
reg({ name: "goodbye", desc: "Leave message", category: "GROUP ADMIN", groupOnly: true, adminOnly: true, handler: groupToggle("goodbye") });

reg({
  name: "warn",
  desc: "Warn user",
  category: "GROUP ADMIN",
  groupOnly: true,
  adminOnly: true,
  handler: async (ctx) => {
    const [target] = targetUsers(ctx.msg, ctx.cmd.args);
    if (!target) return reply(ctx.sock, ctx.msg, "Mention user.");
    const w = getState().warnings;
    w[ctx.jid] ??= {};
    w[ctx.jid]![target] = (w[ctx.jid]![target] ?? 0) + 1;
    saveState();
    const count = w[ctx.jid]![target]!;
    await ctx.sock.sendMessage(
      ctx.jid,
      { text: `@${jidNumber(target)} warned (${count}/3)`, mentions: [target] },
      { quoted: ctx.msg as never },
    );
    if (count >= 3 && ctx.isBotAdmin) {
      await ctx.sock.groupParticipantsUpdate(ctx.jid, [target], "remove");
      w[ctx.jid]![target] = 0;
      saveState();
    }
  },
});

reg({
  name: "warnings",
  desc: "Check warns",
  category: "GROUP ADMIN",
  groupOnly: true,
  handler: async (ctx) => {
    const [target] = targetUsers(ctx.msg, ctx.cmd.args);
    const t = target ?? ctx.sender;
    const c = getState().warnings[ctx.jid]?.[t] ?? 0;
    await ctx.sock.sendMessage(
      ctx.jid,
      { text: `@${jidNumber(t)} has ${c} warnings`, mentions: [t] },
      { quoted: ctx.msg as never },
    );
  },
});

// ───── STICKER ─────
const getMediaMessage = (
  msg: proto.IWebMessageInfo,
): proto.IWebMessageInfo | null => {
  if (msg.message?.imageMessage || msg.message?.videoMessage) return msg;
  const q = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (q?.imageMessage || q?.videoMessage) {
    return {
      key: msg.key,
      message: q,
    } as proto.IWebMessageInfo;
  }
  return null;
};

reg({
  name: "sticker",
  aliases: ["s"],
  desc: "Image to sticker",
  category: "STICKER",
  handler: async (ctx) => {
    const m = getMediaMessage(ctx.msg);
    if (!m) {
      await reply(ctx.sock, ctx.msg, "Send/reply an image with the command.");
      return;
    }
    try {
      const buf = (await downloadMediaMessage(m as never, "buffer", {})) as Buffer;
      const webp = await sharp(buf)
        .resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .webp()
        .toBuffer();
      await ctx.sock.sendMessage(ctx.jid, { sticker: webp }, { quoted: ctx.msg as never });
    } catch (e) {
      await reply(ctx.sock, ctx.msg, `Sticker error: ${(e as Error).message}`);
    }
  },
});

reg({
  name: "attp",
  desc: "Text to animated sticker",
  category: "STICKER",
  handler: async (ctx) => {
    const t = await requireText(ctx, "<text>");
    if (!t) return;
    try {
      const buf = await fetchBuffer(
        `https://api.popcat.xyz/attp?text=${encodeURIComponent(t)}`,
      );
      await ctx.sock.sendMessage(ctx.jid, { sticker: buf }, { quoted: ctx.msg as never });
    } catch (e) {
      await reply(ctx.sock, ctx.msg, `Error: ${(e as Error).message}`);
    }
  },
});

reg({
  name: "take",
  desc: "Change sticker pack",
  category: "STICKER",
  handler: async (ctx) => {
    const m = getMediaMessage(ctx.msg);
    if (!m && !ctx.msg.message?.stickerMessage) {
      await reply(ctx.sock, ctx.msg, "Reply to a sticker.");
      return;
    }
    await reply(ctx.sock, ctx.msg, `Pack name: ${ctx.cmd.text || BOT_NAME}`);
  },
});

reg({
  name: "emojimix",
  desc: "Mix 2 emojis",
  category: "STICKER",
  handler: async (ctx) => {
    const [a, b] = ctx.cmd.args;
    if (!a || !b) {
      await reply(ctx.sock, ctx.msg, `Usage: ${ctx.cmd.prefix}emojimix 😀 😍`);
      return;
    }
    try {
      const res = (await fetchJson(
        `https://tenor.googleapis.com/v2/featured?key=AIzaSyAyimkuYQYF_FXVALexPuGQctUWRURdCYQ&contentfilter=high&media_filter=png_transparent&component=proactive&collection=emoji_kitchen_v5&q=${encodeURIComponent(a)}_${encodeURIComponent(b)}`,
      )) as { results?: Array<{ url?: string }> };
      const url = res.results?.[0]?.url;
      if (!url) throw new Error("no mix");
      const buf = await fetchBuffer(url);
      const webp = await sharp(buf).resize(512, 512, { fit: "contain" }).webp().toBuffer();
      await ctx.sock.sendMessage(ctx.jid, { sticker: webp }, { quoted: ctx.msg as never });
    } catch (e) {
      await reply(ctx.sock, ctx.msg, `Mix not found: ${(e as Error).message}`);
    }
  },
});

// ───── TOOLS ─────
reg({
  name: "removebg",
  desc: "Remove image BG",
  category: "TOOLS",
  handler: async (ctx) => {
    await reply(ctx.sock, ctx.msg, "removebg requires a remove.bg API key. Add REMOVEBG_KEY env var.");
  },
});

reg({
  name: "qrcode",
  desc: "Make QR code",
  category: "TOOLS",
  handler: async (ctx) => {
    const t = await requireText(ctx, "<text>");
    if (!t) return;
    const qrcode = await import("qrcode");
    const buf = await qrcode.toBuffer(t, { width: 512 });
    await ctx.sock.sendMessage(ctx.jid, { image: buf, caption: t }, { quoted: ctx.msg as never });
  },
});

reg({
  name: "readqr",
  desc: "Scan QR code",
  category: "TOOLS",
  handler: async (ctx) => {
    await reply(ctx.sock, ctx.msg, "readqr requires a QR decoding library. Send the QR image to a decoder.");
  },
});

reg({
  name: "translate",
  aliases: ["tr"],
  desc: "Translate text",
  category: "TOOLS",
  handler: async (ctx) => {
    const lang = ctx.cmd.args[0];
    const text = ctx.cmd.args.slice(1).join(" ");
    if (!lang || !text) {
      await reply(ctx.sock, ctx.msg, `Usage: ${ctx.cmd.prefix}translate <lang> <text>`);
      return;
    }
    try {
      const r = (await fetchJson(
        `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=auto|${encodeURIComponent(lang)}`,
      )) as { responseData?: { translatedText?: string } };
      await reply(ctx.sock, ctx.msg, r.responseData?.translatedText ?? "(no result)");
    } catch (e) {
      await reply(ctx.sock, ctx.msg, `Error: ${(e as Error).message}`);
    }
  },
});

reg({
  name: "tts",
  desc: "Text to speech",
  category: "TOOLS",
  handler: async (ctx) => {
    const text = await requireText(ctx, "<text>");
    if (!text) return;
    try {
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=en&client=tw-ob`;
      const buf = await fetchBuffer(url);
      await ctx.sock.sendMessage(
        ctx.jid,
        { audio: buf, mimetype: "audio/mp4", ptt: true },
        { quoted: ctx.msg as never },
      );
    } catch (e) {
      await reply(ctx.sock, ctx.msg, `Error: ${(e as Error).message}`);
    }
  },
});

reg({
  name: "tourl",
  desc: "Upload to link",
  category: "TOOLS",
  handler: async (ctx) => {
    const m = getMediaMessage(ctx.msg);
    if (!m) {
      await reply(ctx.sock, ctx.msg, "Reply to media.");
      return;
    }
    try {
      const buf = (await downloadMediaMessage(m as never, "buffer", {})) as Buffer;
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(buf)]), "file.bin");
      const r = await fetch("https://0x0.st", { method: "POST", body: form });
      const url = (await r.text()).trim();
      await reply(ctx.sock, ctx.msg, url);
    } catch (e) {
      await reply(ctx.sock, ctx.msg, `Error: ${(e as Error).message}`);
    }
  },
});

reg({
  name: "screenshot",
  aliases: ["ss"],
  desc: "SS of website",
  category: "TOOLS",
  handler: async (ctx) => {
    const url = await requireText(ctx, "<url>");
    if (!url) return;
    try {
      const api = `https://image.thum.io/get/width/1200/${url}`;
      const buf = await fetchBuffer(api);
      await ctx.sock.sendMessage(ctx.jid, { image: buf, caption: url }, { quoted: ctx.msg as never });
    } catch (e) {
      await reply(ctx.sock, ctx.msg, `Error: ${(e as Error).message}`);
    }
  },
});

// ───── FUN + GAMES ─────
const tttGames = new Map<string, { board: string[]; turn: "X" | "O"; players: Record<"X" | "O", string> }>();

reg({
  name: "tictactoe",
  aliases: ["ttt"],
  desc: "Play XO",
  category: "FUN+GAMES",
  handler: async (ctx) => {
    const opp = targetUsers(ctx.msg, ctx.cmd.args)[0];
    if (!opp) return reply(ctx.sock, ctx.msg, "Mention an opponent.");
    tttGames.set(ctx.jid, {
      board: Array(9).fill(" "),
      turn: "X",
      players: { X: ctx.sender, O: opp },
    });
    await reply(ctx.sock, ctx.msg, `Game started! Use ${ctx.cmd.prefix}move <1-9>`);
  },
});

reg({
  name: "move",
  desc: "TTT move",
  category: "FUN+GAMES",
  handler: async (ctx) => {
    const g = tttGames.get(ctx.jid);
    if (!g) return reply(ctx.sock, ctx.msg, "No game. Start with .tictactoe @user");
    if (ctx.sender !== g.players[g.turn])
      return reply(ctx.sock, ctx.msg, "Not your turn.");
    const pos = parseInt(ctx.cmd.args[0] ?? "0", 10) - 1;
    if (pos < 0 || pos > 8 || g.board[pos] !== " ")
      return reply(ctx.sock, ctx.msg, "Invalid position.");
    g.board[pos] = g.turn;
    const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
    const won = lines.some((l) => l.every((i) => g.board[i] === g.turn));
    const render = `${g.board[0]}|${g.board[1]}|${g.board[2]}\n${g.board[3]}|${g.board[4]}|${g.board[5]}\n${g.board[6]}|${g.board[7]}|${g.board[8]}`;
    if (won) {
      tttGames.delete(ctx.jid);
      return reply(ctx.sock, ctx.msg, `${render}\n\n${g.turn} wins!`);
    }
    if (g.board.every((c) => c !== " ")) {
      tttGames.delete(ctx.jid);
      return reply(ctx.sock, ctx.msg, `${render}\n\nDraw!`);
    }
    g.turn = g.turn === "X" ? "O" : "X";
    await reply(ctx.sock, ctx.msg, `${render}\n\nNext: ${g.turn}`);
  },
});

reg({
  name: "trivia",
  desc: "Quiz game",
  category: "FUN+GAMES",
  handler: async (ctx) => {
    try {
      const r = (await fetchJson("https://opentdb.com/api.php?amount=1&type=multiple")) as {
        results: Array<{ question: string; correct_answer: string; incorrect_answers: string[] }>;
      };
      const q = r.results[0]!;
      const choices = [...q.incorrect_answers, q.correct_answer].sort(() => Math.random() - 0.5);
      await reply(
        ctx.sock,
        ctx.msg,
        `*Trivia*\n${decodeURIComponent(q.question)}\n\n${choices.map((c, i) => `${i + 1}. ${c}`).join("\n")}\n\nAnswer: ||${q.correct_answer}||`,
      );
    } catch (e) {
      await reply(ctx.sock, ctx.msg, `Error: ${(e as Error).message}`);
    }
  },
});

const truths = [
  "What's the most embarrassing thing you've done?",
  "Who was your first crush?",
  "What's a secret you've never told anyone?",
  "What's your biggest fear?",
];
const dares = [
  "Send a voice note singing your favorite song.",
  "Change your profile picture to a meme for 1 hour.",
  "Send the last photo in your gallery.",
  "Type with your eyes closed for the next message.",
];

reg({
  name: "truth",
  desc: "Truth question",
  category: "FUN+GAMES",
  handler: async (ctx) => reply(ctx.sock, ctx.msg, truths[Math.floor(Math.random() * truths.length)]!),
});
reg({
  name: "dare",
  desc: "Dare question",
  category: "FUN+GAMES",
  handler: async (ctx) => reply(ctx.sock, ctx.msg, dares[Math.floor(Math.random() * dares.length)]!),
});

reg({
  name: "meme",
  desc: "Random memes",
  category: "FUN+GAMES",
  handler: async (ctx) => {
    try {
      const r = (await fetchJson("https://meme-api.com/gimme")) as { url: string; title: string };
      const buf = await fetchBuffer(r.url);
      await ctx.sock.sendMessage(ctx.jid, { image: buf, caption: r.title }, { quoted: ctx.msg as never });
    } catch (e) {
      await reply(ctx.sock, ctx.msg, `Error: ${(e as Error).message}`);
    }
  },
});

reg({
  name: "joke",
  desc: "Random jokes",
  category: "FUN+GAMES",
  handler: async (ctx) => {
    try {
      const r = (await fetchJson("https://official-joke-api.appspot.com/random_joke")) as {
        setup: string; punchline: string;
      };
      await reply(ctx.sock, ctx.msg, `${r.setup}\n\n${r.punchline}`);
    } catch (e) {
      await reply(ctx.sock, ctx.msg, `Error: ${(e as Error).message}`);
    }
  },
});

// ───── INFO ─────
reg({
  name: "weather",
  desc: "Check weather",
  category: "INFO",
  handler: async (ctx) => {
    const city = await requireText(ctx, "<city>");
    if (!city) return;
    try {
      const r = await (await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=3`)).text();
      await reply(ctx.sock, ctx.msg, r);
    } catch (e) {
      await reply(ctx.sock, ctx.msg, `Error: ${(e as Error).message}`);
    }
  },
});

reg({
  name: "news",
  desc: "Latest news",
  category: "INFO",
  handler: async (ctx) => {
    try {
      const r = await (await fetch("https://news.google.com/rss")).text();
      const items = [...r.matchAll(/<title>([^<]+)<\/title>/g)].slice(1, 6).map((m) => m[1]);
      await reply(ctx.sock, ctx.msg, `*Top news*\n\n${items.map((t, i) => `${i + 1}. ${t}`).join("\n")}`);
    } catch (e) {
      await reply(ctx.sock, ctx.msg, `Error: ${(e as Error).message}`);
    }
  },
});

reg({
  name: "define",
  desc: "Dictionary",
  category: "INFO",
  handler: async (ctx) => {
    const w = await requireText(ctx, "<word>");
    if (!w) return;
    try {
      const r = (await fetchJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`)) as Array<{
        meanings: Array<{ partOfSpeech: string; definitions: Array<{ definition: string }> }>;
      }>;
      const m = r[0]?.meanings?.[0];
      const def = m?.definitions?.[0]?.definition ?? "Not found";
      await reply(ctx.sock, ctx.msg, `*${w}* (${m?.partOfSpeech ?? ""})\n${def}`);
    } catch (e) {
      await reply(ctx.sock, ctx.msg, `Error: ${(e as Error).message}`);
    }
  },
});

reg({
  name: "wiki",
  desc: "Wikipedia",
  category: "INFO",
  handler: async (ctx) => {
    const q = await requireText(ctx, "<topic>");
    if (!q) return;
    try {
      const r = (await fetchJson(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(q)}`,
      )) as { title?: string; extract?: string };
      await reply(ctx.sock, ctx.msg, `*${r.title}*\n\n${r.extract ?? "No summary"}`);
    } catch (e) {
      await reply(ctx.sock, ctx.msg, `Error: ${(e as Error).message}`);
    }
  },
});

reg({
  name: "movie",
  desc: "Movie details",
  category: "INFO",
  handler: async (ctx) => {
    const q = await requireText(ctx, "<title>");
    if (!q) return;
    try {
      const r = (await fetchJson(
        `https://www.omdbapi.com/?t=${encodeURIComponent(q)}&apikey=trilogy`,
      )) as Record<string, string>;
      if (r["Response"] === "False") {
        await reply(ctx.sock, ctx.msg, r["Error"] ?? "Not found");
        return;
      }
      await reply(
        ctx.sock,
        ctx.msg,
        `*${r["Title"]}* (${r["Year"]})\n⭐ ${r["imdbRating"]}\n\n${r["Plot"]}`,
      );
    } catch (e) {
      await reply(ctx.sock, ctx.msg, `Error: ${(e as Error).message}`);
    }
  },
});

reg({
  name: "quran",
  desc: "Quran verses",
  category: "INFO",
  handler: async (ctx) => {
    const arg = ctx.cmd.args[0] ?? `${Math.ceil(Math.random() * 114)}`;
    const [s, v] = arg.split(":");
    try {
      const r = (await fetchJson(
        `https://api.alquran.cloud/v1/ayah/${s}:${v ?? "1"}/editions/quran-uthmani,en.asad`,
      )) as { data: Array<{ text: string; surah: { englishName: string }; numberInSurah: number }> };
      const ar = r.data[0]; const en = r.data[1];
      await reply(
        ctx.sock,
        ctx.msg,
        `*${ar?.surah.englishName} ${ar?.numberInSurah}*\n\n${ar?.text}\n\n${en?.text}`,
      );
    } catch (e) {
      await reply(ctx.sock, ctx.msg, `Error: ${(e as Error).message}`);
    }
  },
});

export const allCommands = cmds;

export async function dispatch(
  sock: WASocket,
  msg: proto.IWebMessageInfo,
  cmd: ParsedCommand,
): Promise<boolean> {
  const def = cmds.find(
    (c) => c.name === cmd.command || c.aliases?.includes(cmd.command),
  );
  if (!def) return false;

  const jid = msg.key!.remoteJid!;
  const sender = msg.key!.participant ?? msg.key!.remoteJid!;
  const isGroupChat = isGroup(jid);
  // Treat fromMe (messages from the linked owner account itself) as owner —
  // WhatsApp's new @lid identifiers can make jid-based owner checks fail.
  const fromMe = msg.key?.fromMe ?? false;
  const ownerCheck = (s: string) => fromMe || isOwner(s);

  let groupMeta: GroupMetadata | undefined;
  let isAdmin = false;
  let isBotAdmin = false;
  if (isGroupChat) {
    try {
      groupMeta = await sock.groupMetadata(jid);
      const me = jidNumber(sock.user?.id ?? "");
      isAdmin = !!groupMeta.participants.find(
        (p) => p.id === sender && (p.admin === "admin" || p.admin === "superadmin"),
      );
      isBotAdmin = !!groupMeta.participants.find(
        (p) =>
          jidNumber(p.id) === me && (p.admin === "admin" || p.admin === "superadmin"),
      );
    } catch {
      /* ignore */
    }
  }

  if (def.ownerOnly && !ownerCheck(sender)) {
    await reply(sock, msg, "Owner only.");
    return true;
  }
  if (def.groupOnly && !isGroupChat) {
    await reply(sock, msg, "Group only.");
    return true;
  }
  if (def.adminOnly && !isAdmin && !ownerCheck(sender)) {
    await reply(sock, msg, "Admin only.");
    return true;
  }
  if (def.botAdmin && !isBotAdmin) {
    await reply(sock, msg, "Make me admin first.");
    return true;
  }

  const state = getState();
  if (state.mode === "private" && !ownerCheck(sender)) return true;

  try {
    await def.handler({
      sock,
      msg,
      jid,
      sender,
      cmd,
      isGroupChat,
      groupMeta,
      isAdmin,
      isBotAdmin,
    });
  } catch (e) {
    logger.error({ err: e, cmd: cmd.command }, "command failed");
    await reply(sock, msg, `Error: ${(e as Error).message}`);
  }
  return true;
}

void OWNER_JID;
