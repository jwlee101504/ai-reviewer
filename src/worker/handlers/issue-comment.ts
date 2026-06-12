import type { AppConfig } from "../../config/schema.js";
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
    author_association?: string;
  };
};

const TRUSTED_AUTHOR_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

export async function handleIssueCommentJob(args: {
  db: Db;
  config: AppConfig;
  payload: unknown;
}): Promise<void> {
  const payload = args.payload as IssueCommentPayload;
  const botName = args.config.bot.name;
  if (payload.action !== "created" || !payload.issue.pull_request || !payload.installation?.id) return;
  const body = payload.comment.body.trim().toLowerCase();
  const mention = `@${botName.toLowerCase()}`;
  if (!body.startsWith(mention)) return;
  if (!isTrustedCommentAuthor(payload.comment.author_association)) return;

  const owner = payload.repository.owner.login;
  const repoName = payload.repository.name;
  const prNumber = payload.issue.number;
  const repo = upsertRepository(args.db, owner, repoName, payload.installation.id);

  const wantsPause = body.includes("pause");
  const wantsResume = body.includes("resume");
  const wantsReview = body.includes("review");

  if (wantsPause || wantsResume) {
    const existing = getPullRequestRecord(args.db, repo.id, prNumber);
    if (existing) {
      if (wantsPause) setPaused(args.db, repo.id, prNumber, true);
      if (wantsResume) setPaused(args.db, repo.id, prNumber, false);
    }
  }

  if (!wantsReview) return;

  const existing = getPullRequestRecord(args.db, repo.id, prNumber);
  let baseSha = existing?.base_sha;
  let headSha = existing?.head_sha;

  if (!baseSha || !headSha) {
    const client = await githubClient(payload.installation.id);
    const pull = await getPullRequest(client, owner, repoName, prNumber);
    baseSha = pull.base.sha;
    headSha = pull.head.sha;
    upsertPullRequest(args.db, repo.id, prNumber, baseSha, headSha);
  }

  enqueueJob(args.db, "pull_request", {
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

export function isTrustedCommentAuthor(authorAssociation: string | undefined): boolean {
  return Boolean(authorAssociation && TRUSTED_AUTHOR_ASSOCIATIONS.has(authorAssociation));
}
