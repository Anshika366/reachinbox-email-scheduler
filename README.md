# ReachInbox Full-Stack Email Scheduler

A production-grade, distributed email scheduling platform engineered for the ReachInbox Software Development Intern hiring assignment. Built with Node.js, Express, TypeScript, PostgreSQL, BullMQ, Redis, Elasticsearch, Ethereal SMTP (Nodemailer), and a React + Vite frontend matching the Outbox Labs Figma specification.

---

## 1. Architecture Overview

```
                                      +--------------------------+
                                      |     React Frontend       |
                                      | (Figma Visual Matching)  |
                                      +-------------+------------+
                                                    | (REST / Sessions)
                                                    v
                                      +--------------------------+
                                      |  Express.js API Server   |
                                      |   (Node.js / TypeScript) |
                                      +---+-----------+------+---+
                                          |           |      |
                 +------------------------+           |      +-------------------------+
                 | (Delayed Jobs)                     | (Persistence)                  | (Search & Analytics)
                 v                                    v                                v
        +------------------+                 +------------------+             +--------------------+
        |   BullMQ Queue   |                 |    PostgreSQL    |             |   Elasticsearch    |
        |  (Redis-Backed)  |                 | (Source of Truth)|             |  (Search Index)    |
        +--------+---------+                 +------------------+             +--------------------+
                 |
                 v
        +------------------+
        |  BullMQ Worker   |
        |  (Concurrency,   |
        | Pacing, Rate-Lim)|
        +--------+---------+
                 |
         +-------+-------+
         |               |
         v               v
  +--------------+  +---------------+
  |   Ethereal   |  |   Slack API   |
  |  SMTP Relay  |  | (Rate Alerts) |
  +--------------+  +---------------+
```

### Core Architecture Highlights
1. **Zero Cron Jobs**: All scheduling is handled via BullMQ delayed jobs backed by Redis event queues. No OS crons, `node-cron`, or `agenda` timers.
2. **PostgreSQL Source of Truth**: All campaigns, senders, and email records are strictly tracked in PostgreSQL with ACID transactional safety.
3. **Distributed Hourly Rate Limiting**: Redis-backed atomic Lua scripts enforce hourly email quotas per sender. When a limit is reached, emails are never dropped or repeatedly retried; they are rescheduled into the next permitted hour window.
4. **Slack Alerting with Deduplication**: Real Slack Web API notifications are dispatched when a sender exceeds the hourly threshold. Deduplication ensures only 1 notification is posted per sender per hourly window.
5. **Cross-Worker Pacing (`MIN_DELAY_MS`)**: Global and per-sender delay is coordinated using Redis atomic keys across all concurrent worker instances.
6. **Restart Recovery**: On backend restart, uncompleted scheduled jobs are reconciled between PostgreSQL and BullMQ without duplicate job creation.
7. **Protected Bull Board**: Interactive queue inspection dashboard located at `/admin/queues` guarded by HTTP Basic Authentication.
8. **Real Ethereal SMTP**: Nodemailer transmits real test SMTP messages to Ethereal, recording message IDs and direct web preview URLs.

---

## 2. Monorepo Structure

```
reachinbox-scheduler/
├── apps/
│   ├── backend/
│   │   ├── src/
│   │   │   ├── config/          # Environment configuration loader
│   │   │   ├── db/              # PostgreSQL pool & automated migrations
│   │   │   ├── middleware/      # Auth & session middleware
│   │   │   ├── queues/          # BullMQ queue producer & recovery reconciliation
│   │   │   ├── routes/          # Express routes (auth, email, sender, slack, health)
│   │   │   ├── services/        # Redis, Nodemailer, Elasticsearch, Slack services
│   │   │   ├── types/           # TypeScript interfaces & DTOs
│   │   │   ├── validators/      # Zod validation schemas
│   │   │   ├── workers/         # BullMQ email worker & pacing engine
│   │   │   ├── app.ts           # Express app setup & Bull Board mounting
│   │   │   └── server.ts        # Bootstrap entry point
│   │   ├── tests/               # Jest automated test suites
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── frontend/
│       ├── src/
│       │   ├── components/      # Sidebar, Header, ScheduledList, SentList, ThreadDetail, ComposeModal
│       │   ├── pages/           # LoginPage, DashboardPage
│       │   ├── services/        # Axios API client
│       │   ├── types/           # Frontend TypeScript types
│       │   ├── App.tsx          # Application shell & route controller
│       │   ├── main.tsx         # React root mounting
│       │   └── index.css        # Tailwind directives & design system styles
│       ├── index.html
│       ├── vite.config.ts
│       ├── tailwind.config.js
│       ├── package.json
│       └── tsconfig.json
├── docker-compose.yml           # PostgreSQL, Redis (AOF), Elasticsearch
├── .env.example                 # Environment variable templates
├── .gitignore                   # Clean ignore rules
├── package.json                 # Workspaces configuration
└── README.md                    # System documentation
```

