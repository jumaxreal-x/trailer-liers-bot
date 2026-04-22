# Deploy TRAILER LIERS bot to a free 24/7 host

You only need to do this **once**. The bot will then stay online forever, even when your Replit account is at $0.

## Recommended: Koyeb (free, no sleep, no credit card)

1. Push this `bot/` folder to a **GitHub** repo (you can copy just the `bot/` folder — it's self-contained).
2. Go to https://app.koyeb.com → **Create app** → choose **GitHub** → pick the repo.
3. Builder: **Dockerfile**. Port: **8080**. Region: any.
4. Don't add `SESSION_ID` yet. Click **Deploy**.
5. Open the assigned `https://<your-app>.koyeb.app` URL → enter your phone number → enter the pair code on WhatsApp.
6. Copy the `SESSION_ID` shown on the page.
7. In Koyeb → **Settings → Environment variables** → add `SESSION_ID` with the value you copied → **Redeploy**.

The bot is now online 24/7. The pair page stays available at the same URL if you ever need to re-pair.

## Alternative free hosts

- **Render.com** — Web Service, Docker, free tier (sleeps after 15 min idle; use https://uptimerobot.com to ping `/healthz` every 5 min to keep awake).
- **Fly.io** — `fly launch` from this folder, free shared-cpu-1x VM.
- **Railway** — free $5 credit/month covers this easily.

All of them use the included `Dockerfile`. The flow is the same: deploy → visit the URL → pair → save `SESSION_ID` env var → redeploy.

## Local / Replit usage

- `pnpm --filter @workspace/bot run dev` — starts the pair web UI on `$PORT` and (if `SESSION_ID` is set) the bot.
- `pnpm --filter @workspace/bot run bot` — runs only the bot (no web UI).
