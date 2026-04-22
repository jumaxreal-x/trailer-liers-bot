# Trailer Bot — One-Click WhatsApp Bot

A self-contained WhatsApp bot you can deploy on Railway in one click. After deploying, open the public URL → paste your number → get a pairing code → done.

## Features

- **Web pairing page** — open the Railway URL, paste your number, get the code, link it in WhatsApp.
- **Edit detection** — when anyone edits a message, the bot reposts the new text with an "✏️ Edited message detected" label.
- **`.aion`** — turn AI auto-reply ON. Incoming DMs are answered by Gemini, using past chat history to match your tone.
- **`.aioff`** — turn AI auto-reply OFF. The bot then suggests from your real past replies.
- **`.aistatus`** — shows whether AI is on or off.

`.aion`, `.aioff`, and `.aistatus` only work when sent from your own number.

## Deploy on Railway (one-click)

1. Push this folder to a GitHub repo.
2. https://railway.app → **New Project → Deploy from GitHub repo** → pick the repo.
3. Wait for the deploy. Open **Settings → Networking → Generate Domain**.
4. Open the URL. Paste your WhatsApp number (digits only with country code). Press the button.
5. In WhatsApp: **Settings → Linked Devices → Link a device → Link with phone number** → enter the 8-character code shown on the page.
6. The page flips to "online". You're done.

That's it — no environment variables required.

### Optional environment variables

| Var | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | Override the default key (recommended — set your own) |
| `PREFIX` | Command prefix. Default `.` |
| `SESSION_DIR` | Where to store the session. Set to a Railway volume path (e.g. `/data/session`) for persistence across restarts. |

## Persistence note

Railway's filesystem resets on redeploys. To keep the session between restarts, attach a Railway **Volume** mounted at `/data` and set `SESSION_DIR=/data/session` in Variables. Otherwise you'll need to re-pair after every redeploy.

## Local run

```bash
npm install
npm start
```

Open http://localhost:3000.
