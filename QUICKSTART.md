# 빠른 시작

## 1. 최초 1회 설정

Cloudflare Dashboard에서 **Named Tunnel**을 만든다. `trycloudflare.com` 임시 터널은 쓰지 않는다.

현재 UI 기준 위치:

```text
Cloudflare Dashboard -> Networking -> Tunnels
```

Cloudflare One을 쓰는 경우에는 아래 경로일 수 있다.

```text
Cloudflare One -> Networks -> Connectors -> Cloudflare Tunnels
```

Tunnel에서 **Add a replica**를 눌러 실행 명령을 복사하고, `--token` 뒤의 `eyJ...` 값을 `.env`에 넣는다.

Public Hostname의 service URL은 아래처럼 설정한다.

```text
http://ai-reviewer:3000
```

GitHub App webhook URL은 고정 도메인으로 한 번만 등록한다.

```text
https://your-host/webhooks/github
```

`.env` 파일을 만든다.

```text
GITHUB_APP_ID=...
GITHUB_WEBHOOK_SECRET=...
PORT=3000
OPENAI_API_KEY=...
CLOUDFLARED_TUNNEL_TOKEN=...
```

GitHub App private key는 아래 위치에 둔다.

```text
./private-key.pem
```

Docker Compose에서는 API 기반 LLM 설정을 쓴다.

```powershell
cp config.docker.example.yml config.yml
```

## 2. 실행

앱만 실행:

```powershell
npm run compose:up
```

앱과 Cloudflare Tunnel 같이 실행:

```powershell
npm run compose:up:tunnel
```

## 3. 확인

```powershell
npm run compose:logs
```

헬스체크:

```text
http://localhost:3000/healthz
```

## 4. 중지

```powershell
npm run compose:down
```

이후에는 GitHub webhook URL을 다시 바꿀 필요 없다.
