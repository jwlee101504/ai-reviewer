import pino from "pino";
import type { AppConfig } from "../config/schema.js";
import type { Db } from "../db/connection.js";
import { claimNextJob, completeJob, failJob, recoverStaleJobs } from "../db/jobs.js";
import type { LlmAdapter } from "../llm/adapter.js";
import { handleIssueCommentJob } from "./handlers/issue-comment.js";
import { handlePullRequestJob } from "./handlers/pull-request.js";

const log = pino({ name: "worker" });

export function startWorker(args: {
  db: Db;
  config: AppConfig;
  llm: LlmAdapter;
  intervalMs?: number;
}): NodeJS.Timeout {
  const recovered = recoverStaleJobs(args.db);
  if (recovered > 0) log.warn({ recovered }, "recovered stale running jobs on startup");

  const tick = async () => {
    const job = claimNextJob(args.db);
    if (!job) return;

    try {
      const payload = JSON.parse(job.payload_json) as unknown;
      if (job.event_type === "pull_request") {
        await handlePullRequestJob({ db: args.db, config: args.config, llm: args.llm, payload: payload as never });
      } else if (job.event_type === "issue_comment") {
        await handleIssueCommentJob(args.db, payload as never, args.config.bot.name);
      }
      completeJob(args.db, job.id);
    } catch (error) {
      log.error({ err: error, jobId: job.id }, "job failed");
      failJob(args.db, job.id, job.attempts, error);
    }
  };

  const timer = setInterval(() => {
    tick().catch((error) => log.error({ err: error }, "worker tick failed"));
  }, args.intervalMs ?? 2_000);
  void tick();
  return timer;
}
