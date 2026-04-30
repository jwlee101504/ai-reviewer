# DB Schema

`data/bot.sqlite` 한 파일에 모든 상태가 저장됩니다 (better-sqlite3 + WAL 모드).
스키마 정의는 `src/db/migrations.ts:1`의 단일 `db.exec()` 블록에 모여 있고,
앱 부팅 시 `CREATE TABLE IF NOT EXISTS`로 멱등 적용됩니다.

- 연결/PRAGMA: `src/db/connection.ts:1` — `journal_mode=WAL`, `foreign_keys=ON`
- 스키마 버저닝 없음 (마이그레이션 파일 한 덩어리)

테이블은 5개. 이 중 `review_runs`는 **현재 코드에서 읽지도 쓰지도 않는 데드 테이블**입니다.

---

## 1. `repositories`

설치된 GitHub 리포지토리 메타데이터와 로컬 클론 경로 캐시.

| 컬럼 | 타입 | 제약 | 설명 | 사용처 |
|---|---|---|---|---|
| `id` | INTEGER | PK, AUTOINCREMENT | 내부 식별자 | FK 대상 (다른 테이블의 `repo_id`) |
| `owner` | TEXT | NOT NULL, `UNIQUE(owner, name)` | GitHub 소유자 | `upsertRepository` 키 |
| `name` | TEXT | NOT NULL, `UNIQUE(owner, name)` | 리포 이름 | `upsertRepository` 키 |
| `installation_id` | INTEGER | NOT NULL | GitHub App 설치 ID — 토큰 발급에 필요 | upsert 시 갱신 |
| `clone_path` | TEXT | NOT NULL | 로컬 클론 경로 (절대경로). 기본 `<cwd>/repos/cache/<owner>__<name>`, `REPO_CACHE_DIR` env로 베이스 디렉토리 변경 가능 | upsert 시 갱신 |

쓰기: `src/db/review-state.ts:23` `upsertRepository` (INSERT … ON CONFLICT DO UPDATE).
읽기: 같은 함수 마지막 SELECT, FK 조인.

---

## 2. `pull_requests`

PR별 리뷰 진행 상태. 같은 PR 재방문 시 중복 리뷰 방지와 `@bot pause/resume` 토글에 사용.

| 컬럼 | 타입 | 제약 | 설명 | 사용처 |
|---|---|---|---|---|
| `id` | INTEGER | PK, AUTOINCREMENT | 내부 식별자 | — |
| `repo_id` | INTEGER | NOT NULL, FK → `repositories(id)` ON DELETE CASCADE | 리포 참조 | 모든 조회 키 |
| `pr_number` | INTEGER | NOT NULL, `UNIQUE(repo_id, pr_number)` | GitHub PR 번호 | upsert 키 |
| `base_sha` | TEXT | NOT NULL | PR base 브랜치 SHA | upsert 시 갱신 |
| `head_sha` | TEXT | NOT NULL | PR head SHA (현재) | upsert 시 갱신 |
| `last_reviewed_sha` | TEXT | NULL 허용 | 마지막으로 리뷰 완료한 head SHA — 같은 SHA에 대해 재리뷰 스킵 | `markReviewed`로 기록 |
| `paused` | INTEGER | NOT NULL, DEFAULT 0 | 0/1 boolean. `@bot pause` 시 1, `@bot resume` 시 0 | `setPaused` |
| `last_summary_comment_id` | INTEGER | NULL 허용 | 마지막으로 게시한 PR 요약 코멘트의 GitHub 코멘트 ID — 다음 실행 시 갱신/대체에 사용 | `markReviewed`, `setLastSummaryCommentId` |

쓰기/읽기: `src/db/review-state.ts:36` (`upsertPullRequest`, `getPullRequestRecord`, `markReviewed`, `setPaused`, `setLastSummaryCommentId`).

---

## 3. `findings`

