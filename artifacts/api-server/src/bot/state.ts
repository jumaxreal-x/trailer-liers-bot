import fs from "node:fs";
import path from "node:path";

const STATE_DIR = path.resolve(process.cwd(), ".wa-state");
const STATE_FILE = path.join(STATE_DIR, "bot-state.json");

export type BotMode = "public" | "private";

export interface BotState {
  mode: BotMode;
  features: {
    autoreply: boolean;
    autoread: boolean;
    autotyping: boolean;
    autostatus: boolean;
    autoreact: boolean;
    antidelete: boolean;
    anticall: boolean;
    pmblocker: boolean;
    stealth: boolean;
    antilink: Record<string, boolean>;
    antibadword: Record<string, boolean>;
    welcome: Record<string, boolean>;
    goodbye: Record<string, boolean>;
  };
  warnings: Record<string, Record<string, number>>;
  messageCache: Record<string, { text: string; sender: string; ts: number }>;
  startedAt: number;
}

const DEFAULT_STATE: BotState = {
  mode: "public",
  features: {
    autoreply: false,
    autoread: false,
    autotyping: false,
    autostatus: false,
    autoreact: false,
    antidelete: false,
    anticall: true,
    pmblocker: false,
    stealth: false,
    antilink: {},
    antibadword: {},
    welcome: {},
    goodbye: {},
  },
  warnings: {},
  messageCache: {},
  startedAt: Date.now(),
};

let state: BotState = { ...DEFAULT_STATE };

export function loadState(): BotState {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, "utf8");
      const parsed = JSON.parse(raw) as Partial<BotState>;
      state = {
        ...DEFAULT_STATE,
        ...parsed,
        features: { ...DEFAULT_STATE.features, ...(parsed.features ?? {}) },
        startedAt: Date.now(),
        messageCache: {},
      };
    }
  } catch {
    state = { ...DEFAULT_STATE };
  }
  return state;
}

export function saveState(): void {
  try {
    if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
    const persistable = { ...state, messageCache: {} };
    fs.writeFileSync(STATE_FILE, JSON.stringify(persistable, null, 2));
  } catch {
    /* ignore */
  }
}

export function getState(): BotState {
  return state;
}

export function rememberMessage(
  id: string,
  data: { text: string; sender: string },
): void {
  state.messageCache[id] = { ...data, ts: Date.now() };
  // simple eviction
  const keys = Object.keys(state.messageCache);
  if (keys.length > 500) {
    const oldest = keys
      .map((k) => ({ k, ts: state.messageCache[k]!.ts }))
      .sort((a, b) => a.ts - b.ts)
      .slice(0, keys.length - 500);
    for (const o of oldest) delete state.messageCache[o.k];
  }
}