---

## 3. Prerequisites

- **Windows 10/11** or **macOS / Linux**
- **Node.js**: v18.0.0 or higher (v20+ recommended)
- **npm**: v9.0.0 or higher
- **Docker Desktop**: For running PostgreSQL, Redis, and Elasticsearch containers

---

## 4. Setup & Windows Startup Guide

### Step 1: Clone Repository
```powershell
git clone <repository-url> reachinbox-scheduler
cd reachinbox-scheduler
```

### Step 2: Configure Environment Variables
Copy `.env.example` to `.env` in the root and in `apps/backend/`:
```powershell
Copy-Item .env.example apps/backend/.env
```

### Step 3: Start Infrastructure via Docker
Ensure Docker Desktop is running, then execute:
```powershell
docker compose up -d
```
This launches:
- **PostgreSQL 16**: Port `5432` with volume `pgdata`
- **Redis 7 (Append-Only Persistence)**: Port `6379` with volume `redisdata`
- **Elasticsearch 8.13**: Port `9200` with volume `esdata`

Check container health:
```powershell
docker compose ps
```

### Step 4: Install Dependencies
From the repository root:
```powershell
npm install
```

### Step 5: Start the Backend & Worker
In terminal 1:
```powershell
npm run dev:backend
```
The server will:
1. Run database migrations idempotently.
2. Ensure the Elasticsearch `emails` index exists.
3. Verify or initialize the Ethereal test SMTP transporter.
4. Reconcile any existing pending jobs in the queue.
5. Launch the concurrent BullMQ worker.
6. Listen on `http://localhost:4000`.

### Step 6: Start the Frontend
In terminal 2:
```powershell
npm run dev:frontend
```
Open `http://localhost:5173/` in your browser.

---

## 5. Environment Variables Reference

| Variable | Description | Default |
| :--- | :--- | :--- |
| `PORT` | Backend HTTP port | `4000` |
| `CLIENT_URL` | Frontend client origin for CORS | `http://localhost:5173` |
| `DATABASE_URL` | PostgreSQL connection string | `postgres://postgres@localhost:5433/reachinbox_scheduler` |
| `REDIS_URL` | Redis connection URL | `redis://localhost:6379` |
| `ELASTICSEARCH_URL` | Elasticsearch host URL | `http://localhost:9200` |
| `WORKER_CONCURRENCY` | Number of simultaneous BullMQ jobs | `5` |
| `MIN_DELAY_MS` | Minimum pacing delay between sends | `2000` |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | Sender hourly limit threshold | `100` |
| `ETHEREAL_USER` | Ethereal username (auto-generated if omitted) | Optional |
| `ETHEREAL_PASS` | Ethereal password (auto-generated if omitted) | Optional |
| `GOOGLE_CLIENT_ID` | Google OAuth Client ID | Required for Google Auth |
| `GOOGLE_CLIENT_SECRET` | Google OAuth Client Secret | Required for Google Auth |
| `GOOGLE_CALLBACK_URL` | Google OAuth redirect URI | `http://localhost:4000/api/auth/google/callback` |
| `SESSION_SECRET` | Secret key for HTTP sessions | Strong random string |
| `SLACK_CLIENT_ID` | Slack App Client ID | Required for Slack OAuth |
| `SLACK_CLIENT_SECRET` | Slack App Client Secret | Required for Slack OAuth |
| `SLACK_REDIRECT_URI` | Slack OAuth callback URL | `http://localhost:4000/api/integrations/slack/callback` |
| `SLACK_ENCRYPTION_KEY` | 32-byte key for AES-256 token encryption | Strong key |
| `BULL_BOARD_USER` | Queue dashboard username | `admin` |
| `BULL_BOARD_PASS` | Queue dashboard password (min 8 chars, non-default) | Strong password |

