import { config as loadDotEnv } from "dotenv";
import Fastify from "fastify";
import { loadConfig, requiredEnv } from "./config/load.js";
import { openDb } from "./db/connection.js";
import { migrate } from "./db/migrations.js";
import { createLogger, loggerOptions } from "./logger.js";
import { createLlmAdapter } from "./llm/index.js";
import { registerHealth } from "./server/health.js";
import { registerWebhook } from "./server/webhook.js";
import { startWorker } from "./worker/runner.js";

loadDotEnv({ override: true });
const log = createLogger("ai-review-bot");

async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDb();
  migrate(db);

  const app = Fastify({ logger: loggerOptions("http"), disableRequestLogging: true });
  await registerHealth(app);
  await registerWebhook(app, db, requiredEnv("GITHUB_WEBHOOK_SECRET"));

  const llm = createLlmAdapter(config);
  startWorker({ db, config, llm });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: "0.0.0.0" });
  log.info({ port }, "ai-review-bot started");
}

main().catch((error) => {
  log.error({ err: error }, "fatal startup error");
  process.exitCode = 1;
});
