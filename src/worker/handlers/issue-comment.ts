import type { Db } from "../../db/connection.js";
import { enqueueJob } from "../../db/jobs.js";
import { setPaused, upsertPullRequest, upsertRepository } from "../../db/review-state.js";

type IssueCommentPayload = {
  action: string;
  installation?: { id: number };
  repository: {
    name: string;
    owner: { login: string };
  };
  issue: {
    number: number;
    pull_request?: unknown;
  };
  comment: {
    body: string;
  };
};

export function handleIssueCommentJob(db: Db, payload: IssueCommentPayload, botName: string): void {
  if (payload.action !== "created" || !payload.issue.pull_request || !payload.installation?.id) return;
  const body = payload.comment.body.trim().toLowerCase();
  const mention = `@${botName.toLowerCase()}`;
  if (!body.startsWith(mention)) return;

  const owner = payload.repository.owner.login;
  const repo = upsertRepository(db, owner, payload.repository.name, payload.installation.id);
  const pr = upsertPullRequest(db, repo.id, payload.issue.number, "unknown", "unknown");

  if (body.includes("pause")) setPaused(db, repo.id, payload.issue.number, true);
  if (body.includes("resume")) setPaused(db, repo.id, payload.issue.number, false);
  if (body.includes("review")) {
    enqueueJob(db, "pull_request", {
      action: body.includes("full") ? "opened" : "synchronize",
      installation: payload.installation,
      repository: payload.repository,
      pull_request: {
        number: pr.pr_number,
        base: { sha: pr.base_sha },
        head: { sha: pr.head_sha }
      }
    });
  }
}