---

## 6. Integration Setup Guides

### Google OAuth Configuration
1. Navigate to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project and configure the OAuth Consent Screen (add scopes `openid`, `email`, `profile`).
3. Create Credentials -> **OAuth Client ID** (Web application).
4. Authorized JavaScript origins: `http://localhost:5173` and `http://localhost:4000`.
5. Authorized redirect URIs: `http://localhost:4000/api/auth/google/callback`.
> Note: Real Google OAuth is enforced across all environments. Ensure `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are configured in `apps/backend/.env`.

### Slack OAuth & Notifications Configuration
1. Go to [Slack API: Your Apps](https://api.slack.com/apps) and create a new App.
2. Under **OAuth & Permissions**:
   - Add Redirect URL: `http://localhost:4000/api/integrations/slack/callback`.
   - Add Bot Token Scopes: `chat:write`, `chat:write.public`, `channels:read`, `channels:join`, `groups:read`, `incoming-webhook`.
3. Add `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET` to `apps/backend/.env`.
4. From the frontend sidebar, click **Connect Slack** to authorize the workspace.
5. In your Slack workspace, invite the bot to your target notification channel (`/invite @reachinbox_scheduler`).
6. When a sender reaches their hourly rate limit, an automated alert is dispatched to the connected Slack channel.

### Ethereal SMTP Email Verification
- Nodemailer automatically provisions an Ethereal test account if credentials are not explicitly supplied.
- Sent emails include direct Ethereal Web preview links in the frontend dashboard ("View in Ethereal" and external link icons).

---

## 7. Protected Bull Board Queue Dashboard

The live queue monitor is mounted at:
```
http://localhost:4000/admin/queues
```
- **Username**: Configured via `BULL_BOARD_USER` (e.g. `admin`)
- **Password**: Configured via `BULL_BOARD_PASS` (must be at least 8 characters; default or weak passwords like `adminpassword` are rejected with HTTP 403 Forbidden).
- Provides real-time metrics for:
  - **Waiting / Delayed jobs**: Displays scheduled emails waiting for their scheduled time.
  - **Active jobs**: Emails currently undergoing dispatch and rate-limit checks.
  - **Completed jobs**: Successfully transmitted emails.
  - **Failed jobs**: Failed attempts with stack traces and retry statuses.

---

## 8. Concurrency, Pacing & Rate Limiting Strategy

### 1. Job-Processing Concurrency vs. Send Pacing
- `WORKER_CONCURRENCY=5` allows BullMQ to evaluate 5 jobs in parallel.
- To prevent burst transmissions that could trigger SMTP bans or spam filters, the worker coordinates send pacing via Redis:
  ```
  acquireSenderSendSlot(senderId, minDelayMs)
  ```
- If a send occurred within `minDelayMs`, the worker atomically delays transmission across all fleet instances.

### 2. Distributed Hourly Rate Limiting
- Evaluated via an atomic Redis Lua script:
  ```
  ratelimit:sender:{senderId}:{hourBucket}
  ```
- If `currentCount >= limit`:
  - The email is **not dropped**.
  - The email is **not failed**.
  - The worker calculates the millisecond duration until the next hour window (`retryAfterMs`).
  - The email's `scheduled_at` timestamp in PostgreSQL is updated to the next window.
  - A new delayed job is scheduled in BullMQ with `delay: retryAfterMs`.
  - A deduplicated Slack notification is triggered for that window.

---

## 9. Restart Recovery Verification

