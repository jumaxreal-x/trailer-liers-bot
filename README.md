# Trailer Liers Bot

WhatsApp bot for Railway with web pairing page, AI auto-reply, edit/delete detection, group tools, stickers and more.

## Deploy on Railway

1. Push this folder to a GitHub repo.
2. On Railway → New Project → Deploy from GitHub → pick the repo.
3. Add a **Volume** mounted at `/data` (so the session survives restarts).
4. Set environment variables:

| Var | Required | Example |
|---|---|---|
| `GEMINI_API_KEY` | yes (for AI) | `AIza...` |
| `OWNER_NAME` | optional | `Your Name` |
| `OWNER_NUMBER` | optional | `256752233886` |
| `BOT_NAME` | optional | `My Bot` |
| `PREFIX` | optional | `.` |
| `SESSION_DIR` | recommended | `/data/session` |
| `PORT` | auto | (Railway sets it) |

5. Open the deploy URL → enter your WhatsApp number → get the pairing code → enter it in WhatsApp → Settings → Linked Devices → Link with phone number.

## Commands

Send `.menu` to yourself on WhatsApp to see the full list.

### Working out of the box
- **Core:** `.alive .ping .menu .owner .restart .update .mode public/private`
- **Auto:** `.autoreply .autoread .autoreact .autotyping .autostatus .antidelete .anticall .pmblocker`
- **AI:** `.gemini <prompt>` `.gpt <prompt>` (uses Gemini)
- **Group admin:** `.kick .add .promote .demote .tagall .hidetag .mute .unmute .antilink .antibadword .welcome .goodbye`
- **Stickers:** `.sticker .take .attp .emojimix`
- **Tools:** `.qrcode .translate .tts .tourl`

### Need extra setup / paid API
- `.llama .mistral .dalle .flux` — need OpenRouter / OpenAI / Replicate keys
- `.play .song .video .tiktok .instagram .facebook .spotify` — need a paid scraper API
- `.removebg` — needs remove.bg key
- `.readqr .screenshot` — need heavy native libs

## Modes
- **private** (default): only you (the linked number) and the configured `OWNER_NUMBER` can run commands.
- **public**: anyone in any chat can run them.
