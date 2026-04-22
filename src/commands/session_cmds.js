import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { clearAuth } from '../session.js';
import { setState } from '../state.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function registerSession(register) {
  register('clearsession', { desc: 'Wipe auth files (forces re-login)', group: 'session', owner: true }, async (ctx) => {
    await ctx.reply('Clearing session and exiting. Bot will restart.');
    clearAuth();
    setTimeout(() => process.exit(0), 800);
  });

  register('cleartmp', { desc: 'Clear bot tmp/data files', group: 'session', owner: true }, async (ctx) => {
    const tmp = path.join(__dirname, '..', '..', 'data', 'tmp');
    if (fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    await ctx.reply('tmp cleared.');
  });

  register('setbio', { desc: 'Set WhatsApp bio', group: 'session', owner: true }, async (ctx) => {
    const t = ctx.argText.trim();
    if (!t) return ctx.reply('Usage: .setbio <text>');
    await ctx.sock.updateProfileStatus(t);
    setState({ bio: t });
    await ctx.reply('Bio updated.');
  });

  register('setpp', { desc: 'Set profile picture (reply to image)', group: 'session', owner: true }, async (ctx) => {
    if (!ctx.quoted?.imageMessage) return ctx.reply('Reply to an image.');
    try {
      const { downloadMediaMessage } = await import('@whiskeysockets/baileys');
      const buf = await downloadMediaMessage(
        { message: ctx.quoted, key: ctx.msg.message.extendedTextMessage.contextInfo },
        'buffer', {}, { reuploadRequest: ctx.sock.updateMediaMessage }
      );
      await ctx.sock.updateProfilePicture(ctx.sock.user.id, buf);
      await ctx.reply('Profile picture updated.');
    } catch (e) {
      await ctx.reply('Failed: ' + e.message);
    }
  });
}
