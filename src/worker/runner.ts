import pino from "pino";
import type { AppConfig } from "../config/schema.js";
import type { Db } from "../db/connection.js";
import { claimNextJob, completeJob, failJob, recoverStaleJobs } from "../db/jobs.js";
import type { LlmAdapter } from "../llm/adapter.js";
import { handleIssueCommentJob } from "./handlers/issue-comment.js";
import { handlePullRequestJob } from "./handlers/pull-request.js";

const log = pino({ name: "worker" });

export const WORKER_TICK_INTERVAL_MS = 2_000;

type WorkerDeps = {
  db: Db;
  config: AppConfig;
  llm: LlmAdapter;
};

type JobHandler = (deps: WorkerDeps, payload: unknown) => Promise<void>;

const handlers: Record<string, JobHandler> = {
  pull_request: (deps, payload) => handlePullRequestJob({ ...deps, payload }),
  issue_comment: (deps, payload) => handleIssueCommentJob({ db: deps.db, config: deps.config, payload })
};

export function startWorker(args: WorkerDeps & { intervalMs?: number }): NodeJS.Timeout {
  const recovered = recoverStaleJobs(args.db);
  if (recovered > 0) log.warn({ recovered }, "recovered stale running jobs on startup");

  const tick = async () => {
    const job = claimNextJob(args.db);
    if (!job) return;

    try {
      const handler = handlers[job.event_type];
      if (!handler) {
        log.warn({ jobId: job.id, eventType: job.event_type }, "no handler for event type, skipping");
      } else {
        await handler(args, JSON.parse(job.payload_json));
      }
      completeJob(args.db, job.id);
    } catch (error) {
      log.error({ err: error, jobId: job.id }, "job failed");
      failJob(args.db, job.id, job.attempts, error);
    }
  };

  const timer = setInterval(() => {
    tick().catch((error) => log.error({ err: error }, "worker tick failed"));
  }, args.intervalMs ?? WORKER_TICK_INTERVAL_MS);
  void tick();
  return timer;
}