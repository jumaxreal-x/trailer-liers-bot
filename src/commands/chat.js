export function registerChat(register) {
  register('clear', { desc: 'Clear chat (delete-for-me)', group: 'chat' }, async (ctx) => {
    await ctx.sock.chatModify({ delete: true, lastMessages: [{ key: ctx.msg.key, messageTimestamp: ctx.msg.messageTimestamp }] }, ctx.from).catch(() => {});
    await ctx.reply('Chat cleared.');
  });

  register('clearchat', { desc: 'Clear current chat', group: 'chat' }, async (ctx) => {
    await ctx.sock.chatModify({ clear: true }, ctx.from).catch(() => {});
    await ctx.reply('Chat cleared.');
  });

  register('archivechat', { desc: 'Archive current chat', group: 'chat' }, async (ctx) => {
    await ctx.sock.chatModify({ archive: true, lastMessages: [{ key: ctx.msg.key, messageTimestamp: ctx.msg.messageTimestamp }] }, ctx.from).catch(() => {});
    await ctx.reply('Archived.');
  });

  register('pinchat', { desc: 'Pin current chat', group: 'chat' }, async (ctx) => {
    await ctx.sock.chatModify({ pin: true }, ctx.from).catch(() => {});
    await ctx.reply('Pinned.');
  });

  register('star', { desc: 'Star quoted message', group: 'chat' }, async (ctx) => {
    if (!ctx.quoted) return ctx.reply('Reply to a message.');
    const key = ctx.msg.message.extendedTextMessage?.contextInfo;
    await ctx.sock.chatModify({ star: { messages: [{ id: key.stanzaId, fromMe: false }], star: true } }, ctx.from).catch(() => {});
    await ctx.reply('Starred.');
  });

  register('gcleave', { desc: 'Leave current group', group: 'chat', owner: true }, async (ctx) => {
    if (!ctx.isGroup) return ctx.reply('Group only.');
    await ctx.reply('Bye.');
    await ctx.sock.groupLeave(ctx.from);
  });

  register('joingroup', { desc: 'Join group via invite link/code', group: 'chat', owner: true }, async (ctx) => {
    const arg = ctx.args[0] || '';
    const m = arg.match(/chat\.whatsapp\.com\/([\w-]+)/) || [null, arg];
    const code = m[1];
    if (!code) return ctx.reply('Usage: .joingroup <invite link or code>');
    try {
      const res = await ctx.sock.groupAcceptInvite(code);
      await ctx.reply(`Joined: ${res}`);
    } catch (e) {
      await ctx.reply('Failed: ' + e.message);
    }
  });
}
