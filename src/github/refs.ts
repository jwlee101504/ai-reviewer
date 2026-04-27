export function httpsCloneUrl(owner: string, repo: string, token: string): string {
  return `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
}

export function publicRemoteUrl(owner: string, repo: string): string {
  return `https://github.com/${owner}/${repo}.git`;
}
