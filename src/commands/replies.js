import { getState, setState } from '../state.js';

export function registerReplies(register) {
  register('addreply', { desc: 'Add auto reply: .addreply <trigger>|<response>', group: 'replies', owner: true }, async (ctx) => {
    const [trigger, response] = ctx.argText.split('|').map(s => s?.trim());
    if (!trigger || !response) return ctx.reply('Usage: .addreply trigger | response');
    const s = getState();
    s.replies.push({ trigger: trigger.toLowerCase(), response });
    setState({ replies: s.replies });
    await ctx.reply(`Added reply for "${trigger}"`);
  });

  register('delreply', { desc: 'Delete auto reply by trigger', group: 'replies', owner: true }, async (ctx) => {
    const t = ctx.argText.trim().toLowerCase();
    if (!t) return ctx.reply('Usage: .delreply <trigger>');
    const s = getState();
    const before = s.replies.length;
    s.replies = s.replies.filter(r => r.trigger !== t);
    setState({ replies: s.replies });
    await ctx.reply(before === s.replies.length ? 'Not found.' : `Removed "${t}"`);
  });

  register('listreplies', { desc: 'List auto replies', group: 'replies' }, async (ctx) => {
    const s = getState();
    if (!s.replies.length) return ctx.reply('No replies set.');
    await ctx.reply('*Auto replies:*\n' + s.replies.map((r, i) => `${i + 1}. ${r.trigger} → ${r.response}`).join('\n'));
  });
}
