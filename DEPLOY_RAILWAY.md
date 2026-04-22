# Deploy "Trailer Liers" to Railway

Railway has a free trial ($5 credit) and a low-cost hobby plan ($5/mo) that keeps the bot running 24/7 — independent of your Replit account.

## 1. Push this project to GitHub

In Replit, open the **Git** pane and connect a GitHub repo, then push.

## 2. Create a Railway project

1. Go to <https://railway.app> and sign in with GitHub.
2. Click **New Project → Deploy from GitHub repo** and pick the repo you just pushed.
3. Railway will detect `railway.json` / `nixpacks.toml` and start building automatically.

## 3. Required environment variables

In your Railway service → **Variables** tab, add:

| Variable | Value |
| --- | --- |
| `PORT` | `8080` *(Railway sets this automatically — no need to add)* |
| `NODE_ENV` | `production` |
| `OPENAI_API_KEY` | *your own OpenAI key* — required for `.gpt`, `.dalle`, `.flux`, `.autoreply`. The Replit AI proxy keys do **not** work outside Replit. |

The bot reads `OPENAI_API_KEY` (or the Replit names `AI_INTEGRATIONS_OPENAI_API_KEY` + `AI_INTEGRATIONS_OPENAI_BASE_URL`). On Railway just set `OPENAI_API_KEY`.

## 4. Add a persistent volume (so you don't have to re-pair after every deploy)

WhatsApp session credentials live in `artifacts/api-server/.wa-state/`. Without a volume, Railway wipes them on every redeploy and you'd have to scan the QR / enter a pairing code again.

In your Railway service → **Settings → Volumes**:

- Click **+ Add Volume**
- Mount path: `/app/artifacts/api-server/.wa-state`
- Size: 1 GB is plenty

## 5. First-time pairing

1. Once the deploy is **Active**, open the Railway-generated URL (e.g. `trailer-liers-production.up.railway.app`).
2. Visit `/api/wa` — you'll see the bot card with a fresh pairing code for `+256 752 233886`.
3. On the bot phone: WhatsApp → Linked Devices → Link a device → Link with phone number → enter the code.
4. The bot will DM you `Trailer Liers is online ✅` and start responding to commands.

## 6. Re-deploys

After step 4, the auth files persist in the volume. Future Git pushes trigger automatic rebuilds and the bot reconnects without re-pairing.

## Costs

Railway is not free forever — after the trial credit you'll need the **Hobby plan ($5/month)** to keep the service always-on. The bot is light enough that $5/mo covers full 24/7 operation.

If you'd rather use a truly free option, the same files also work on **Render free tier** and **Fly.io free tier** — the only thing that changes is the dashboard you click through.
