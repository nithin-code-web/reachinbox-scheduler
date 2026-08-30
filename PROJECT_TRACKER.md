# ReachInbox Scheduler — Project Tracker

## Project Status

Tasks 1–15 are complete and committed. Task 16 is the current final documentation task. No new feature work is planned in this task.

PostgreSQL is the source of truth. Redis and BullMQ handle asynchronous email scheduling and delivery. Elasticsearch is an eventually consistent searchable projection. Authentication is request-scoped and does not interfere with background workers.

## Task Progress

| # | Task | Status |
|---:|---|---|
| 1 | `chore: initialize backend foundation` | Complete |
| 2 | `chore: add docker infrastructure` | Complete |
| 3 | `feat: add database schema and migrations` | Complete |
| 4 | `feat: implement email scheduling` | Complete |
| 5 | `feat: add bullmq email worker` | Complete |
| 6 | `feat: implement rate limiting` | Complete |
| 7 | `feat: add email idempotency` | Complete |
| 8 | `feat: integrate ethereal smtp` | Complete |
| 9 | `feat: add elasticsearch indexing` | Complete |
| 10 | `feat: add google authentication` | Complete |
| 11 | `feat: add slack integration` | Complete |
| 12 | `feat: add bullmq dashboard` | Complete |
| 13 | `feat: build dashboard UI` | Complete |
| 14 | `feat: integrate frontend with backend` | Complete |
| 15 | `test: add scheduler reliability tests` | Complete |
| 16 | `docs: add setup and architecture documentation` | In progress |

## Completed Work

### Tasks 1–4 — Backend, infrastructure, schema, and scheduling

- Strict TypeScript/Express backend with Zod validation, structured Pino logging, security middleware, health checks, error handling, 404 handling, and graceful shutdown.
- Docker Compose development services for PostgreSQL 16, Redis 7, Elasticsearch 8.15.5, and the backend, with named persistent volumes and healthchecks.
- Prisma 7 PostgreSQL schema and migrations for users, senders, campaigns, emails, Slack connections, email statuses, and processing leases.
- Campaign scheduling creates a campaign and one durable PostgreSQL email record per recipient, then creates one deterministic delayed BullMQ job per email.

### Tasks 5–8 — Worker, throttling, idempotency, and SMTP

- `email-scheduler` consumes `send-email` jobs through Ethereal SMTP.
- PostgreSQL email status is the idempotency source of truth. Email IDs have unique idempotency keys and jobs use deterministic `email-{emailId}` IDs.
- Processing leases and heartbeats allow expired `PROCESSING` records to be reclaimed after worker crashes while protecting active owners.
- Redis Lua scripts atomically implement the sender-level hourly limit and distributed send spacing across workers.
- The effective sender hourly limit is the lowest active campaign limit participating in the current UTC hour. Reservations are revalidated at hour boundaries and before SMTP begins.
- BullMQ email jobs use three attempts with exponential backoff. SMTP cannot provide true exactly-once delivery across a process crash after provider acceptance and before PostgreSQL records `SENT`.

### Task 9 — Elasticsearch

- Committed as `e990561 feat: add elasticsearch email indexing`.
- Uses `reachinbox-emails-v1` with explicit mappings and PostgreSQL email IDs as Elasticsearch document IDs.
- Indexing is asynchronous and outside PostgreSQL transactions. Bounded retries and startup/periodic reconciliation repair missing or stale documents.
- Search filters by authenticated `userId`, returns matching IDs, hydrates canonical PostgreSQL records, and performs a final ownership check.
- Scheduled and sent listing endpoints remain PostgreSQL-backed and independent of Elasticsearch.
- Verified with typecheck, build, tests, Compose validation, and live Elasticsearch checks.

### Task 10 — Google Authentication

- Committed as `15ec535 feat: add google authentication`.
- Uses real Google OAuth 2.0 Authorization Code + OIDC, Redis-backed state, S256 PKCE, and ID-token claim verification.
- Upserts local users by Google subject, with verified email as the linking fallback.
- Creates opaque Redis-backed sessions and stores only the session ID in an HttpOnly, SameSite=Lax cookie.
- Protected campaign, scheduled, sent, and search APIs enforce server-side ownership. Background workers do not require sessions.
- End-to-end login still requires Google Cloud credentials and exact callback configuration.

### Task 11 — Slack integration

- Committed as `d52d1e2 feat: add slack integration`.
- Implements real Slack OAuth v2 with session-bound, Redis-backed state consumed using GETDEL.
- Stores encrypted Slack bot tokens, workspace/team ID, and optional channel ID; channel selection is separate from installation.
- Uses `slack-notifications` and a separate worker for campaign scheduled, campaign scheduling failure, email sent, and permanent email failure notifications.
- Slack failures are isolated from email delivery and have bounded independent retries.
- Slack scopes are `chat:write`, `channels:read`, and `groups:read`.

### Task 12 — BullMQ dashboard

- Committed as `1c67c48 feat: add bullmq dashboard`.
- Mounts read-only Bull Board at `/admin/queues` behind the existing application authentication middleware.
- Exposes `email-scheduler` and `slack-notifications` without creating another service or Redis instance.

### Tasks 13–14 — Frontend and integration

- Committed as `e41c404 feat: build dashboard UI` and `aab2713 feat: integrate frontend with backend`.
- React/Vite dashboard preserves the assignment UI with scheduled/sent views, search, pagination, compose, CSV parsing, loading/empty/error states, and Google login entry.
- Frontend API requests use `credentials: 'include'`, no localStorage tokens, authenticated `/auth/me`, the exact campaign payload, and `VITE_DEFAULT_SENDER_ID` because no sender-list endpoint exists.
- Selected local date/time values are converted with `toISOString()` before submission.

