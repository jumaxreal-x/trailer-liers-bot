import { getState, setState } from '../state.js';

function toggle(key, label) {
  return async (ctx) => {
    const cur = !!getState()[key];
    setState({ [key]: !cur });
    await ctx.reply(`${label}: *${!cur ? 'ON' : 'OFF'}*`);
  };
}

export function registerAuto(register) {
  register('autoreact', { desc: 'Auto-react to messages', group: 'auto', owner: true }, toggle('autoreact', 'autoreact'));
  register('autoread', { desc: 'Auto-read messages', group: 'auto', owner: true }, toggle('autoread', 'autoread'));
  register('autotyping', { desc: 'Show typing on every chat', group: 'auto', owner: true }, toggle('autotyping', 'autotyping'));
  register('autostatus', { desc: 'Auto-view statuses', group: 'auto', owner: true }, toggle('autostatus', 'autostatus'));
  register('auto', {
    desc: 'auto ai reply: toggle AI auto-reply',
    group: 'auto',
    owner: true,
  }, async (ctx) => {
    const sub = (ctx.args[0] || '').toLowerCase();
    if (sub === 'ai' && (ctx.args[1] || '').toLowerCase() === 'reply') {
      const cur = !!getState().autoAiReply;
      setState({ autoAiReply: !cur });
      return ctx.reply(`auto ai reply: *${!cur ? 'ON' : 'OFF'}*`);
    }
    await ctx.reply('Usage: .auto ai reply');
  });
}
