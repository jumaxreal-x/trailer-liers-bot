import { getState, setState } from '../state.js';

export function registerPlugins(register) {
  register('addplugin', { desc: 'Add JS plugin: .addplugin <name>\\n<code>  (code = body of async (ctx)=>{...})', group: 'plugins', owner: true }, async (ctx) => {
    const text = ctx.argText;
    if (!text) return ctx.reply('Usage: .addplugin <name>\\n<code>');
    const nl = text.indexOf('\n');
    if (nl < 0) return ctx.reply('Provide name on first line, code below.');
    const name = text.slice(0, nl).trim().toLowerCase();
    const code = text.slice(nl + 1);
    const s = getState();
    s.pluginCmds[name] = code;
    setState({ pluginCmds: s.pluginCmds });
    const { loadAllCommands } = await import('./index.js');
    loadAllCommands();
    await ctx.reply(`Plugin .${name} installed.`);
  });

  register('delplugin', { desc: 'Remove plugin', group: 'plugins', owner: true }, async (ctx) => {
    const name = (ctx.args[0] || '').toLowerCase();
    if (!name) return ctx.reply('Usage: .delplugin <name>');
    const s = getState();
    delete s.pluginCmds[name];
    setState({ pluginCmds: s.pluginCmds });
    const { loadAllCommands } = await import('./index.js');
    loadAllCommands();
    await ctx.reply(`Removed plugin .${name}`);
  });

  // dynamically load plugins from state
  const s = getState();
  for (const [name, code] of Object.entries(s.pluginCmds || {})) {
    register(name, { desc: 'user plugin', group: 'plugins', owner: true }, async (ctx) => {
      try {
        const fn = new Function('ctx', `return (async () => { ${code} })();`);
        await fn(ctx);
      } catch (e) {
        await ctx.reply('Plugin error: ' + e.message);
      }
    });
  }
}
