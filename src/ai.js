import { getState, setState } from './state.js';

const HISTORY_LIMIT = 20;

export function pushHistory(jid, role, text) {
  if (!text) return;
  const st = getState();
  const hist = st.aiHistory || {};
  const arr = hist[jid] || [];
  arr.push({ role, text: text.slice(0, 800) });
  while (arr.length > HISTORY_LIMIT) arr.shift();
  hist[jid] = arr;
  setState({ aiHistory: hist });
}

export function getHistory(jid) {
  return (getState().aiHistory || {})[jid] || [];
}

export function clearHistory(jid) {
  const hist = getState().aiHistory || {};
  delete hist[jid];
  setState({ aiHistory: hist });
}

function buildMimicReply(jid, incoming) {
  const hist = getHistory(jid);
  const mine = hist.filter(h => h.role === 'me').map(h => h.text);
  if (mine.length === 0) {
    return "hey 👋 (mimic mode but I have no past replies to learn from yet)";
  }
  const sample = mine[Math.floor(Math.random() * mine.length)];
  const t = (incoming || '').toLowerCase();
  if (/\b(hi|hello|hey|yo|ola)\b/.test(t)) return mine.find(m => /\b(hi|hello|hey|yo)\b/i.test(m)) || sample;
  if (/\?$/.test(incoming || '')) return mine.find(m => m.length < 100) || sample;
  return sample;
}

export async function aiGenerate(jid, incoming) {
  const st = getState();
  const mode = st.aiMode || 'off';
  if (mode === 'off') return null;

  if (mode === 'mimic') {
    return buildMimicReply(jid, incoming);
  }

  // mode === 'on' — use Gemini if key is available
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return "🤖 AI is on, but no GEMINI_API_KEY is set. Get a free key at https://aistudio.google.com/apikey and add it as an env var.";
  }

  const hist = getHistory(jid);
  const contents = hist.map(h => ({
    role: h.role === 'me' ? 'model' : 'user',
    parts: [{ text: h.text }],
  }));
  contents.push({ role: 'user', parts: [{ text: incoming || '' }] });

  const sys = `You are TRAILER LIERS, a helpful WhatsApp assistant for the bot owner. Reply briefly (1-3 sentences), match the user's tone and language. Never mention you are an AI unless asked.`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: sys }] },
        contents,
        generationConfig: { temperature: 0.7, maxOutputTokens: 256 },
      }),
    });
    if (!r.ok) {
      const t = await r.text();
      return `🤖 AI error: ${r.status} ${t.slice(0, 100)}`;
    }
    const j = await r.json();
    const text = j.candidates?.[0]?.content?.parts?.[0]?.text;
    return text || "🤖 (no reply)";
  } catch (e) {
    return `🤖 AI error: ${e.message}`;
  }
}
