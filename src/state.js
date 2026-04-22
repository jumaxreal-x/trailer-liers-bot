import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

const defaults = {
  mode: 'public',            // public | private
  maintenance: false,
  stealth: false,
  autoread: false,
  autotyping: false,
  autoreact: false,
  autostatus: false,
  autoAiReply: false,
  aiMode: 'off',             // off | on (gemini) | mimic (replays your past style)
  aiHistory: {},             // jid -> [{role, text}]
  antiedit: false,           // notify owner when someone edits a message
  anticall: false,
  antidelete: false,
  pmblocker: false,
  cmdreact: true,
  bio: '',
  sudos: [],                 // jids
  rents: [],                 // [{jid, until}]
  replies: [],               // [{trigger, response}]
  cmdAliases: {},            // {alias: realCmd}
  pluginCmds: {},            // {name: code}
  messageCache: {},          // id -> {from, text, sender}
};

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STATE_FILE)) fs.writeFileSync(STATE_FILE, JSON.stringify(defaults, null, 2));
}

export function loadState() {
  ensure();
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return { ...defaults, ...raw };
  } catch {
    return { ...defaults };
  }
}

let state = loadState();

export function getState() { return state; }

export function saveState() {
  ensure();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export function setState(patch) {
  state = { ...state, ...patch };
  saveState();
  return state;
}
