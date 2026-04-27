import { Octokit } from "@octokit/rest";
import { getInstallationToken } from "./auth.js";

export type GitHubClient = Octokit;

export async function githubClient(installationId: number): Promise<GitHubClient> {
  const token = await getInstallationToken(installationId);
  return new Octokit({ auth: token });
}
