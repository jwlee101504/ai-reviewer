# ai-review-bot

Personal GitHub App review bot inspired by CodeRabbit.

## Current scope

Implemented first end-to-end path:

```text
PR opened/reopened/synchronize
-> GitHub webhook
-> SQLite job
-> worker
-> repo clone/fetch
-> diff generation
-> LLM JSON review
-> GitHub pull request review comments
-> summary issue comment
-> last_reviewed_sha stored
```

Also included:

- duplicate finding suppression by fingerprint
- filtering findings to changed diff lines only
- min confidence filtering
- local SQLite migrations
- `@bot pause`, `@bot resume`, and basic `@bot review` command parsing
- swappable LLM adapter interface with `claude-cli`, `codex-cli`, and `openai-api`

## Setup

```bash
npm install
cp .env.example .env
```

Fill `.env`:

```text
GITHUB_APP_ID=...
GITHUB_PRIVATE_KEY_PATH=./private-key.pem
GITHUB_WEBHOOK_SECRET=...
CONFIG_PATH=./config.yml
PORT=3000
```

Required GitHub App permissions:

- Contents: read
- Pull requests: read/write
- Issues: read/write
- Metadata: read

Webhook events:

- Pull request
- Issue comment

Webhook URL:

```text
https://your-host/webhooks/github
```

## Run

```bash
npm run dev
```

Health check:

```text
GET /healthz
```

## Docker Compose

Docker Compose works on Windows and Linux and is the preferred local production-like setup.

For the short setup path, see `QUICKSTART.md`.

Use a Cloudflare named tunnel with a token. Do not use a temporary `trycloudflare.com` URL for normal use, because that URL changes every time and would force you to update the GitHub webhook repeatedly.

The Compose image installs `@openai/codex` and mounts your host Codex config directory so `codex-cli` can use your existing CLI subscription login. Set `CODEX_HOME_HOST` to the directory that contains `auth.json`.

Set these values in `.env`:

```text
GITHUB_APP_ID=...
GITHUB_WEBHOOK_SECRET=...
PORT=3000
CLOUDFLARED_TUNNEL_TOKEN=...
CODEX_HOME_HOST=/mnt/c/Users/<you>/.codex
```

Keep the GitHub App private key at `./private-key.pem`; Compose mounts it as a Docker secret at runtime.

One-time Cloudflare setup:

1. Go to `Cloudflare Dashboard -> Networking -> Tunnels`.
2. Create or select a named tunnel.
3. Select `Add a replica`.
4. Copy the `eyJ...` token from the generated `cloudflared ... --token ...` command into `CLOUDFLARED_TUNNEL_TOKEN`.
5. Create a Public Hostname for your domain.
6. Set the Public Hostname service URL to the Compose service name:

```text
http://ai-reviewer:3000
```

Do not use `http://localhost:3000` for the Cloudflare container. Inside Docker, `localhost` would mean the `cloudflared` container itself.

If you are using the Cloudflare One dashboard instead, the tunnel page may be under `Networks -> Connectors -> Cloudflare Tunnels`.

Then set the GitHub App webhook URL once:

```text
https://your-host/webhooks/github
```

Run the app plus Cloudflare Tunnel:

```powershell
npm run compose:up
```

`compose:up:tunnel` is kept as a backwards-compatible alias:

```powershell
npm run compose:up:tunnel
```

Both services use `restart: unless-stopped`, so after the first successful run Docker will restart them after a reboot as long as Docker itself starts.

View logs:

```powershell
npm run compose:logs
```

Stop:

```powershell
npm run compose:down
```

With the named tunnel, the public hostname stays fixed. You should not need to edit the GitHub webhook URL again unless you change domains or recreate the tunnel.

## Configuration

Edit `config.yml` to choose the LLM provider, review limits, ignore patterns, review languages, and fix behavior.

For `claude-cli`, the `claude` binary must be available in `PATH`.
For `codex-cli`, the `codex` binary must be available in `PATH`.
For `openai-api`, set `OPENAI_API_KEY`.

## Notes

The first implementation posts review comments only on added lines in the PR diff. The `fix` workflow and pull request review comment commands are intentionally left as the next layer.
