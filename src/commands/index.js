import { registerCore } from './core.js';
import { registerChat } from './chat.js';
import { registerAuto } from './auto.js';
import { registerSecurity } from './security.js';
import { registerReplies } from './replies.js';
import { registerPlugins } from './plugins.js';
import { registerRent } from './rent.js';
import { registerGit } from './git.js';
import { registerSession } from './session_cmds.js';
import { registerBroadcast } from './broadcast.js';

export const commands = new Map(); // name -> {handler, desc, owner, group}

export function register(name, opts, handler) {
  commands.set(name.toLowerCase(), { handler, ...opts });
  if (opts.aliases) for (const a of opts.aliases) commands.set(a.toLowerCase(), { handler, ...opts, _alias: name });
}

export function loadAllCommands() {
  commands.clear();
  registerCore(register);
  registerChat(register);
  registerAuto(register);
  registerSecurity(register);
  registerReplies(register);
  registerPlugins(register);
  registerRent(register);
  registerGit(register);
  registerSession(register);
  registerBroadcast(register);
}

export function listCommands() {
  const seen = new Set();
  const out = [];
  for (const [name, def] of commands.entries()) {
    if (def._alias) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ name, ...def });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
