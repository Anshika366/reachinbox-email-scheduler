# ReachInbox Full-Stack Email Scheduler

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white" alt="Express" />
  <img src="https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React" />
  <img src="https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white" alt="Tailwind" />
  <img src="https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white" alt="Redis" />
  <img src="https://img.shields.io/badge/BullMQ-E74C3C?style=for-the-badge&logo=redis&logoColor=white" alt="BullMQ" />
  <img src="https://img.shields.io/badge/Elasticsearch-005571?style=for-the-badge&logo=elasticsearch&logoColor=white" alt="Elasticsearch" />
  <img src="https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker" />
  <img src="https://img.shields.io/badge/Jest-C21325?style=for-the-badge&logo=jest&logoColor=white" alt="Jest" />
</p>

A distributed, production-grade email scheduling platform engineered for the ReachInbox Software Development Intern hiring assignment. Built with Node.js, Express, TypeScript, PostgreSQL, BullMQ, Redis, Elasticsearch, and Ethereal SMTP (Nodemailer), accompanied by a React + Vite frontend matching the Outbox Labs Figma design specifications.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Features](#2-features)
3. [Technology Stack](#3-technology-stack)
4. [Architecture and Data Flow](#4-architecture-and-data-flow)
5. [Prerequisites](#5-prerequisites)
6. [Installation and Local Setup](#6-installation-and-local-setup)
7. [Environment Variables](#7-environment-variables)
8. [Running the Application](#8-running-the-application)
9. [Email Scheduling and Rate Limiting](#9-email-scheduling-and-rate-limiting)
10. [Crash Recovery and Delivery Semantics](#10-crash-recovery-and-delivery-semantics)
11. [Slack Notifications](#11-slack-notifications)
12. [Search and Monitoring](#12-search-and-monitoring)
13. [API Documentation](#13-api-documentation)
14. [Testing and Verification](#14-testing-and-verification)
15. [Project Structure](#15-project-structure)
16. [Security Architecture](#16-security-architecture)
17. [Known Limitations and Trade-offs](#17-known-limitations-and-trade-offs)
18. [License and Contribution](#18-license-and-contribution)

---

## 1. Project Overview

The **ReachInbox Scheduler** solves the problem of reliable cold email dispatch and rate-controlled campaign scheduling at scale. In cold email infrastructure, blasting hundreds of emails simultaneously triggers anti-spam defenses, burns sender domain reputations, and leads to provider bans.

This platform provides:
- **Rate-controlled email queueing**: Distributes dispatches over time according to sender hourly quotas and minimum delays.
- **Fail-closed crash resilience**: Preserves scheduling state across server reboots without automated duplicate transmissions.
- **Full-text email search**: High-speed multi-field indexing via Elasticsearch with automated database fallback.
- **Real-time visibility**: Web-accessible BullMQ dashboard and Ethereal SMTP preview links.

---

## 2. Features Implemented (Requirement Mapping)

### Backend Features
- **Scheduler**: Persistent temporal dispatching powered by BullMQ delayed jobs (`addEmailToQueue`) backed by Redis. Strict adherence to non-cron scheduling (0 cron dependencies).
- **Persistence & Crash Recovery**: PostgreSQL ACID relational source of truth (`emails` table). On bootstrap, `reconcileScheduledJobs()` scans for un-sent scheduled emails and reconstructs missing BullMQ jobs without duplicate transmissions.
- **Rate Limiting**: Configurable fixed hourly window bucket limits per sender (`MAX_EMAILS_PER_HOUR_PER_SENDER`) enforced across distributed workers via atomic Redis Lua scripts (`checkAndIncrementHourlyRateLimit`). Over-quota emails are rescheduled into the next hour window rather than dropped. Live Slack alerting triggers when hourly quotas are hit with deduplication.
- **Concurrency & Pacing**: Configurable BullMQ worker fleet (`WORKER_CONCURRENCY`). Cross-worker sender pacing (`MIN_DELAY_MS`) guarantees non-overlapping send slots per sender via atomic Redis Lua locks (`acquireSenderSendSlot`).
- **Search & Inspection**: Full-text multi-field search via Elasticsearch (`/api/emails/search`) with PostgreSQL fallback; web-accessible Bull Board queue monitoring (`/admin/queues`) protected by HTTP Basic Auth.
- **Ethereal SMTP Relay**: Nodemailer SMTP delivery with real Message-ID capture and direct web preview links for inspection.

### Frontend Features (Outbox Labs Figma Matched)
- **Login**: Real Google OAuth 2.0 authorization-code flow (`/api/auth/google`) with HTTP-only session cookies (`connect.sid`), user profile display, and secure logout. Also includes instant email/password development authentication.
- **Dashboard**: Figma-aligned interface with top user profile header (name, email, avatar), sidebar navigation, dynamic counts, and logout trigger.
- **Compose**: Rich HTML/text email composer, bulk CSV/text lead upload with format validation and live recipient count detection, scheduling presets ("Tomorrow 10:00 AM" or custom UTC timestamp), send delay configuration, and hourly limit overrides.
- **Tables (Scheduled & Sent)**:
  - **Scheduled Emails Table**: Displays recipient, subject, scheduled time, and status (`scheduled`, `processing`) with loading skeletons and empty states.
  - **Sent Emails Table**: Displays recipient, subject, sent time, status (`sent`, `failed`), delivery uncertainty notices, and direct **"View in Ethereal"** preview links with loading skeletons and empty states.

---

## 3. Technology Stack

| Component | Technology | Version | Purpose |
| :--- | :--- | :--- | :--- |
| **Backend Framework** | ![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=nodedotjs&logoColor=white) ![Express](https://img.shields.io/badge/Express-000000?style=flat-square&logo=express&logoColor=white) | Node v20+, Express 4.21 | REST API, route controllers, session handling |
| **Language** | ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white) | v5.7.3 | End-to-end static typing across workspaces |
| **Relational Database** | ![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=flat-square&logo=postgresql&logoColor=white) | v16 | Primary ACID source of truth for email states |
| **Queue & Worker Engine** | ![BullMQ](https://img.shields.io/badge/BullMQ-E74C3C?style=flat-square&logo=redis&logoColor=white) | v5.41.0 | Persistent delayed job queueing and background workers |
| **In-Memory Store** | ![Redis](https://img.shields.io/badge/Redis-DC382D?style=flat-square&logo=redis&logoColor=white) | v7 (AOF enabled) | Queue storage, atomic Lua rate limiters, pacing locks |
| **Search Engine** | ![Elasticsearch](https://img.shields.io/badge/Elasticsearch-005571?style=flat-square&logo=elasticsearch&logoColor=white) | v8.17.0 | Full-text email document search and multi-field matching |
| **Email Transport** | ![Nodemailer](https://img.shields.io/badge/Nodemailer-00A86B?style=flat-square&logo=gmail&logoColor=white) | v6.10.0 | RFC 5321 SMTP transport to Ethereal relay |
| **Frontend Framework** | ![React](https://img.shields.io/badge/React-20232A?style=flat-square&logo=react&logoColor=61DAFB) ![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat-square&logo=vite&logoColor=white) | React 18.3, Vite 6.1 | Single-page application matching Figma specification |
| **Styling** | ![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=flat-square&logo=tailwind-css&logoColor=white) | v3.4.17 | Modern responsive UI matching Outbox Labs design |
| **Icons** | ![Lucide](https://img.shields.io/badge/Lucide_React-F56565?style=flat-square&logo=feather&logoColor=white) | v0.475.0 | Design-system aligned iconography |
| **Testing** | ![Jest](https://img.shields.io/badge/Jest-C21325?style=flat-square&logo=jest&logoColor=white) ![Supertest](https://img.shields.io/badge/Supertest-4B5563?style=flat-square&logo=npm&logoColor=white) | Jest 29.7, Supertest 7.0 | Automated unit and integration testing |

---

## 4. Architecture and Data Flow

```mermaid
flowchart TD
    subgraph Client["Client Tier"]
        UI["React SPA (Figma Design)"]
    end

    subgraph API["Backend API (Express / TypeScript)"]
        Router["Express Router & Auth Middleware"]
        AuthMe["Session Store (connect.sid)"]
    end

    subgraph Storage["Persistence & Queues"]
        PG[("PostgreSQL - Source of Truth")]
        RedisQueue[("Redis 7 - BullMQ Delayed Queue")]
        ES[("Elasticsearch 8 - Full-Text Search")]
    end

    subgraph Workers["Async Worker Fleet"]
        Worker["BullMQ Worker (concurrency=5)"]
        Pacing["Atomic Lua Sender Pacing"]
        RateLimit["Atomic Lua Hourly Limiter"]
    end

    subgraph External["External Services"]
        GoogleAuth["Google OAuth 2.0 API"]
        SMTPRelay["Ethereal SMTP Relay"]
        SlackAPI["Slack Web API"]
    end

    UI -->|"REST / JSON"| Router
    UI <-->|"OAuth Redirection"| GoogleAuth
    Router -->|"Check / Create Session"| AuthMe
    Router -->|"1. Insert Record (scheduled)"| PG
    Router -->|"2. Enqueue Delayed Job"| RedisQueue
    Router -->|"3. Index Document"| ES

    RedisQueue -->|"Pop Due Jobs"| Worker
    Worker -->|"Query State Guard"| PG
    Worker -->|"Check / Acquire Slot"| Pacing
    Worker -->|"Check / Increment Quota"| RateLimit

    RateLimit -->|"If Over Quota: Reschedule"| RedisQueue
    RateLimit -->|"Deduplicated Alert"| SlackAPI

    Pacing -->|"Wait Slot & Dispatch"| SMTPRelay
    SMTPRelay -->|"Return Message-ID"| Worker
    Worker -->|"Update Status (sent/failed)"| PG
    Worker -->|"Update Status"| ES
```

### Source of Truth Architecture
- **PostgreSQL is the single source of truth** for all email records, sender configurations, and delivery statuses.
- **BullMQ / Redis acts as the temporal scheduling mechanism**. If Redis is cleared or restarted, the backend reconciliation routine (`reconcileScheduledJobs()`) reconstructs missing delayed jobs directly from PostgreSQL.

---

## 5. Prerequisites

Before installing the application, verify that your environment satisfies:

- **Node.js**: `v20.x` or higher (verified with Node.js v24.15).
- **npm**: `v9.x` or higher.
- **Docker & Docker Compose**: Docker Desktop installed and running (for local PostgreSQL, Redis, and Elasticsearch containers).
- **Git**: Installed for repository management.

---

## 6. Installation and Local Setup

### Step 1: Clone Repository
```bash
git clone <YOUR_PRIVATE_GITHUB_REPO_URL> reachinbox-scheduler
cd reachinbox-scheduler
```

### Step 2: Configure Environment Variables
Copy the provided `.env.example` templates:
```bash
# Windows PowerShell
Copy-Item .env.example .env
Copy-Item apps/backend/.env.example apps/backend/.env

# macOS / Linux
cp .env.example .env
cp apps/backend/.env.example apps/backend/.env
```

### Step 3: Launch Local Infrastructure
Start PostgreSQL, Redis, and Elasticsearch using Docker Compose:
```bash
docker compose up -d
```
Verify that all 3 services are running:
```bash
docker compose ps
```
- PostgreSQL: `localhost:5433` (mapped from container 5432)
- Redis: `localhost:6379`
- Elasticsearch: `localhost:9200`

### Step 4: Install Dependencies
From the repository root:
```bash
npm install
```

---

## 7. Environment Variables

The project uses a root `.env` and `apps/backend/.env`. All sensitive credentials remain in ignored `.env` files.

| Variable Name | Required | Default / Example | Purpose |
| :--- | :--- | :--- | :--- |
| `PORT` | Yes | `4000` | Port for Express backend HTTP server |
| `NODE_ENV` | Yes | `development` | Environment mode (`development` or `production`) |
| `CLIENT_URL` | Yes | `http://localhost:5173` | Allowed CORS origin and OAuth redirect target |
| `DATABASE_URL` | Yes | `postgres://postgres:postgrespassword@localhost:5433/reachinbox_scheduler` | PostgreSQL connection pool URL |
| `REDIS_URL` | Yes | `redis://localhost:6379` | Redis connection URL for BullMQ and Lua scripts |
| `ELASTICSEARCH_URL` | Yes | `http://localhost:9200` | Elasticsearch cluster endpoint |
| `WORKER_CONCURRENCY` | Yes | `5` | Maximum simultaneous jobs processed per worker instance |
| `MIN_DELAY_MS` | Yes | `2000` | Minimum spacing (milliseconds) between dispatches per sender |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | Yes | `100` | Default hourly quota threshold per sender identity |
| `ETHEREAL_USER` | No | *(auto-generated if omitted)* | Ethereal SMTP username |
| `ETHEREAL_PASS` | No | *(auto-generated if omitted)* | Ethereal SMTP password |
| `ETHEREAL_HOST` | No | `smtp.ethereal.email` | Ethereal SMTP host |
| `ETHEREAL_PORT` | No | `587` | Ethereal SMTP submission port |
| `GOOGLE_CLIENT_ID` | Yes (for OAuth) | *(from Google Cloud Console)* | Google OAuth 2.0 Web Client ID |
| `GOOGLE_CLIENT_SECRET` | Yes (for OAuth) | *(from Google Cloud Console)* | Google OAuth 2.0 Web Client Secret |
| `GOOGLE_CALLBACK_URL` | Yes | `http://localhost:4000/api/auth/google/callback` | Authorized Google OAuth redirect URI |
| `SESSION_SECRET` | Yes | `reachinbox_secret_session_key_1234567890` | Secret key for signed session cookies |
| `SLACK_CLIENT_ID` | Optional | *(from Slack Developer Portal)* | Slack App Client ID |
| `SLACK_CLIENT_SECRET` | Optional | *(from Slack Developer Portal)* | Slack App Client Secret |
| `SLACK_REDIRECT_URI` | Optional | `http://localhost:4000/api/integrations/slack/callback` | Slack OAuth callback URL |
| `SLACK_ENCRYPTION_KEY` | Yes | `reachinbox_slack_encryption_key_32bytes_min` | 32-byte secret key for AES-256 token encryption |
| `BULL_BOARD_USER` | Yes | `admin` | HTTP Basic Auth username for queue monitor |
| `BULL_BOARD_PASS` | Yes | *(set strong non-default password)* | HTTP Basic Auth password (min 8 chars, non-default) |

### Secret Safety and Production Setup
- **Placeholder Values vs. Production Secrets**: The default secret strings shown above (`reachinbox_secret_session_key_...`, `reachinbox_slack_encryption_key_...`) are local development placeholders. In production environments, replace them with unique, cryptographically strong random secrets.
- **`SESSION_SECRET`**: Used by `express-session` to sign the HTTP-only session cookie (`connect.sid`). Generate a unique 32-byte secret (e.g., via `openssl rand -hex 32` or Node.js `crypto.randomBytes(32).toString('hex')`).
- **`SLACK_ENCRYPTION_KEY`**: Key used for AES-256-CBC encryption of Slack Bot tokens in PostgreSQL (`access_token_encrypted`). Must be a distinct string of at least 32 characters/bytes.
- **`BULL_BOARD_PASS`**: Password guarding the Bull Board administrative UI (`/admin/queues`). In production mode (`NODE_ENV=production`), passwords shorter than 8 characters or defaults like `adminpassword` are rejected by the authentication middleware.
- **Ethereal SMTP Credentials**: If `ETHEREAL_USER` and `ETHEREAL_PASS` are omitted or left blank in `.env`, the backend automatically calls `nodemailer.createTestAccount()` on initial dispatch to generate ephemeral credentials. To persist and review emails under a fixed account dashboard across multiple server restarts, register for a free account at [https://ethereal.email](https://ethereal.email) and populate both variables.
- **Google OAuth Setup**: Obtain credentials in Google Cloud Console under APIs & Services > Credentials > OAuth 2.0 Client IDs. Ensure `http://localhost:4000/api/auth/google/callback` is added to **Authorized redirect URIs**.
- **Slack OAuth Setup**: Create an app in [api.slack.com/apps](https://api.slack.com/apps), configure Bot Token Scopes (`chat:write`, `channels:read`), and set the Redirect URL to `http://localhost:4000/api/integrations/slack/callback`.

---

## 8. Running the Application

### Development Mode (Two Terminals)

**Terminal 1 — Backend & BullMQ Worker**:
```bash
npm run dev:backend
```
*On bootstrap, the backend automatically runs migrations, verifies Elasticsearch indices, checks Ethereal credentials, executes crash reconciliation, and launches the worker on port 4000.*

**Terminal 2 — Frontend Dev Server**:
```bash
npm run dev:frontend
```
*Vite launches the React application on `http://localhost:5173/`.*

### Single-Command Startup
```bash
npm run dev
```

### Production Build Verification
```bash
npm run build
```
Compiles backend TypeScript via `tsc` and frontend via `tsc && vite build`.

### Common Troubleshooting
- **Database Connection Error**: Verify Docker container is running (`docker compose ps`) and port `5433` is accessible.
- **Port Conflict**: If port 4000 or 5173 is in use, modify `PORT` or `CLIENT_URL` in `.env`.
- **Bull Board 403 Forbidden**: In production, weak passwords like `adminpassword` are rejected. Set `BULL_BOARD_PASS` to a strong string with at least 8 characters.

---

## 9. Email Scheduling and Rate Limiting

### 1. Recipient Ingestion & CSV Parsing
- **Individual Input**: Recipients can be typed manually; format is validated via standard RFC regex.
- **CSV / File Import**: The modal accepts `.csv` and text files. The parser (`csv-parse/sync`) cleans whitespace, deduplicates entries, and filters invalid email rows, giving real-time count feedback.

### 2. Multi-Worker Pacing Coordination
To prevent spam filter flags, dispatches for a sender must be spaced apart by at least `MIN_DELAY_MS` (default: 2,000 ms).
- Managed via an atomic Redis Lua script: `acquireSenderSendSlot(senderId, minDelayMs)`.
- When multiple worker threads process jobs for the same sender simultaneously, each worker receives an atomic reservation timestamp guaranteeing strictly non-overlapping sends.

### 3. Distributed Fixed Hourly Window Quota
- Hourly quotas are tracked per sender via an atomic Redis Lua script: `checkAndIncrementHourlyRateLimit(senderId, limit)`.
- **Window Bucket Mechanism**: Uses fixed hourly window buckets computed via `Math.floor(Date.now() / 3600000)`. Redis key structure: `ratelimit:sender:{senderId}:{hourBucket}` with automatic millisecond TTL (`PEXPIRE`) equal to the remaining time in the current UTC hour.
- **Atomic Quota Reservation**: The Lua script atomically increments the counter only if the current count is strictly below the limit, preventing race conditions across concurrent workers.
- **Rescheduling Behavior**: If quota is exceeded, the email is **never dropped**. The worker calculates the exact milliseconds remaining until the start of the next hour window (`retryAfterMs`), updates `scheduled_at` in PostgreSQL, re-enqueues a delayed BullMQ job, and triggers a deduplicated Slack alert.

---

## 10. Crash Recovery and Delivery Semantics

### 1. The Realities of External SMTP Protocols
Standard SMTP relays (RFC 5321) do not participate in distributed Two-Phase Commit (2PC) transactions with PostgreSQL. A non-transactional boundary exists during transmission:
1. The worker transmits the payload to SMTP (`await sendEmailViaSmtp(...)`).
2. The remote SMTP relay accepts the envelope (`250 2.0.0 OK: Message accepted for delivery`) and returns a generated `Message-ID`.
3. If the backend process crashes (SIGKILL, OOM, power cut) *after* SMTP relay acceptance but *before* PostgreSQL commits `status = 'sent'`, the database row remains in status `processing` with `smtp_message_id = NULL`.

### 2. Fail-Closed, At-Most-Once Automated Recovery Policy
Because raw SMTP cannot be queried to determine whether an ambiguous envelope was accepted, automatically re-enqueuing in-flight emails risks duplicate delivery.

On server reboot, `reconcileScheduledJobs()` executes:
- **`status = 'scheduled'`**: Safe to re-enqueue. BullMQ restores the delayed job matching the remaining time until `scheduled_at` (these emails were never in flight to SMTP).
- **`status = 'sent'`**: Excluded from reconciliation. Never re-sent.
- **`status = 'processing'` with `smtp_message_id`**: Proves SMTP relay acceptance succeeded before the crash. Recovery finalizes status to `sent`.
- **`status = 'processing'` without `smtp_message_id` (Fail-Closed)**: To strictly satisfy the **no-duplicate-email requirement**, automated re-enqueuing is **suppressed**. The email is marked `status = 'failed'` with an explicit delivery uncertainty explanation:
  > `Interrupted by server restart while in processing state. Automatic re-enqueue suppressed to prevent duplicate delivery (delivery status uncertain).`

### 3. Caution Regarding Manual Retries
Manual retries are **not blindly safe**. If the relay accepted the email before the crash, triggering a manual resend will deliver a duplicate email to the recipient. The UI displays this delivery notice so operators make an informed decision.

---

## 11. Slack Notifications

- **Trigger**: Dispatched automatically when a sender reaches their configured hourly limit.
- **Destination**: Sent to the connected user's configured Slack channel (e.g. `#all-reachinbox-testing`).
- **Deduplication**: Backed by PostgreSQL table `rate_limit_notifications` with unique constraint on `(sender_id, hourly_window)`. Exactly one notification is sent per sender per hourly window.
- **Token Security**: Tokens are stored with AES-256-CBC encryption (`access_token_encrypted`) and decrypted only in backend memory when calling the Slack API.

---

## 12. Search and Monitoring

### Elasticsearch Integration
- **Indexing**: All emails are indexed into the `emails` Elasticsearch index upon creation and updated upon status transitions (`sent` / `failed`).
- **Multi-Match Search**: The `/api/emails/search` endpoint performs weighted multi-match searches across `recipient^3`, `subject^2`, `body`, and `senderEmail`.
- **Tenant Isolation**: Every query includes mandatory filter `{ term: { userId } }`, preventing users from searching other accounts' data.
- **Resilient Fallback**: If Elasticsearch is unreachable, the API falls back to PostgreSQL `ILIKE` queries seamlessly.

### Protected Bull Board
- URL: `http://localhost:4000/admin/queues`
- Configured with HTTP Basic Authentication (`BULL_BOARD_USER` / `BULL_BOARD_PASS`).
- Displays live counts for Delayed, Active, Completed, and Failed jobs.

---

## 13. API Documentation

All routes require authentication (session cookie `connect.sid`) unless marked `Public`.

### Authentication Routes (`/api/auth`)
- `GET /api/auth/google` *(Public)*: Redirects browser to Google OAuth consent screen.
- `GET /api/auth/google/url` *(Public)*: Returns `{ url: string }` for Google OAuth redirect.
- `GET /api/auth/google/callback` *(Public)*: Handles Google OAuth code exchange, creates user/sender, establishes session.
- `GET /api/auth/me`: Returns current user `{ user, senders }` or `401 Unauthorized`.
- `POST /api/auth/login` *(Public)*: Password login with scrypt verification.
- `POST /api/auth/logout`: Invalidates session and clears cookie.

### Email Routes (`/api/emails`)
- `POST /api/emails/schedule`: Schedules an email campaign.
  - Body: `{ senderId, recipients: string[], subject, body, scheduledAt, minDelayMs?, hourlyLimit?, idempotencyKey? }`
  - Response `201`: `{ success: true, count: number, emailIds: string[] }`
- `GET /api/emails/scheduled`: Returns paginated scheduled and processing emails.
  - Query params: `page`, `limit`
  - Response `200`: `{ emails: EmailRecord[], total: number, page, limit }`
- `GET /api/emails/sent`: Returns paginated sent and failed emails.
  - Query params: `page`, `limit`
  - Response `200`: `{ emails: EmailRecord[], total: number, page, limit }`
- `GET /api/emails/counts`: Returns `{ scheduled: number, sent: number }`.
- `GET /api/emails/search`: Full-text search via Elasticsearch.
  - Query params: `q` (query string), `status`
  - Response `200`: `{ emails: EmailRecord[], total: number, source: "elasticsearch" | "database" }`
- `GET /api/emails/:id`: Fetches single email details.
- `POST /api/emails/upload-csv`: Multipart upload (field `file`), parses and validates recipients.
  - Response `200`: `{ validRecipients: string[], invalidEntries: string[], totalValid: number, totalInvalid: number }`

### Sender Routes (`/api/senders`)
- `GET /api/senders`: Returns user's configured senders.
- `POST /api/senders`: Creates a sender identity `{ name, email, hourlyLimit? }`.

### Slack Routes (`/api/integrations/slack`)
- `GET /api/integrations/slack/url`: Returns Slack OAuth URL.
- `GET /api/integrations/slack/status`: Returns `{ isConnected: boolean, teamName?: string, channelName?: string }`.
- `POST /api/integrations/slack/disconnect`: Disconnects integration.

### Health Routes (`/api/health`)
- `GET /api/health` *(Public)*: Checks database, Redis, and Elasticsearch connectivity.
  - Response `200`: `{ status: "healthy", services: { database: "connected", redis: "connected", elasticsearch: "connected" } }`

---

## 14. Testing and Verification

### Automated Test Suite
Run all unit and integration tests:
```bash
npm test
```

### Verified Test Coverage (23 Tests Passing)
- **Authentication**: Route protections, session validation, unauthorized rejections.
- **Persistence & BullMQ**: Delayed scheduling, PostgreSQL row creation, job removal cleanup.
- **Fail-Closed Recovery**: Tests verifying that interrupted `processing` emails without `smtp_message_id` are marked `failed` and NOT re-enqueued, and that emails with `smtp_message_id` are finalized to `sent`.
- **Recovery Idempotency**: Verified that `sent` emails are completely ignored by reconciliation.
- **Atomic Concurrency**: Redis Lua fixed hourly window rate limiting, positive retry delay calculations, and non-overlapping sequential slot reservation.
- **SMTP Delivery**: Live Nodemailer Ethereal dispatch, Message-ID capture, preview URL verification.
- **Elasticsearch Search**: Document indexing, user isolation queries, fallback verification.
- **Slack Alerting**: AES-256 token encryption, OAuth URL generation, and single alert deduplication per window.

### 1,000-Job Load Simulation vs. End-to-End Throughput
- **Load Simulation Result**: 1,000 delayed jobs enqueued into BullMQ/Redis in **139 ms** (~7,194 jobs/sec) with 3.10 MB Redis memory footprint.
- **End-to-End Delivery Distinction**: In production, delivering 1,000 emails end-to-end is governed by `MIN_DELAY_MS` (e.g. 2,000ms delay = 2,000 seconds per single sender thread) to protect domain reputation and prevent SMTP provider throttling.

---

## 15. Project Structure

```
reachinbox-scheduler/
├── apps/
│   ├── backend/
│   │   ├── src/
│   │   │   ├── config/          # Environment configuration loader
│   │   │   ├── db/              # PostgreSQL pool & automated migrations
│   │   │   ├── middleware/      # Auth & session middleware
│   │   │   ├── queues/          # BullMQ queue producer & recovery reconciliation
│   │   │   ├── routes/          # Express route controllers
│   │   │   ├── services/        # Redis, Nodemailer, Elasticsearch, Slack services
│   │   │   ├── types/           # TypeScript interfaces & DTOs
│   │   │   ├── validators/      # Zod validation schemas
│   │   │   ├── workers/         # BullMQ email worker & pacing engine
│   │   │   ├── app.ts           # Express application configuration
│   │   │   └── server.ts        # Bootstrap entrypoint
│   │   ├── tests/               # Jest automated unit and integration tests
│   │   └── package.json
│   └── frontend/
│       ├── src/
│       │   ├── components/      # ComposeModal, Header, Sidebar, ScheduledList, SentList, ThreadDetail
│       │   ├── pages/           # LoginPage, DashboardPage
│       │   ├── services/        # Axios API client
│       │   ├── types/           # Frontend TypeScript types
│       │   ├── App.tsx          # Router and root state controller
│       │   └── main.tsx         # React application entrypoint
│       └── package.json
├── docker-compose.yml           # Local PostgreSQL, Redis, Elasticsearch containers
├── .env.example                 # Sanitized configuration template
├── package.json                 # Monorepo workspaces definition
└── README.md                    # Project documentation
```

---

## 16. Security Architecture

1. **Zero Committed Secrets**: `.gitignore` strictly ignores `.env` and `.env.*`. All example files contain empty placeholders.
2. **Encrypted Token Storage**: Slack Bot tokens are encrypted at rest using AES-256-CBC with unique initialization vectors (IVs).
3. **HTTP-Only Session Cookies**: Session IDs are stored in signed, HTTP-only cookies (`connect.sid`) with `sameSite: lax`.
4. **Tenant Isolation**: Every database query and Elasticsearch search includes mandatory `WHERE user_id = $1` filters.
5. **Basic Auth Guard on Bull Board**: Queue inspection dashboard requires HTTP Basic Auth. Weak or default passwords are rejected in production.

---

## 17. Known Limitations and Trade-offs

1. **At-Most-Once Automated Recovery**:
   - Because standard SMTP lacks Two-Phase Commit, in-flight emails interrupted by an ungraceful crash cannot be automatically retried without risking duplicate delivery.
   - The system fails closed: it suppresses automatic retries and marks the email as `failed`. If the crash occurred before SMTP receipt, the email remains unsent until manually re-dispatched.
2. **Manual Retry Duplicate Risk**:
   - If the SMTP relay accepted an envelope immediately before a crash, manually re-sending will deliver a duplicate email. The UI surfaces this warning to operators.
3. **Throughput vs. Pacing**:
   - Send throughput per sender is intentionally bounded by `MIN_DELAY_MS` to prevent spam filter triggers. Senders are also subject to configured hourly limits (enforced via fixed hourly window buckets). High aggregate throughput requires scaling across multiple verified sender identities.

4. **1,000-Job Enqueue Simulation vs. End-to-End Delivery**:
   - The 1,000-job benchmark validates BullMQ and Redis memory and enqueue performance (139ms duration for 1,000 jobs). It does not guarantee instantaneous external email delivery, as live delivery is intentionally rate-limited by `MIN_DELAY_MS` pacing and provider hourly limits.

---

## 18. License and Contribution

This project was developed exclusively as a private evaluation assignment for the ReachInbox hiring process. It does not carry an open-source software license. All rights are reserved by the author.
