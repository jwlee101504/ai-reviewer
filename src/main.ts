import { config as loadDotEnv } from "dotenv";
import Fastify from "fastify";
import { loadConfig, requiredEnv } from "./config/load.js";
import { evictStaleRepoCaches } from "./db/cache-gc.js";
import { openDb } from "./db/connection.js";
import { migrate } from "./db/migrations.js";
import { createLogger, loggerOptions } from "./logger.js";
import { createLlmAdapter } from "./llm/index.js";
import { registerHealth } from "./server/health.js";
import { registerWebhook } from "./server/webhook.js";
import { startWorker } from "./worker/runner.js";
import type { Db } from "./db/connection.js";
import type { AppConfig } from "./config/schema.js";

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
  startCacheGc({ db, config });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: "0.0.0.0" });
  log.info({ port }, "ai-review-bot started");
}

function startCacheGc(args: { db: Db; config: AppConfig }): NodeJS.Timeout {
  const tick = async () => {
    try {
      const { evicted } = await evictStaleRepoCaches({
        db: args.db,
        maxAgeDays: args.config.cache.repo_max_age_days
      });
      if (evicted.length > 0) {
        log.info({
          stage: "cache.gc.evicted",
          count: evicted.length,
          repositories: evicted.map((repo) => `${repo.owner}/${repo.name}`)
        }, `evicted ${evicted.length} stale repo cache(s)`);
      }
    } catch (error) {
      log.error({ stage: "cache.gc.failed", err: error }, "repo cache gc failed");
    }
  };
  void tick();
  return setInterval(() => {
    void tick();
  }, args.config.cache.gc_interval_hours * 60 * 60 * 1000);
}

main().catch((error) => {
  log.error({ err: error }, "fatal startup error");
  process.exitCode = 1;
});
