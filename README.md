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

## Configuration

Edit `config.yml` to choose the LLM provider, review limits, ignore patterns, review languages, and fix behavior.

For `claude-cli`, the `claude` binary must be available in `PATH`.
For `codex-cli`, the `codex` binary must be available in `PATH`.
For `openai-api`, set `OPENAI_API_KEY`.

## Notes

The first implementation posts review comments only on added lines in the PR diff. The `fix` workflow and pull request review comment commands are intentionally left as the next layer.
