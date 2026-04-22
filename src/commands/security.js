import { getState, setState } from '../state.js';

export function registerSecurity(register) {
  register('anticall', { desc: 'Reject incoming calls', group: 'security', owner: true }, async (ctx) => {
    const cur = !!getState().anticall;
    setState({ anticall: !cur });
    await ctx.reply(`anticall: *${!cur ? 'ON' : 'OFF'}*`);
  });

  register('antidelete', { desc: 'Recover deleted messages', group: 'security', owner: true }, async (ctx) => {
    const cur = !!getState().antidelete;
    setState({ antidelete: !cur });
    await ctx.reply(`antidelete: *${!cur ? 'ON' : 'OFF'}*`);
  });

  register('pmblocker', { desc: 'Block non-contacts in DM', group: 'security', owner: true }, async (ctx) => {
    const cur = !!getState().pmblocker;
    setState({ pmblocker: !cur });
    await ctx.reply(`pmblocker: *${!cur ? 'ON' : 'OFF'}*`);
  });

  register('stealth', { desc: 'Hide bot replies (delete after sending)', group: 'security', owner: true }, async (ctx) => {
    const cur = !!getState().stealth;
    setState({ stealth: !cur });
    await ctx.reply(`stealth: *${!cur ? 'ON' : 'OFF'}*`);
  });
}
