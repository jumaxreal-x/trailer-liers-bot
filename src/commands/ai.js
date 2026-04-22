import { getState, setState } from '../state.js';
import { aiGenerate, clearHistory, getHistory } from '../ai.js';

export function registerAi(register) {
  register('aion', { desc: 'Turn AI auto-replies ON (Gemini)', group: 'ai', owner: true }, async (ctx) => {
    setState({ aiMode: 'on' });
    const hasKey = !!process.env.GEMINI_API_KEY;
    await ctx.reply(
      `🤖 *AI mode: ON*\n\n` +
      (hasKey
        ? `I'll auto-reply to DMs using Gemini.`
        : `⚠️ No GEMINI_API_KEY set. Get a free one at https://aistudio.google.com/apikey and add it as an env var on your host (Koyeb/Railway). Until then I'll send a placeholder.`)
    );
  });

  register('aioff', { desc: 'Switch AI to mimic mode (uses past convos)', group: 'ai', owner: true }, async (ctx) => {
    setState({ aiMode: 'mimic' });
    await ctx.reply(
      `🧠 *AI mode: MIMIC*\n\nI'll auto-reply to DMs using your previous conversation style — no API key needed. Use *.aistop* to disable auto-replies entirely.`
    );
  });

  register('aistop', { desc: 'Disable all AI auto-replies', group: 'ai', owner: true }, async (ctx) => {
    setState({ aiMode: 'off' });
    await ctx.reply(`🤖 AI auto-replies: *OFF*`);
  });

  register('aistatus', { desc: 'Show current AI mode', group: 'ai', owner: true }, async (ctx) => {
    const m = getState().aiMode || 'off';
    const k = process.env.GEMINI_API_KEY ? '✅ key set' : '⚠️ no key';
    const histCount = Object.keys(getState().aiHistory || {}).length;
    await ctx.reply(`🤖 *AI status*\nMode: *${m}*\nGemini key: ${k}\nTracked chats: ${histCount}`);
  });

  register('ai', { desc: 'Ask the AI directly: .ai <question>', group: 'ai', owner: true }, async (ctx) => {
    const q = ctx.argText?.trim();
    if (!q) return ctx.reply('Usage: .ai <your question>');
    const prevMode = getState().aiMode;
    setState({ aiMode: 'on' });
    const reply = await aiGenerate(ctx.from, q);
    setState({ aiMode: prevMode });
    await ctx.reply(reply || '(no reply)');
  });

  register('aiclear', { desc: 'Clear AI memory for this chat', group: 'ai', owner: true }, async (ctx) => {
    clearHistory(ctx.from);
    await ctx.reply('🧠 AI memory cleared for this chat.');
  });
}
