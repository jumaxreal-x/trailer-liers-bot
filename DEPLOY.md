# Deploy TRAILER LIERS bot to a free 24/7 host

You only need to do this **once**. The bot will then stay online forever, even when your Replit account is at $0.

---

## Option A — Railway.app (recommended, fast, $5 free credit/month)

1. Push this `bot/` folder to a **GitHub** repo.
2. Go to https://railway.app → **Login with GitHub** → **New Project** → **Deploy from GitHub repo** → pick the repo.
3. Railway auto-detects the `Dockerfile` and `railway.json`. Click **Deploy**.
4. Open **Settings → Networking → Generate Domain** to get a public URL like `https://trailer-liers.up.railway.app`.
5. Open that URL → enter your phone number → enter the pair code on WhatsApp.
6. Copy the `SESSION_ID` shown on the page.
7. **Variables** tab → add:
   - `SESSION_ID` = (paste it)
   - `OWNER_NUMBER` = `256706106326`
   - `PREFIX` = `😀 . !`
   - `TIME_ZONE` = `Africa/Kampala`
   - `GEMINI_API_KEY` = (optional, for `.aion` AI replies — get a free key at https://aistudio.google.com/apikey)
8. Railway redeploys automatically. Bot is online 24/7.

## Option B — Koyeb.com (free, no credit card, no sleep)

1. Push this `bot/` folder to GitHub.
2. https://app.koyeb.com → **Create app** → **GitHub** → pick the repo.
3. Builder: **Dockerfile**. Port: **8080**. Region: any. Instance: **Free**.
4. Deploy → open the assigned `https://<name>.koyeb.app` URL → pair → copy `SESSION_ID`.
5. **Settings → Environment variables** → add the same vars as Option A → **Redeploy**.

## Option C — Other hosts

- **Render.com** — Web Service, Docker, free (sleeps after 15 min idle; use https://uptimerobot.com to ping `/healthz` every 5 min).
- **Fly.io** — `fly launch` from this folder.

All hosts use the included `Dockerfile`. Same flow: deploy → visit URL → pair → save `SESSION_ID` → redeploy.

---

## Environment variables

| Name | Required | Purpose |
|---|---|---|
| `SESSION_ID` | After first pair | Auto-login without re-pairing |
| `OWNER_NUMBER` | Yes | Your WhatsApp number (no `+`) |
| `PREFIX` | No (default `😀 . !`) | Command prefixes |
| `TIME_ZONE` | No | e.g. `Africa/Kampala` |
| `GEMINI_API_KEY` | Only for `.aion` | Free key from https://aistudio.google.com/apikey |
| `PORT` | Auto-set | Web pair UI port |

## AI commands

- `.aion` — turn on AI replies (uses Gemini, needs `GEMINI_API_KEY`).
- `.aioff` — switch to **mimic mode**: replies based on your previous conversations, no API key needed.
- `.aistop` — disable all auto-replies.
- `.ai <question>` — ask the AI directly (one-shot).
- `.aistatus` — show current AI mode.
- `.aiclear` — wipe AI memory for the current chat.

## Local / Replit usage

- `pnpm --filter @workspace/bot run start` — starts the pair web UI on `$PORT` and (if `SESSION_ID` is set) the bot.
- `pnpm --filter @workspace/bot run bot` — runs only the bot (no web UI).
