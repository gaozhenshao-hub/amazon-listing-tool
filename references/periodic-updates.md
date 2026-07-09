# Periodic Updates — Reference

Scope: any recurring or scheduled work for this site (digests, refreshes, cleanups, end-user-defined schedules, periodic notifications).

Forbidden: `setInterval`, `node-cron`, or any in-process timer. Cloud Run terminates idle instances; in-process timers will not survive.

---

## 1. Pick the right cron type

Two flavors. The difference is what runs at trigger time:

- **Heartbeat (HTTP cron).** Platform POSTs directly to `/api/scheduled/*` on this site. Your handler runs and returns. No agent spawned — if the handler needs an LLM call, do it inline via the site's own LLM SDK (`server/_core/llm.ts`).
- **AGENT cron.** Platform spawns a fresh, isolated Manus session that runs the prompt you wrote at create time. The agent has the full Manus toolchain — browser, file system, shell, image gen, deep research — but **no** session history, DB, source code, or credentials beyond the two env vars `$SCHEDULED_TASK_ENDPOINT_BASE` / `$SCHEDULED_TASK_COOKIE`. If your prompt tells it to, it `curl`s back to `/api/scheduled/*` on this site at the end.

Decision: AGENT cron only if the trigger genuinely needs **agentic capabilities** — i.e. tool use beyond a single LLM call: web browsing, file manipulation, shell, deep research, multi-step planning, etc. A one-shot LLM completion belongs inline in a Heartbeat handler. Do not attempt to replicate complex agentic flows using website-inbuilt capabilities, if it could be outsourced to AGENT cron. End-user-defined schedules (UI on this site lets a user pick when X runs) are **always** Heartbeat — see §3.

Both flavors hit the **same** `/api/scheduled/*` endpoint with the **same** auth shape: `sdk.authenticateRequest(req)` returns `user.isCron === true` with `user.taskUid` set.

---

## 2. Facts (apply to BOTH flavors)

1. Callback path **MUST** start with `/api/scheduled/`. Forge rejects everything else.
2. Add a `schedule_cron_task_uid varchar(65)` column (indexed, nullable) to whatever business row owns the job. **Update / delete / look up the business row by `task_uid`, never by `name` or by anything from `req.body`.**
3. The site **must be deployed** before scheduling — bizserver POSTs the production URL, dev sandboxes are unreachable. For any changes to the callback handler, or creation of callback handler, ALWAYS follow this WORKFLOW: save a checkpoint, ask the user to Deploy, before any schedule actions take place.
4. Wrap handler logic in try/catch and JSON-encode the error on 500 — the platform's Investigate flow surfaces it verbatim.
5. Cron is **6-field** (with seconds): `sec min hour dom mon dow`, UTC, min interval 60s. Use `0` for the seconds field — e.g. `0 0 9 * * *` is daily 09:00 UTC.
6. Handlers must be **idempotent**. The platform retries `5xx` and `429` up to 3 times (3s → 1m backoff). Other `4xx` are treated as business failures and not retried.
7. Handler timeout is 2 minutes per call.

---

## 3. End-user-driven Heartbeat (tRPC create + `/api/scheduled/*` callback)

