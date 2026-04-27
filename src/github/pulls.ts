import type { GitHubClient } from "./client.js";

export async function getPullRequest(client: GitHubClient, owner: string, repo: string, pullNumber: number) {
  const { data } = await client.rest.pulls.get({ owner, repo, pull_number: pullNumber });
  return data;
}

export async function listPullFiles(client: GitHubClient, owner: string, repo: string, pullNumber: number) {
  return client.paginate(client.rest.pulls.listFiles, {
    owner,
    repo,
    pull_number: pullNumber,
    per_page: 100
  });
}
