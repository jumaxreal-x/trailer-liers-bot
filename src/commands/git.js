import { execSync } from 'child_process';

function sh(cmd) {
  try { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch (e) { return `ERR: ${e.message.split('\n')[0]}`; }
}

export function registerGit(register) {
  register('gitinfo', { desc: 'Show git status', group: 'git' }, async (ctx) => {
    const branch = sh('git rev-parse --abbrev-ref HEAD');
    const commit = sh('git log -1 --pretty=format:"%h %s (%an, %ar)"');
    const remote = sh('git remote get-url origin');
    await ctx.reply(`*Git*\nBranch: ${branch}\nCommit: ${commit}\nRemote: ${remote}`);
  });

  register('gitpull', { desc: 'git pull', group: 'git', owner: true }, async (ctx) => {
    const out = sh('git pull --ff-only');
    await ctx.reply('```' + out.slice(0, 1500) + '```');
  });
}
