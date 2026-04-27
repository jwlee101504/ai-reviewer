import fs from "node:fs";
import { App } from "@octokit/app";
import { requiredEnv } from "../config/load.js";

let app: App | undefined;

export function getGitHubApp(): App {
  if (app) return app;
  const privateKey = fs.readFileSync(requiredEnv("GITHUB_PRIVATE_KEY_PATH"), "utf8");
  app = new App({
    appId: requiredEnv("GITHUB_APP_ID"),
    privateKey
  });
  return app;
}

export async function getInstallationOctokit(installationId: number) {
  return getGitHubApp().getInstallationOctokit(installationId);
}

export async function getInstallationToken(installationId: number): Promise<string> {
  const app = getGitHubApp();
  const { data } = await app.octokit.request("POST /app/installations/{installation_id}/access_tokens", {
    installation_id: installationId
  });
  return data.token;
}