LLM이 산출한 개별 리뷰 지적 항목. **핑거프린트 기반 중복 억제**가 핵심 목적.

| 컬럼 | 타입 | 제약 | 설명 | 사용처 |
|---|---|---|---|---|
| `id` | INTEGER | PK, AUTOINCREMENT | 내부 식별자 | — |
| `repo_id` | INTEGER | NOT NULL, FK → `repositories(id)` ON DELETE CASCADE | 리포 참조 | 키 |
| `pr_number` | INTEGER | NOT NULL | PR 번호 | 키 |
| `fingerprint` | TEXT | NOT NULL, `UNIQUE(repo_id, pr_number, fingerprint)` | `sha256(file_path:line:title:body)` — 같은 PR 내 중복 finding 차단 | `fingerprintFinding` (`src/db/findings.ts:5`) |
| `file_path` | TEXT | NOT NULL | 지적 대상 파일 | INSERT만 |
| `line` | INTEGER | NOT NULL | 지적 라인 번호 | INSERT만 |
| `severity` | TEXT | NOT NULL | `low` / `medium` / `high` / `critical` (스키마는 `src/review/schema.ts:6`의 zod enum) | INSERT만 |
| `title` | TEXT | NOT NULL | 지적 제목 | INSERT만 |
| `body` | TEXT | NOT NULL | 지적 본문 (마크다운) | INSERT만 |
| `github_comment_id` | INTEGER | NULL 허용 | 게시된 GitHub PR 리뷰 코멘트 ID를 묶어두려 정의되어 있음 | **읽기/쓰기 코드 없음 (미사용)** |
| `status` | TEXT | NOT NULL, DEFAULT `'open'` | 라이프사이클 의도용 (`open`/`resolved`/`dismissed` 등) | INSERT 시 `'open'` 고정. **갱신 코드 없음 (미사용)** |
| `created_at` | TEXT | NOT NULL, DEFAULT `CURRENT_TIMESTAMP` | 생성 시각 | 자동 |

쓰기: `src/db/findings.ts:11` `insertNewFindings` — `INSERT OR IGNORE`로 중복 핑거프린트는 조용히 무시.
읽기: 현재 없음 (중복 차단은 UNIQUE 제약 + `OR IGNORE`로 끝).

> ⚠️ `github_comment_id`와 `status`는 정의만 되어 있고 갱신 경로가 없습니다.
> 향후 finding 라이프사이클 추적이나 코멘트 리졸루션 동기화를 추가할 때 활용 예정인 것으로 보임.

---

## 4. `jobs`

GitHub 웹훅을 받아서 워커가 처리하는 단일 큐. SQLite 트랜잭션 + `locked_at` 타임아웃으로 단일/다중 워커 모두 안전.

| 컬럼 | 타입 | 제약 | 설명 | 사용처 |
|---|---|---|---|---|
| `id` | INTEGER | PK, AUTOINCREMENT | 큐 순서 (`ORDER BY id`로 FIFO) | claim 키 |
| `event_type` | TEXT | NOT NULL | 핸들러 매핑 키. 현재 값: `pull_request`, `issue_comment` (`src/worker/runner.ts:21`) | 라우팅 |
| `payload_json` | TEXT | NOT NULL | 웹훅 raw body 또는 enqueue 시 stringify된 JSON | 핸들러에서 `JSON.parse` |
| `status` | TEXT | NOT NULL, DEFAULT `'pending'` | `pending` → `running` → `done` / `failed` | 모든 큐 함수 |
| `attempts` | INTEGER | NOT NULL, DEFAULT 0 | 클레임할 때마다 +1 | 백오프 계산 (`failJob`) |
| `next_run_at` | TEXT | NOT NULL, DEFAULT `CURRENT_TIMESTAMP` | 재시도 시점. 실패 시 `+min(60, 2^attempts)` 분 뒤로 미룸 | `claimNextJob` 필터, `failJob` |
| `locked_at` | TEXT | NULL 허용 | claim 시점. 15분 (`JOB_LOCK_TIMEOUT_MINUTES`) 지나면 stale로 간주, `recoverStaleJobs`가 회수 | `claimNextJob`, `recoverStaleJobs` |
| `error` | TEXT | NULL 허용 | 마지막 실패 메시지 | `failJob` |
| `created_at` | TEXT | NOT NULL, DEFAULT `CURRENT_TIMESTAMP` | 큐잉 시각 | 자동 |

