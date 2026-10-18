import { getDb } from "../../repositories/dbClient";
import {
  SAIHU_REPORT_KIND,
  SaihuReportIdentitySchema,
  SaihuReportUuid,
} from "../../../shared/saihuReportSync";
import {
  saihuReportRepository,
  type SaihuReportLease,
} from "./saihuReportRepository";
import { createSaihuReportTransport } from "./saihuReportTransport";
import { collectSaihuReport } from "./saihuReportCoverage";
import { SaihuReportError } from "./saihuReportContract";
import { saihuReportRows } from "./saihuReportStore";

export function createSaihuReportCaptureExecution(
  deps: {
    repository?: typeof saihuReportRepository;
    transport?: typeof createSaihuReportTransport;
    enabled?: () => boolean;
  } = {}
) {
  const repository = deps.repository ?? saihuReportRepository,
    transport = deps.transport ?? createSaihuReportTransport,
    enabled =
      deps.enabled ??
      (() => process.env.ENABLE_SAIHU_REPORT_CAPTURE_WORKER === "true");
  return async function process(input: {
    identity: { userId: number; workspaceId: number };
    operationId: string;
    signal: AbortSignal;
  }) {
    if (!enabled() || input.signal.aborted) return;
    let lease: SaihuReportLease | null = null,
      completionAttempted = false,
      heartbeatError = false,
      heartbeat: Promise<void> = Promise.resolve();
    const controller = new AbortController(),
      signal = AbortSignal.any([input.signal, controller.signal]);
    let timer: ReturnType<typeof setInterval> | null = null;
    const stopHeartbeat = async () => {
      if (timer) clearInterval(timer);
      timer = null;
      await heartbeat;
    };
    try {
      lease = await repository.claim(input.identity, {
        expectedWorkspaceId: input.identity.workspaceId,
        operationId: input.operationId,
      });
      if (!lease || signal.aborted || !enabled()) return;
      const frozen = await repository.dispatch(lease),
        credentials = await repository.credentials(lease); // Only after the dispatch transaction ACK may any HTTP read start.
      timer = setInterval(() => {
        heartbeat = heartbeat.then(async () => {
          try {
            await repository.heartbeat(lease!);
          } catch {
            heartbeatError = true;
            controller.abort();
          }
        });
      }, 30000);
      const result = await collectSaihuReport(
        {
          version: 1,
          identity: input.identity,
          operationId: input.operationId,
          scope: frozen.request.scope,
          connectionVersion: frozen.connectionVersion,
          contractHash: frozen.contractHash,
          shops: frozen.contract.shops,
        },
        frozen.contract,
        transport(credentials, frozen.contract, signal, {
          beforeRead: async () => {
            if (!enabled() || signal.aborted)
              throw new SaihuReportError("CANCELLED");
            await repository.beforeRead(lease!);
          },
        }),
        signal
      );
      await stopHeartbeat();
      if (heartbeatError) return;
      // A completed read may still be saved after a stop/gate change; there is
      // no second provider call. The repository rechecks authority/lease/cancel.
      completionAttempted = true;
      await repository.finish(lease, result.source);
    } catch (error) {
      await stopHeartbeat();
      if (
        lease &&
        !completionAttempted &&
        !heartbeatError &&
        !signal.aborted &&
        enabled() &&
        error instanceof SaihuReportError
      ) {
        try {
          await repository.failure(lease, error.code);
        } catch {
          /* Unknown ACK: check the original UUID, never redispatch. */
        }
      }
    } finally {
      await stopHeartbeat();
    }
  };
}
export const processSaihuReportCapture = createSaihuReportCaptureExecution();
export async function drainSaihuReportCapture(
  pending: Promise<void> | null,
  milliseconds = 45000
) {
  if (!pending) return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending.then(() => true),
      new Promise<false>(resolve => {
        timer = setTimeout(() => resolve(false), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
/** This worker only executes explicit queued manual requests. It does NOT
 * create schedules, derive new periods, seed workspaces, or apply facts. */
export function startSaihuReportCaptureWorker(role: string) {
  if (
    !["worker", "all"].includes(role) ||
    process.env.ENABLE_SAIHU_REPORT_CAPTURE_WORKER !== "true"
  )
    return async () => undefined;
  let stopped = false,
    pending: Promise<void> | null = null;
  const controller = new AbortController();
  const tick = async () => {
    if (stopped || process.env.ENABLE_SAIHU_REPORT_CAPTURE_WORKER !== "true")
      return;
    const db = await getDb();
    if (!db) return;
    const hints = await saihuReportRows(
        db,
        "SELECT workspaceId,userId,JSON_UNQUOTE(JSON_EXTRACT(input,'$.operationId')) AS operationId FROM ai_jobs WHERE kind=? AND projectId IS NULL AND (status='queued' OR (status='running' AND leaseUntil<CURRENT_TIMESTAMP)) ORDER BY id LIMIT 20",
        [SAIHU_REPORT_KIND],
        20
      ),
      workspaces = new Set<number>();
    for (const hint of hints) {
      if (stopped) break;
      const identity = SaihuReportIdentitySchema.safeParse({
          workspaceId: hint.workspaceId,
          userId: hint.userId,
        }),
        operationId = SaihuReportUuid.safeParse(hint.operationId);
      if (
        !identity.success ||
        !operationId.success ||
        workspaces.has(identity.data.workspaceId)
      )
        continue;
      workspaces.add(identity.data.workspaceId);
      await processSaihuReportCapture({
        identity: identity.data,
        operationId: operationId.data,
        signal: controller.signal,
      });
    }
  };
  const run = () => {
    if (!pending)
      pending = tick()
        .catch(() => undefined)
        .finally(() => {
          pending = null;
        });
  };
  const timer = setInterval(run, 2000);
  run();
  return async () => {
    stopped = true;
    clearInterval(timer);
    controller.abort();
    if (!(await drainSaihuReportCapture(pending)))
      throw new SaihuReportError(
        "DRAIN_UNRESOLVED_CHECK_OR_CANCEL_SAME_OPERATION"
      );
  };
}
