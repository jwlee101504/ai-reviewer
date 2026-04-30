import type { AppConfig } from "../config/schema.js";
import type { Db } from "../db/connection.js";
import { claimNextJob, completeJob, failJob, recoverStaleJobs } from "../db/jobs.js";
import { createLogger } from "../logger.js";
import type { LlmAdapter } from "../llm/adapter.js";
import { handleIssueCommentJob } from "./handlers/issue-comment.js";
import { handlePullRequestJob } from "./handlers/pull-request.js";

const log = createLogger("worker");

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

    const startedAt = Date.now();
    const summary = summarizeJobPayload(job.payload_json);
    try {
      log.info({
        stage: "job.started",
        jobId: job.id,
        eventType: job.event_type,
        attempts: job.attempts,
        ...summary
      }, formatJobMessage("started", job.event_type, summary));
      const handler = handlers[job.event_type];
      if (!handler) {
        log.warn({
          stage: "job.skipped",
          jobId: job.id,
          eventType: job.event_type,
          ...summary
        }, formatJobMessage("skipped: no handler", job.event_type, summary));
      } else {
        await handler(args, JSON.parse(job.payload_json));
      }
      completeJob(args.db, job.id);
      log.info({
        stage: "job.completed",
        jobId: job.id,
        eventType: job.event_type,
        attempts: job.attempts,
        durationMs: Date.now() - startedAt,
        ...summary
      }, formatJobMessage("completed", job.event_type, summary));
    } catch (error) {
      log.error({
        stage: "job.failed",
        err: error,
        jobId: job.id,
        eventType: job.event_type,
        attempts: job.attempts,
        durationMs: Date.now() - startedAt,
        ...summary
      }, formatJobMessage("failed", job.event_type, summary));
      failJob(args.db, job.id, job.attempts, error);
    }
  };

  const timer = setInterval(() => {
    tick().catch((error) => log.error({ err: error }, "worker tick failed"));
  }, args.intervalMs ?? WORKER_TICK_INTERVAL_MS);
  void tick();
  return timer;
}

type JobPayloadSummary = {
  action?: string;
  repository?: string;
  pullNumber?: number;
  headSha?: string;
};

function summarizeJobPayload(payloadJson: string): JobPayloadSummary {
  try {
    const payload = JSON.parse(payloadJson) as {
      action?: string;
      repository?: { full_name?: string };
      pull_request?: { number?: number; head?: { sha?: string } };
      issue?: { number?: number; pull_request?: unknown };
    };
    return {
      action: payload.action,
      repository: payload.repository?.full_name,
      pullNumber: payload.pull_request?.number ?? (payload.issue?.pull_request ? payload.issue.number : undefined),
      headSha: payload.pull_request?.head?.sha
    };
  } catch {
    return {};
  }
}

function formatJobMessage(status: string, eventType: string, summary: JobPayloadSummary): string {
  const scope = summary.repository && summary.pullNumber
    ? `${summary.repository}#${summary.pullNumber}`
    : summary.repository ?? "unknown repository";
  const action = summary.action ? ` ${summary.action}` : "";
  return `${eventType}${action} job ${status} for ${scope}`;
}