**인덱스:** `idx_jobs_ready (status, next_run_at, locked_at)` — `claimNextJob`의 WHERE 조건을 그대로 커버.

상태 전이:

```
enqueueJob       → INSERT status='pending', locked_at=NULL
claimNextJob     → UPDATE status='running', locked_at=now, attempts+=1
completeJob      → UPDATE status='done',    locked_at=NULL
failJob (재시도) → UPDATE status='pending', locked_at=NULL, next_run_at=+백오프
failJob (5회+)   → UPDATE status='failed',  locked_at=NULL
recoverStaleJobs → UPDATE status='pending' WHERE running AND locked_at<=now-15min
```

쓰기/읽기: `src/db/jobs.ts:1` 전체.
큐잉 진입점: `src/server/webhook.ts:57` (웹훅 raw body 그대로), `src/worker/handlers/issue-comment.ts:72` (자기-디스패치).

---

## 5. `review_runs` ⚠️ **데드 테이블**

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | INTEGER | PK, AUTOINCREMENT | — |
| `repo_id` | INTEGER | NOT NULL, FK → `repositories(id)` ON DELETE CASCADE | — |
| `pr_number` | INTEGER | NOT NULL | — |
| `run_type` | TEXT | NOT NULL | 의도상 `auto` / `manual` 등의 트리거 유형 |
| `base_sha` | TEXT | NOT NULL | — |
| `head_sha` | TEXT | NOT NULL | — |
| `status` | TEXT | NOT NULL | 의도상 `running` / `succeeded` / `failed` |
| `error` | TEXT | NULL 허용 | 실패 메시지 |
| `created_at` | TEXT | NOT NULL, DEFAULT `CURRENT_TIMESTAMP` | — |
| `updated_at` | TEXT | NOT NULL, DEFAULT `CURRENT_TIMESTAMP` | (트리거나 갱신 코드 없음 — 사실상 created_at 복사본) |

**`migrations.ts` 외에 어떤 코드도 이 테이블을 참조하지 않습니다** (`grep` 결과 정의 라인 단 1건).
원래 의도는 리뷰 실행 이력 감사 로그였던 것으로 보이지만 현재는 빈 껍데기. 인덱스도 없어서, 살리려면 최소한 `(repo_id, pr_number, created_at)` 인덱스가 필요합니다.

---

## 관계 다이어그램

```
repositories (1) ──┬── (N) pull_requests   [UNIQUE(repo_id, pr_number)]
                   ├── (N) findings        [UNIQUE(repo_id, pr_number, fingerprint)]
                   └── (N) review_runs     [데드]

jobs                                       [독립, repo와 FK 없음]
```

`jobs`는 의도적으로 리포/PR과 FK를 두지 않습니다 — 큐잉 시점에는 아직 리포 레코드가 없을 수 있고, payload(JSON)에서 owner/repo/PR을 파싱해 핸들러가 직접 `upsertRepository` / `upsertPullRequest`로 보장하기 때문입니다.

---

## 알려진 디바이딩 라인 (문서화 시점 기준 미사용/유보 컬럼)

- `findings.github_comment_id` — INSERT/UPDATE 없음
- `findings.status` — 항상 `'open'`, 갱신 경로 없음
- `review_runs.*` — 테이블 전체

이들은 의도적으로 남겨둔 확장 슬롯으로 보이며, 제거할지 채울지는 별도 결정 사안입니다.