Required pieces (assumes the `schedule_cron_task_uid` column from Facts #2 is already on the business row):

1. tRPC mutation that calls `createHeartbeatJob(...)` and persists the returned `taskUid` to that column.
2. Express handler at `/api/scheduled/<name>` that authenticates via `sdk.authenticateRequest`, looks up the business row by `taskUid`, runs the work.
3. Explicit `app.post("/api/scheduled/<name>", handler)` in `server/_core/index.ts` before the Vite/static fallthrough — `/api/scheduled/*` is not auto-registered.

A one-time setup walkthrough — do all three steps in one pass; they're a single workflow, not independent options.

**Step 1 — tRPC mutation calls the SDK to create the cron and persists `task_uid` on the business row.** For update / delete / pause / resume, look up `scheduleCronTaskUid` first then call `updateHeartbeatJob(taskUid, patch, sessionToken)` / `deleteHeartbeatJob(taskUid, sessionToken)` — `patch.enable=false` pauses, `true` resumes, omit to leave unchanged. All SDK functions throw `TRPCError`; let trpc bubble.

```ts
import { parse as parseCookie } from "cookie";
import { COOKIE_NAME } from "@shared/const";
import { createHeartbeatJob } from "../_core/heartbeat";

const sessionToken = parseCookie(ctx.req.headers.cookie ?? "")[COOKIE_NAME] ?? "";

const job = await createHeartbeatJob({
  name: `marketing-${campaign.id}`,    // unique within (project, owner)
  cron: input.cron,                    // 6-field "sec min hour dom mon dow"
  path: "/api/scheduled/sendMarketing",
  payload: { campaignId: campaign.id },
  description: `Daily 9am send for ${campaign.name}`,
}, sessionToken);

await db.update(campaigns)
  .set({ scheduleCronTaskUid: job.taskUid })
  .where(eq(campaigns.id, campaign.id));
```

`sessionToken` MUST be the decoded `app_session_id` cookie value, not the raw `Cookie` header — forge attributes the cron to the requesting end-user via this token. Apply your normal ownership check on the business row before scheduling.

**Step 2 — Express handler at `/api/scheduled/<name>` runs on each trigger.** Look up the business row by `user.taskUid` (never by `req.body` fields — the body is attacker-controllable; `taskUid` is set by the cron system). Wrap with try/catch and on 500 return `{ error, stack, context: { url, taskUid }, timestamp }` so the platform Investigate flow can surface it.

```ts
const user = await sdk.authenticateRequest(req);
if (!user.isCron || !user.taskUid) return res.status(403).json({ error: "cron-only" });

const campaign = (await db.select().from(campaigns)
  .where(eq(campaigns.scheduleCronTaskUid, user.taskUid)).limit(1))[0];
if (!campaign) return res.json({ ok: true, skipped: "orphan" }); // 2xx so forge stops retrying

await sendCampaignEmails(campaign);
res.json({ ok: true });
```

**Step 3 — Mount the handler** in `server/_core/index.ts` before the Vite / static fallthrough — `/api/scheduled/*` is not auto-registered.

```ts
app.post("/api/scheduled/sendMarketing", sendMarketingHandler);
```

After deploy, end-users create their own crons via your tRPC mutation. As the project owner, you can also inspect / pause / resume / view logs for any end-user's cron from the sandbox terminal — `manus-heartbeat list --user-id u_xxx` and friends; see §5b. End-users can never see another user's cron through your tRPC SDK.

---

## 4. Variants — when the trigger isn't an end-user

Same callback handler, same `/api/scheduled/*` URL, same `user.isCron` check, **same Manus-platform-managed cron lifecycle** (cron persistence and triggering live entirely on the platform, independent of any sandbox session). Only the **creator** changes.

### 4a. Project-level Heartbeat (no end-user)

For crons your end-users never see (nightly DB cleanup, daily digest to admins, hourly external-API ping) — the cron is owned by the project owner identity. Create via the sandbox CLI (see §5b for the full subcommand list):

```bash
manus-heartbeat create \
  --name nightly-cleanup \
  --cron "0 0 3 * * *" \
  --path /api/scheduled/cleanup \
  --description "Nightly expired-row cleanup"
```

The created cron lives on the Manus platform, not in this sandbox: it survives sandbox hibernation/teardown and keeps firing as long as the deployed site is reachable. Any future Manus session can `manus-heartbeat list` / `update` / `pause` / `delete` it — the cron is bound to the project owner, not to the build session that created it.

Persist the returned `task_uid` somewhere durable (admin DB row / config) if you'll need to update/delete it later — `manus-heartbeat list` can also recover it.

### 4b. AGENT cron — when the trigger needs agentic capabilities

Created via the `schedule` tool inside this Manus session (not from site code). Each trigger spawns a **fresh, isolated** Manus agent — no session history, no source/DB/credentials, no skills. The only knowledge transfer is whatever you write into the cron prompt.

Use it when the work genuinely needs agent intelligence (deep research, content composition, image gen). Tell it WHAT to do, not HOW — it's a real agent, not a workflow runner.

If the AGENT cron needs to write back to **this** site, the only path in is the site's HTTP API:

1. Add `/api/scheduled/<name>` as in §3 Step 2 (same auth, same handler shape).
2. Save a checkpoint and ask the user to Deploy.
3. In the cron prompt, instruct the agent to POST via `curl` (not python libs) using two auto-injected envs:
   - `$SCHEDULED_TASK_ENDPOINT_BASE` — base URL of this site
   - `$SCHEDULED_TASK_COOKIE` — the raw `app_session_id` JWT value
   ```sh
   curl -X POST "$SCHEDULED_TASK_ENDPOINT_BASE/api/scheduled/news" \
     -H "Content-Type: application/json" \
     -H "Cookie: app_session_id=$SCHEDULED_TASK_COOKIE" \
     -d '{"title":"…","body":"…"}'
   ```

The endpoint receives `user.isCron === true` exactly like Heartbeat — no special-casing needed.

### 4c. Owner UI on manus.im (NOT something you build)

The Manus dashboard surfaces ALL crons in the project (both end-user-driven and agent-driven), with execution history, pause/resume, edit, Run Now, and Investigate. Owners can't *create* crons there — only via §3 / §4a / §4b. Mention this to the user when they ask "how do I see/manage all my crons".

---

## 5. References

### 5a. Site SDK — `server/_core/heartbeat.ts`

```ts
type HeartbeatJob = {
  name: string;             // unique within (project, owner)
  cron: string;             // 6-field UTC "sec min hour dom mon dow"
  path: string;             // must start with /api/scheduled/
  method?: "POST" | "PUT";  // default POST
  payload?: unknown;        // JSON body sent on every trigger
  description?: string;
};

type HeartbeatJobUpdate = Partial<Omit<HeartbeatJob, "name">> & {
  enable?: boolean;         // true=resume, false=pause, omit=unchanged
};

type HeartbeatJobInfo = {
  taskUid: string; name: string; userId: string; description: string;
  cronExpression: string; callbackPath: string; callbackMethod: string;
  callbackPayload: string; isEnable: boolean;
  createdAt?: string | null;
  lastExecutedAt?: string | null;
  nextExecutionAt?: string | null;
};

createHeartbeatJob(job: HeartbeatJob, userSession: string)
  : Promise<{ taskUid: string; nextExecutionAt?: string | null }>;

updateHeartbeatJob(taskUid: string, patch: HeartbeatJobUpdate, userSession: string)
  : Promise<{ nextExecutionAt?: string | null }>;

deleteHeartbeatJob(taskUid: string, userSession: string)
  : Promise<void>;

listHeartbeatJobs(userSession: string, pagination?: { page?: number; pageSize?: number })
  : Promise<{ total: number; actorUserId: string; jobs: HeartbeatJobInfo[] }>;
```

`userSession` is the **decoded `app_session_id` cookie value**, NOT the raw Cookie header. All four functions throw `TRPCError` (UNAUTHORIZED / NOT_FOUND / TOO_MANY_REQUESTS / FORBIDDEN / BAD_REQUEST) — let trpc bubble them.

### 5b. Sandbox CLI — `manus-heartbeat`

In-sandbox tool that hits the same backend as the SDK in §5a but with project owner identity (no end-user cookie). `BUILT_IN_FORGE_API_*` envs are pre-set on PATH; run from a sandbox terminal during this session.

The table below is just an index — `manus-heartbeat <cmd> --help` is canonical for full flag lists and examples.

| Command | What |
| --- | --- |
| `create` | Create a cron under the project owner identity (§4a). Returns `task_uid` — persist it. |
| `update` | Mutate a cron located by `--task-uid`. `--enable=false` pauses, `--enable=true` resumes; can also change cron expression / path / payload. |
| `delete` | Remove a cron located by `--task-uid`. |
| `list` | List crons. Default = owner's own; `--user-id u_xxx` inspects an end-user's (debugging §3 crons). |
| `logs` | Recent execution history for one task (`--task-uid`). Default last 20 runs, no body — `--with-body` for full responses, `--run-uid` for one specific run, `--status failed` to filter. |
| `bootstrap-legacy-project` | Legacy projects only. Drops `references/periodic-updates.md` and `server/_core/heartbeat.ts` into the project so the SDK in §5a becomes available. No-op when those files already exist. |
