import app from "./app";
import { logger } from "./lib/logger";
import { startBot } from "./bot";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  // Only start the WhatsApp bot in deployed environments (Railway/Fly) or when explicitly enabled.
  // This prevents the local dev workspace from racing with the deployed bot for the same number.
  if (process.env.RAILWAY_ENVIRONMENT || process.env.FLY_APP_NAME || process.env.WA_ENABLED === "1") {
    startBot();
  } else {
    logger.warn("WhatsApp bot disabled in this environment. Set WA_ENABLED=1 to force-enable.");
  }
});
