# Production Runtime Runbook

This application now separates runtime responsibilities explicitly.

## Process roles

- `web`: serves HTTP, tRPC, OAuth, uploads, static assets, and process-local usage tracking.
- `worker`: consumes AI jobs, refreshes worker heartbeats, retries/recoveries long-running Agent nodes.
- `scheduler`: runs periodic in-process schedulers behind a MySQL advisory leader lock.
- `all`: development-only convenience mode for running everything in one process.

## Required production environment

- `NODE_ENV=production`
- `DATABASE_URL`
- `JWT_SECRET`
- `TOOL_SECRET_KEY` with at least 32 characters
- `TOOL_SECRET_KEY_VERSION`, starting with `v1`

Recommended production settings:

```bash
APP_PROCESS_ROLE=web
AI_JOB_IN_PROCESS=false
TOOL_SECRET_KEY=<stable-32+-character-secret>
TOOL_SECRET_KEY_VERSION=v1
SCHEDULED_TASK_UIDS=<comma-separated-platform-task-uids>
```

Scheduled HTTP callbacks reject anonymous production requests. Prefer an
allowlist in `SCHEDULED_TASK_UIDS` for Manus Heartbeat. On platforms that can
send a custom header, configure `SCHEDULED_TASK_SECRET` and send it as
`x-scheduled-task-secret` or a Bearer token.

## Start commands

```bash
pnpm build
pnpm start
pnpm start:worker:ai
pnpm start:scheduler
```

## Deployment checklist

1. Back up the production database.
2. Run pending Drizzle/SQL migrations, including `0104_emperor_agent_artifacts.sql` through `0120_image_workflow_outline_contract.sql`.
3. Configure stable `TOOL_SECRET_KEY` and `TOOL_SECRET_KEY_VERSION` before starting any Web, Worker, or Scheduler process.
4. Start Web with `APP_PROCESS_ROLE=web` and `AI_JOB_IN_PROCESS=false`.
5. Start at least one Worker with `APP_PROCESS_ROLE=worker`.
6. Start exactly one Scheduler process, or multiple Scheduler replicas sharing the same database and `SCHEDULER_LEADER_LOCK_NAME`.
7. Configure `SCHEDULED_TASK_UIDS` after creating the Heartbeat tasks, or use
   `SCHEDULED_TASK_SECRET` where custom callback headers are supported.
8. Verify `/healthz` and `/readyz` on Web.
9. Verify Worker heartbeat through the AI Job dashboard/API.

## Scheduler leader lock

Schedulers use MySQL `GET_LOCK` with `SCHEDULER_LEADER_LOCK_NAME`, defaulting to:

```text
amazon-listing-tool:scheduler
```

Only the process that owns this lock starts timers. If the leader exits or loses the DB connection, MySQL releases the lock.
