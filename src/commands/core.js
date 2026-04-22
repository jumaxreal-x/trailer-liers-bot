import os from 'os';
import { config, nowInZone } from '../config.js';
import { getState, setState } from '../state.js';
import { isOwner, isSudo, normalizeJid } from '../utils.js';

export function registerCore(register) {
  register('help', { desc: 'Show all commands', group: 'core', aliases: ['menu'] }, async (ctx) => {
    const { listCommands } = await import('./index.js');
    const cmds = listCommands();
    const groups = {};
    for (const c of cmds) (groups[(c.group || 'misc').toLowerCase()] ||= []).push(c.name);

    const order = [
      'core', 'ai', 'auto', 'security', 'replies', 'plugins',
      'rent', 'broadcast', 'chat', 'session', 'git', 'misc',
    ];
    const ordered = [
      ...order.filter(g => groups[g]),
      ...Object.keys(groups).filter(g => !order.includes(g)),
    ];

    const time = new Date().toLocaleTimeString('en-GB', {
      timeZone: config.TIME_ZONE, hour: '2-digit', minute: '2-digit',
    });

    let txt = '';
    txt += `╭───⬣ *${config.BOT_NAME} MENU* ──⬣\n`;
    txt += ` | ● *Bot:* ${config.BOT_NAME}\n`;
    txt += ` | ● *Owner:* wa.me/${config.OWNER_NUMBER}\n`;
    txt += ` | ● *Prefixes:* ${config.PREFIXES.join(' ')}\n`;
    txt += ` | ● *Mode:* ${getState().mode}\n`;
    txt += ` | ● *Plugins:* ${cmds.length}\n`;
    txt += ` | ● *Time:* ${time}\n`;

    for (const g of ordered) {
      const list = groups[g];
      if (!list?.length) continue;
      txt += ` |───⬣ *${g.toUpperCase()}* ──⬣\n`;
      for (const name of list) txt += ` | ● .${name}\n`;
    }

    txt += '╰──────────⬣';
    await ctx.reply(txt);
  });

  register('listcmd', { desc: 'List commands', group: 'core' }, async (ctx) => {
    const { listCommands } = await import('./index.js');
    const cmds = listCommands();
    await ctx.reply(`*Commands (${cmds.length}):*\n` + cmds.map(c => `.${c.name} — ${c.desc || ''}`).join('\n'));
  });

  register('sys', { desc: 'System info', group: 'core', aliases: ['ping', 'status'] }, async (ctx) => {
    const mem = process.memoryUsage();
    const up = process.uptime();
    const txt = `*${config.BOT_NAME} — System*\n` +
      `Time: ${nowInZone()}\n` +
      `Uptime: ${Math.floor(up / 3600)}h ${Math.floor((up % 3600) / 60)}m ${Math.floor(up % 60)}s\n` +
      `Node: ${process.version}\n` +
      `Platform: ${os.platform()} ${os.arch()}\n` +
      `RAM: ${(mem.rss / 1024 / 1024).toFixed(1)} MB\n` +
      `CPU: ${os.cpus()[0]?.model || 'n/a'}\n` +
      `Load: ${os.loadavg().map(n => n.toFixed(2)).join(', ')}`;
    await ctx.reply(txt);
  });

  register('mode', { desc: 'Switch public/private', group: 'core', owner: true }, async (ctx) => {
    const v = (ctx.args[0] || '').toLowerCase();
    if (!['public', 'private'].includes(v)) return ctx.reply('Usage: .mode public|private');
    setState({ mode: v });
    await ctx.reply(`Mode set to *${v}*.`);
  });

  register('maintenance', { desc: 'Toggle maintenance mode', group: 'core', owner: true }, async (ctx) => {
    const cur = getState().maintenance;
    setState({ maintenance: !cur });
    await ctx.reply(`Maintenance: *${!cur ? 'ON' : 'OFF'}*`);
  });

  register('settings', { desc: 'Show all toggle states', group: 'core' }, async (ctx) => {
    const s = getState();
    const t = (k) => s[k] ? 'ON' : 'OFF';
    await ctx.reply(
      `*Settings*\n` +
      `mode: ${s.mode}\n` +
      `maintenance: ${t('maintenance')}\n` +
      `stealth: ${t('stealth')}\n` +
      `autoread: ${t('autoread')}\n` +
      `autotyping: ${t('autotyping')}\n` +
      `autoreact: ${t('autoreact')}\n` +
      `autostatus: ${t('autostatus')}\n` +
      `auto ai reply: ${t('autoAiReply')}\n` +
      `anticall: ${t('anticall')}\n` +
      `antidelete: ${t('antidelete')}\n` +
      `pmblocker: ${t('pmblocker')}\n` +
      `cmdreact: ${t('cmdreact')}\n` +
      `sudos: ${(s.sudos || []).length}\n` +
      `replies: ${(s.replies || []).length}\n` +
      `plugins: ${Object.keys(s.pluginCmds || {}).length}`
    );
  });

  register('mention', { desc: 'Mention everyone in group', group: 'core' }, async (ctx) => {
    if (!ctx.isGroup) return ctx.reply('Group only.');
    const meta = await ctx.sock.groupMetadata(ctx.from);
    const mentions = meta.participants.map(p => p.id);
    const text = ctx.argText || `📢 Attention from ${config.BOT_NAME}`;
    let body = text + '\n\n';
    for (const j of mentions) body += `@${j.split('@')[0]} `;
    await ctx.sock.sendMessage(ctx.from, { text: body, mentions });
  });

  register('manage', { desc: 'Group manage: promote/demote/kick @user', group: 'core' }, async (ctx) => {
    if (!ctx.isGroup) return ctx.reply('Group only.');
    const action = (ctx.args[0] || '').toLowerCase();
    const target = ctx.mentioned[0] || ctx.quotedSender;
    if (!target || !['promote', 'demote', 'kick', 'add'].includes(action))
      return ctx.reply('Usage: .manage promote|demote|kick|add @user');
    await ctx.sock.groupParticipantsUpdate(ctx.from, [target], action);
    await ctx.reply(`Done: ${action} ${target.split('@')[0]}`);
  });

  register('sudo', { desc: 'Add/remove sudo @user', group: 'core', owner: true }, async (ctx) => {
    const sub = (ctx.args[0] || '').toLowerCase();
    const target = normalizeJid(ctx.mentioned[0] || ctx.quotedSender);
    if (!target || !['add', 'del', 'list'].includes(sub))
      return ctx.reply('Usage: .sudo add|del @user  |  .sudo list');
    const s = getState();
    if (sub === 'list') return ctx.reply('*Sudos:*\n' + (s.sudos.length ? s.sudos.map(j => '• ' + j.split('@')[0]).join('\n') : '(none)'));
    let sudos = s.sudos || [];
    if (sub === 'add') sudos = Array.from(new Set([...sudos, target]));
    else sudos = sudos.filter(j => j !== target);
    setState({ sudos });
    await ctx.reply(`Sudo ${sub}: ${target.split('@')[0]}`);
  });

  register('inspect', { desc: 'Inspect chat / quoted msg', group: 'core' }, async (ctx) => {
    const info = {
      from: ctx.from,
      sender: ctx.sender,
      isGroup: ctx.isGroup,
      isOwner: isOwner(ctx.sender),
      isSudo: isSudo(ctx.sender, getState()),
      messageType: Object.keys(ctx.msg.message || {})[0],
      quoted: !!ctx.quoted,
      quotedSender: ctx.quotedSender,
      mentioned: ctx.mentioned,
    };
    await ctx.reply('```' + JSON.stringify(info, null, 2) + '```');
  });

  register('getfile', { desc: 'Get file count / disk usage', group: 'core' }, async (ctx) => {
    const fs = await import('fs');
    const path = await import('path');
    const root = path.resolve('.');
    let count = 0, size = 0;
    const walk = (d) => {
      try {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          if (e.name === 'node_modules' || e.name === '.git') continue;
          const p = path.join(d, e.name);
          if (e.isDirectory()) walk(p);
          else { count++; try { size += fs.statSync(p).size; } catch {} }
        }
      } catch {}
    };
    walk(root);
    await ctx.reply(`Files: ${count}\nTotal size: ${(size / 1024 / 1024).toFixed(2)} MB`);
  });

  register('reload', { desc: 'Reload commands', group: 'core', owner: true }, async (ctx) => {
    const { loadAllCommands, listCommands } = await import('./index.js');
    loadAllCommands();
    await ctx.reply(`Reloaded. ${listCommands().length} commands active.`);
  });

  register('setcmd', { desc: 'Alias a command: .setcmd <alias> <real>', group: 'core', owner: true }, async (ctx) => {
    const [alias, real] = ctx.args;
    if (!alias || !real) return ctx.reply('Usage: .setcmd <alias> <real>');
    const s = getState();
    s.cmdAliases[alias.toLowerCase()] = real.toLowerCase();
    setState({ cmdAliases: s.cmdAliases });
    await ctx.reply(`Alias .${alias} → .${real}`);
  });

  register('delcmd', { desc: 'Remove alias', group: 'core', owner: true }, async (ctx) => {
    const [alias] = ctx.args;
    if (!alias) return ctx.reply('Usage: .delcmd <alias>');
    const s = getState();
    delete s.cmdAliases[alias.toLowerCase()];
    setState({ cmdAliases: s.cmdAliases });
    await ctx.reply(`Removed alias .${alias}`);
  });

  register('cmdreact', { desc: 'Toggle emoji reaction on commands', group: 'core', owner: true }, async (ctx) => {
    const cur = getState().cmdreact;
    setState({ cmdreact: !cur });
    await ctx.reply(`cmdreact: *${!cur ? 'ON' : 'OFF'}*`);
  });
}
