import type { Db } from "../../db/connection.js";
import { enqueueJob } from "../../db/jobs.js";
import {
  getPullRequestRecord,
  setPaused,
  upsertPullRequest,
  upsertRepository
} from "../../db/review-state.js";
import { githubClient } from "../../github/client.js";
import { getPullRequest } from "../../github/pulls.js";

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

export async function handleIssueCommentJob(
  db: Db,
  payload: IssueCommentPayload,
  botName: string
): Promise<void> {
  if (payload.action !== "created" || !payload.issue.pull_request || !payload.installation?.id) return;
  const body = payload.comment.body.trim().toLowerCase();
  const mention = `@${botName.toLowerCase()}`;
  if (!body.startsWith(mention)) return;

  const owner = payload.repository.owner.login;
  const repoName = payload.repository.name;
  const prNumber = payload.issue.number;
  const repo = upsertRepository(db, owner, repoName, payload.installation.id);

  const wantsPause = body.includes("pause");
  const wantsResume = body.includes("resume");
  const wantsReview = body.includes("review");

  if (wantsPause || wantsResume) {
    const existing = getPullRequestRecord(db, repo.id, prNumber);
    if (existing) {
      if (wantsPause) setPaused(db, repo.id, prNumber, true);
      if (wantsResume) setPaused(db, repo.id, prNumber, false);
    }
  }

  if (!wantsReview) return;

  const existing = getPullRequestRecord(db, repo.id, prNumber);
  let baseSha = existing?.base_sha;
  let headSha = existing?.head_sha;

  if (!baseSha || !headSha) {
    const client = await githubClient(payload.installation.id);
    const pull = await getPullRequest(client, owner, repoName, prNumber);
    baseSha = pull.base.sha;
    headSha = pull.head.sha;
    upsertPullRequest(db, repo.id, prNumber, baseSha, headSha);
  }

  enqueueJob(db, "pull_request", {
    action: body.includes("full") ? "opened" : "synchronize",
    installation: payload.installation,
    repository: payload.repository,
    pull_request: {
      number: prNumber,
      base: { sha: baseSha },
      head: { sha: headSha }
    }
  });
}