To verify that pending and future scheduled emails survive system restarts:
1. Compose and schedule an email campaign set for 10 minutes in the future.
2. Confirm the job appears in the Bull Board under **Delayed** and in the frontend **Scheduled** list.
3. Terminate the backend server (`Ctrl+C`).
4. Wait 15 seconds, then restart the backend (`npm run dev:backend`).
5. On bootstrap, `reconcileScheduledJobs()` inspects all scheduled records, verifies their BullMQ queue state, and restores any unqueued records without resetting timestamps or creating duplicates.
6. The emails remain scheduled and will dispatch at the requested time.

---

---

## 10. Automated Testing & Verification

Run the full automated test suite:
```powershell
npm test
```
The suite executes 20 automated tests across unit and integration test suites:
- **Authentication & Protected Routes**: Unauthorized access rejections, session verification, Google OAuth endpoint validation, and health check validation.
- **Email Scheduling & Persistence**: Future date/time scheduling, PostgreSQL transaction persistence, BullMQ delayed job creation, and idempotent restart reconciliation.
- **Distributed Rate Limiting & Pacing**: Atomic Redis Lua script evaluation, per-hour quota boundaries, retry delay calculations, and cross-worker non-overlapping pacing slots.
- **SMTP Delivery & Ethereal Previews**: Nodemailer transmission, real Ethereal messageId generation, and preview URL persistence.
- **Elasticsearch Indexing & Search**: Document indexing, multi-match search with field weighting, tenant data isolation, and resilient fallback to PostgreSQL.
- **Slack OAuth & Deduplicated Alerts**: AES-256-CBC token encryption/decryption, OAuth URL construction with encoded state, and single-alert enforcement per sender per hourly window.

Standalone executable verification scripts:
```powershell
npx tsx scripts/e2e-verify.ts
npx tsx scripts/test-es-real.ts
npx tsx scripts/test-concurrent-worker.ts
npx tsx scripts/test-stop-restart.ts
npx tsx scripts/test-api-schedule.ts
```

Run production builds:
```powershell
npm run build
```
Builds both the backend TypeScript bundle (`tsc`) and the frontend bundle (`vite build`).

---

## 11. Five-Minute Demo Video Walkthrough Guide

1. **Architecture & Figma Visual Matching (0:00 - 1:00)**:
   - Present the running application at `http://localhost:5173/`.
   - Point out visual matching with the Figma design: user card, Compose button styling, Scheduled/Sent badges, and table rows.
2. **Scheduling a Campaign with CSV Upload (1:00 - 2:00)**:
   - Click **Compose**.
   - Upload a CSV list of recipients or type custom addresses.
   - Set inter-message delay (e.g. 2 sec) and hourly limit.
   - Select a schedule time or quick preset ("Tomorrow, 10:00 AM").
   - Click **Send Later**.
3. **Queue Monitoring & Bull Board (2:00 - 3:00)**:
   - Navigate to `http://localhost:4000/admin/queues`.
   - Inspect the delayed job entries and metadata.
4. **Delivery & Ethereal SMTP Preview (3:00 - 3:45)**:
   - Observe worker dispatching the emails.
   - Switch to the **Sent** tab in the dashboard.
   - Click **View in Ethereal** to show the real email rendered in the Ethereal inbox.
5. **Rate Limiting, Slack Alert & Restart Recovery (3:45 - 5:00)**:
   - Demonstrate rate-limit rescheduling and the Slack rate-limit alert message.
   - Stop and restart the backend server to show that queued emails are retained.

---

## 12. GitHub Repository Submission & Access

Prepare the repository:
```powershell
git init
git add .
git commit -m "Complete ReachInbox Full-Stack Email Scheduler with Figma alignment"
```

Push to your private GitHub repository:
```powershell
git remote add origin https://github.com/<your-username>/reachinbox-scheduler.git
git branch -M main
git push -u origin main
```

### Collaborator Invitations
Go to your repository **Settings** -> **Collaborators** -> **Add people** and invite the evaluators:
- `Mitrajit`
- `Yadav036`

### Submission Form
Submit your private repository URL and demo video via the ClickUp submission form:
- **ClickUp Submission Form**: [https://forms.clickup.com/9005062261/f/8cbwp3n-8876/6NNNJ92DV93PQTAYST](https://forms.clickup.com/9005062261/f/8cbwp3n-8876/6NNNJ92DV93PQTAYST)
