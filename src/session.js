import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const AUTH_DIR = path.join(__dirname, '..', 'auth');

export function ensureAuthDir() {
  if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });
}

export function clearAuth() {
  if (fs.existsSync(AUTH_DIR)) {
    for (const f of fs.readdirSync(AUTH_DIR)) {
      fs.rmSync(path.join(AUTH_DIR, f), { recursive: true, force: true });
    }
  }
}

// Decode SESSION_ID into auth/creds.json. Supports plain base64 or "TRAILER~<base64>"
export function hydrateFromSessionId(sessionId) {
  if (!sessionId) return false;
  ensureAuthDir();
  let raw = sessionId.trim();
  // strip common prefixes
  raw = raw.replace(/^TRAILER[-_~:=]/i, '').replace(/^LIERS[-_~:=]/i, '');
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    JSON.parse(decoded); // validate
    fs.writeFileSync(path.join(AUTH_DIR, 'creds.json'), decoded);
    return true;
  } catch {
    return false;
  }
}

export function exportSessionId() {
  const credsPath = path.join(AUTH_DIR, 'creds.json');
  if (!fs.existsSync(credsPath)) return null;
  const buf = fs.readFileSync(credsPath);
  return 'TRAILER~' + Buffer.from(buf).toString('base64');
}
