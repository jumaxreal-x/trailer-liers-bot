export function registerBroadcast(register) {
  register('broadcast', { desc: 'Broadcast to all groups', group: 'broadcast', owner: true }, async (ctx) => {
    const text = ctx.argText.trim();
    if (!text) return ctx.reply('Usage: .broadcast <text>');
    const groups = await ctx.sock.groupFetchAllParticipating();
    let n = 0;
    for (const id of Object.keys(groups)) {
      try { await ctx.sock.sendMessage(id, { text: `📢 *Broadcast*\n\n${text}` }); n++; await new Promise(r => setTimeout(r, 800)); } catch {}
    }
    await ctx.reply(`Sent to ${n} groups.`);
  });

  register('broadcastdm', { desc: 'Broadcast to recent DMs', group: 'broadcast', owner: true }, async (ctx) => {
    const text = ctx.argText.trim();
    if (!text) return ctx.reply('Usage: .broadcastdm <text>');
    const { getState } = await import('../state.js');
    const cache = getState().messageCache || {};
    const dms = new Set();
    for (const v of Object.values(cache)) {
      if (v.from && !v.from.endsWith('@g.us') && !v.from.endsWith('@broadcast')) dms.add(v.from);
    }
    let n = 0;
    for (const j of dms) {
      try { await ctx.sock.sendMessage(j, { text: `📢 ${text}` }); n++; await new Promise(r => setTimeout(r, 600)); } catch {}
    }
    await ctx.reply(`Sent to ${n} DMs.`);
  });
}