### Task 15 — Scheduler reliability tests

- Committed as `f55cf2c test: add scheduler reliability tests`.
- Added focused coverage for delayed job persistence, deterministic duplicate prevention, missing-job recovery, processing lease recovery, concurrent claim protection, SMTP retry/permanent failure, hourly limits, send spacing, and durable rescheduling state.
- The focused reliability suite passed 9/9 twice against live Docker-network PostgreSQL and Redis using fake SMTP.
- The full backend suite passed 50/50 in the Compose network.
- A minimal worker testability export and SMTP promise rejection-handling correction were the only production worker adjustments.

## Current Architecture

```text
React frontend
      |
      v
Express API + auth middleware
      |
      +--> PostgreSQL / Prisma (authoritative state)
      +--> Redis-backed opaque sessions
      +--> BullMQ email-scheduler --> email worker --> rate limits/leases --> Ethereal SMTP
      +--> Elasticsearch projection/search (eventually consistent)
      +--> BullMQ slack-notifications --> Slack worker --> Slack API
      +--> Read-only Bull Board at /admin/queues
```

## Infrastructure / Technology Stack

- Node.js, TypeScript, Express 5, React 19, Vite
- Prisma 7 with PostgreSQL driver adapter, PostgreSQL 16
- Redis 7, ioredis, BullMQ 5
- Elasticsearch 8.15.5 and official Node.js client
- Nodemailer/Ethereal SMTP
- Google `google-auth-library`, Slack Web API via `fetch`
- Zod, Helmet, CORS, Pino, Docker Compose

## Important Environment Variables

- Backend connection: `DATABASE_URL`, `REDIS_URL`, `ELASTICSEARCH_URL` or `ELASTICSEARCH_NODE`.
- Worker controls: `WORKER_CONCURRENCY`, `EMAIL_SEND_DELAY_MS`, `PROCESSING_LEASE_MS`.
- SMTP: `ETHEREAL_HOST`, `ETHEREAL_PORT`, `ETHEREAL_USER`, `ETHEREAL_PASSWORD`, `ETHEREAL_SECURE`.
- Google: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`.
- Slack: `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_REDIRECT_URI`, `SLACK_TOKEN_ENCRYPTION_KEY`, `SLACK_API_TIMEOUT_MS`, `SLACK_NOTIFICATION_CONCURRENCY`, `SLACK_NOTIFICATION_ATTEMPTS`.
- Sessions/OAuth: `SESSION_COOKIE_NAME`, `SESSION_TTL_SECONDS`, `OAUTH_STATE_TTL_SECONDS`, `SESSION_COOKIE_SECURE`.
- Frontend: `VITE_API_BASE_URL`, `VITE_USE_MOCK_DATA`, `VITE_DEFAULT_SENDER_ID`.

`.env` contains secrets and must never be committed. `.env.example` files contain placeholders only.

## Known Issues / Trade-offs

- Google OAuth requires real Google Cloud credentials, consent setup, and callback configuration.
- Slack OAuth requires a configured Slack app and callback URL.
- Ethereal is development/test SMTP only.
- SMTP has an inherent at-least-once crash window after provider acceptance and before PostgreSQL `SENT` persistence.
- Elasticsearch is eventually consistent and search returns `503` while unavailable; PostgreSQL remains authoritative.
- There is no sender-list endpoint; local compose uses an owned UUID in `VITE_DEFAULT_SENDER_ID`.
- Some existing Slack event IDs contain `:` and are rejected by BullMQ as custom job IDs. The failure is logged and isolated from email delivery; this remains a follow-up issue.
- Current npm audit reports four high-severity findings. Do not use `npm audit fix --force` because the suggested changes are breaking dependency upgrades.

## Commit History

- `f55cf2c test: add scheduler reliability tests`
- `aab2713 feat: integrate frontend with backend`
- `e41c404 feat: build dashboard UI`
- `1c67c48 feat: add bullmq dashboard`
- `d52d1e2 feat: add slack integration`
- `15ec535 feat: add google authentication`
- `e990561 feat: add elasticsearch email indexing`
- `f09aec3 feat: add distributed email rate limiting`
- `ad5615b feat: add BullMQ email worker`
- `9581542 feat: add email scheduling with BullMQ`
- `78e3592 feat: add dockerized backend`
- `c2ee4e6 feat: add database schema and dockerized backend`

Task 16 documentation changes are not committed.

## Next Actions

1. Review the final README and tracker against the repository.
2. Configure real Google Cloud and Slack app credentials for browser OAuth verification.
3. Resolve the existing colon-containing Slack notification job IDs in a future maintenance change.
4. Complete the final demo and Git cleanup before submission.

## Final Submission Checklist

- [ ] Backend build
- [ ] Frontend build
- [ ] Unit and integration tests
- [ ] Docker Compose startup
- [ ] PostgreSQL migrations
- [ ] Redis/BullMQ behavior
- [ ] Persistent delayed jobs
- [ ] Rate limiting
- [ ] Idempotency
- [ ] Elasticsearch indexing and search
- [ ] Google OAuth end-to-end login
- [ ] Slack OAuth
- [ ] BullMQ dashboard
- [ ] Frontend/Figma implementation
- [ ] Frontend/backend integration
- [ ] `.env` security and secret scanning
- [ ] README
- [ ] Architecture documentation
- [ ] Demo and recording
- [ ] Final Git cleanup
