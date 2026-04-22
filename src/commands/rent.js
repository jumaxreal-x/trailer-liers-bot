import { getState, setState } from '../state.js';
import { normalizeJid } from '../utils.js';

export function registerRent(register) {
  register('rentbot', { desc: 'Rent bot to user: .rentbot @user <days>', group: 'rent', owner: true }, async (ctx) => {
    const target = normalizeJid(ctx.mentioned[0] || ctx.quotedSender);
    const days = parseInt(ctx.args.find(a => /^\d+$/.test(a)) || '30', 10);
    if (!target) return ctx.reply('Usage: .rentbot @user <days>');
    const until = Date.now() + days * 86400 * 1000;
    const s = getState();
    s.rents = (s.rents || []).filter(r => r.jid !== target);
    s.rents.push({ jid: target, until });
    setState({ rents: s.rents });
    await ctx.reply(`Rented to ${target.split('@')[0]} for ${days} days.`);
  });

  register('stoprent', { desc: 'Stop rent: .stoprent @user', group: 'rent', owner: true }, async (ctx) => {
    const target = normalizeJid(ctx.mentioned[0] || ctx.quotedSender);
    if (!target) return ctx.reply('Usage: .stoprent @user');
    const s = getState();
    s.rents = (s.rents || []).filter(r => r.jid !== target);
    setState({ rents: s.rents });
    await ctx.reply(`Stopped rent for ${target.split('@')[0]}`);
  });

  register('listrent', { desc: 'List rented users', group: 'rent', owner: true }, async (ctx) => {
    const s = getState();
    if (!s.rents?.length) return ctx.reply('No active rents.');
    const lines = s.rents.map(r => `• ${r.jid.split('@')[0]} — expires ${new Date(r.until).toISOString().slice(0, 10)}`);
    await ctx.reply('*Rents:*\n' + lines.join('\n'));
  });
}
