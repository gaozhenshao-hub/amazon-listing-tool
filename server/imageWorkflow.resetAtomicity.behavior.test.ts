import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(), requireDb: vi.fn(), project: vi.fn(), session: vi.fn(),
  write: vi.fn(), agent: vi.fn(),
}));
vi.mock("./repositories/dbClient", async importOriginal => ({
  ...await importOriginal<typeof import("./repositories/dbClient")>(),
  getDb: mocks.getDb, requireDb: mocks.requireDb,
}));
vi.mock("./domains/image/routerContext", async importOriginal => ({
  ...await importOriginal<typeof import("./domains/image/routerContext")>(),
  resolveProjectAccess: mocks.project, resolveSessionAccess: mocks.session,
  ensureWriteAccess: mocks.write,
}));
vi.mock("./domains/image/imageWorkflowAgentBridge", async importOriginal => ({
  ...await importOriginal<typeof import("./domains/image/imageWorkflowAgentBridge")>(),
  syncStepUnlockToAgent: mocks.agent,
}));

import { router } from "./_core/trpc";
import { imageSessionProcedures } from "./domains/image/routers/sessions";

type Row = Record<string, any>;
type State = Record<string, Row[]>;
const scope = { workspaceId: 7, projectId: 51, sessionId: 23 };
const names = {
  sessions: "image_workflow_sessions", projects: "projects", groups: "expression_groups",
  selections: "image_expression_selection_versions", links: "image_expression_asset_links",
  analyses: "image_expression_analysis_versions", syntheses: "image_step0_synthesis_versions",
  artifacts: "image_workflow_step0_artifacts", step4: "image_workflow_step4_image_versions",
  scopes: "image_workflow_version_scopes", snapshots: "image_workflow_stage_snapshots",
  events: "image_workflow_snapshot_state_events",
} as const;
const linkageTables = [names.selections, names.links, names.analyses, names.syntheses, names.artifacts];
const dialect = new MySqlDialect();

function initialState(): State {
  const session: Row = { id: 23, projectId: 51, userId: 17, currentStep: 6, status: "completed", agentRunId: "synthetic-agent" };
  for (let step = 0; step <= 6; step++) Object.assign(session, {
    [`step${step}AiResult`]: `ai-${step}`, [`step${step}UserEdit`]: `human-${step}`, [`step${step}Confirmed`]: 1,
  });
  const state: State = {
    [names.sessions]: [session, { ...session, id: 24, projectId: 52 }],
    [names.projects]: [{ id: 51, workspaceId: 7 }, { id: 52, workspaceId: 8 }],
    [names.groups]: [{ id: 11, projectId: 51, sortOrder: 0 }, { id: 12, projectId: 51, sortOrder: 1 }, { id: 13, projectId: 52, sortOrder: 0 }],
    expression_group_images: [],
    [names.links]: [{ id: 10, workspaceId: 7, projectId: 51, selectionVersionId: 1, groupId: 11, acquisitionAssetId: 101, evidence: { immutable: true } }],
    [names.artifacts]: ["expression_summary", "composite", "competitor_gallery"].map((artifactType, index) => ({
      id: index + 1, ...scope, artifactType, status: "confirmed", content: { artifactType }, evidenceRefs: [101],
    })),
    [names.step4]: [{ id: 1, sessionId: 23, isCurrent: 1, status: "confirmed", content: "immutable-version" }, { id: 2, sessionId: 24, isCurrent: 1, status: "confirmed" }],
    [names.scopes]: [{ id: 1, ...scope, revision: 4 }],
    [names.snapshots]: Array.from({ length: 7 }, (_, step) => ({
      id: step + 1, ...scope, step, version: 1, contentJson: { step, human: true }, contentRevision: 1,
      contentOrigin: "human_confirmed", contentDigest: `content-${step}`, assetDependenciesJson: [],
      assetDependencyDigest: `asset-${step}`, dependenciesJson: [], dependencyDigest: `dependency-${step}`,
      snapshotDigest: `digest-${step}`, confirmedBy: 17, confirmedAt: new Date("2026-10-01T00:00:00.000Z"),
    })),
    [names.events]: Array.from({ length: 7 }, (_, step) => ({ id: step + 1, ...scope, snapshotDigest: `digest-${step}`, state: "confirmed", reason: "snapshot_replaced", actorId: 17 })),
  };
  for (const table of [names.selections, names.analyses, names.syntheses]) state[table] = [
    { id: 1, ...scope, groupId: 11, status: "confirmed", payload: { original: table } },
    { id: 2, ...scope, groupId: 12, sessionId: 99, status: "draft", payload: { projectWide: true } },
    { id: 3, ...scope, groupId: 11, workspaceId: 8, status: "confirmed", payload: { foreignWorkspace: true } },
    { id: 4, ...scope, groupId: 13, projectId: 52, status: "confirmed", payload: { foreignProject: true } },
    { id: 5, ...scope, groupId: 11, status: "superseded", payload: { historic: true } },
  ];
  state[names.artifacts].push({ id: 9, ...scope, workspaceId: 8, artifactType: "composite", status: "confirmed", content: { foreign: true } });
  state[names.artifacts].push({ id: 10, ...scope, projectId: 52, artifactType: "expression_summary", status: "confirmed", content: { foreignProject: true } });
  state[names.artifacts].push({ id: 11, ...scope, artifactType: "composite", status: "draft", content: { unconfirmed: true } });
  return state;
}

/** Controlled transaction model, not a MySQL emulator or AUTO_INCREMENT proof.
 * Real route, invalidation adapter and linkage SQL builders run unchanged.
 * Only the Drizzle executor and external access/agent boundaries are replaced.
 * Unknown SQL fails closed; row mutations publish only on callback success.
 */
function controlledDatabase(fault?: string) {
  let state = initialState();
  let transactions = 0;
  const trace: string[] = [];
  const txTokens: object[] = [];
  function failAt(point: string) {
    trace.push(point);
    if (fault === point) throw new Error(`synthetic failure: ${point}`);
  }
  function matches(condition: SQL, table: string, row: Row, working: State) {
    const query = dialect.sqlToQuery(condition);
    let index = 0;
    let matched = true;
    const remainder = query.sql.replace(/`([^`]+)`\.`([^`]+)`\s*(=|!=|<>)\s*\?/g, (_all, owner, field, operation) => {
      const value = owner === table ? row[field] : owner === names.projects
        ? working[names.projects].find(project => project.id === row.projectId)?.[field]
        : (() => { throw new Error(`Unexpected predicate owner ${owner}`); })();
      const expected = query.params[index++];
      matched &&= operation === "=" ? value === expected : value !== expected;
      return "";
    }).replace(/\band\b|[\s()]/g, "");
    expect(remainder).toBe("");
    expect(index).toBe(query.params.length);
    return matched;
  }
  function executor(working: State, inTransaction: boolean): any {
    const token = {};
    const record = (point: string) => { txTokens.push(inTransaction ? token : { outside: true }); failAt(point); };
    return {
      select(fields?: Record<string, { name: string }>) {
        let table: string;
        let condition: SQL | undefined;
        let locked = false;
        const chain: any = {
          from(value: any) { table = getTableName(value); return chain; },
          innerJoin() { return chain; },
          where(value: SQL) { condition = value; return chain; },
          limit() { return chain; }, orderBy() { return chain; },
          for(value: string) { expect(value).toBe("update"); locked = true; return chain; },
          then(resolve: any, reject: any) {
            return Promise.resolve().then(() => {
              record(table === names.sessions && locked ? "lock-scope" : `select:${table}`);
              const rows = working[table];
              if (!rows) throw new Error(`Unexpected table ${table}`);
              return rows.filter(row => !condition || matches(condition, table, row, working)).map(row => fields
                ? Object.fromEntries(Object.entries(fields).map(([alias, column]) => [alias, row[column.name]]))
                : structuredClone(row));
            }).then(resolve, reject);
          },
        };
        return chain;
      },
      update(value: any) {
        const table = getTableName(value);
        return { set(patch: Row) { return { async where(condition: SQL) {
          const rows = working[table].filter(row => matches(condition, table, row, working));
          const point = table === names.artifacts ? `write:${table}:${rows[0]?.artifactType}`
            : table === names.selections || table === names.analyses ? `write:${table}:${rows[0]?.groupId}` : `write:${table}`;
          for (const row of rows) Object.assign(row, structuredClone(patch));
          record(point); // Inject after mutation to exercise rollback, not just early refusal.
          return [{ affectedRows: fault === "legacy-zero" && table === names.sessions ? 0 : rows.length }];
        } }; } };
      },
      async execute(statement: SQL) {
        const { sql: raw, params } = dialect.sqlToQuery(statement);
        const sql = raw.replace(/\s+/g, " ").trim();
        if (sql.startsWith("INSERT INTO image_workflow_version_scopes ")) {
          record("scope-insert");
          if (fault === "missing-scopes") throw new Error("Table image_workflow_version_scopes doesn't exist");
          expect(params).toEqual([7, 51, 23]);
          return [{ affectedRows: 0 }];
        }
        if (sql.startsWith("SELECT revision FROM image_workflow_version_scopes ")) {
          record("revision-lock"); expect(sql).toContain("FOR UPDATE");
          expect(params).toEqual([7, 51, 23]);
          return [[{ revision: working[names.scopes][0].revision }]];
        }
        if (sql.startsWith("SELECT s.workspaceId, s.projectId, s.sessionId")) {
          record("snapshots-read");
          if (fault === "missing-snapshots") throw new Error("Table image_workflow_stage_snapshots doesn't exist");
          if (fault === "missing-events") throw new Error("Table image_workflow_snapshot_state_events doesn't exist");
          expect(params).toEqual([7, 51, 23, 7, 51, 23]);
          return [working[names.snapshots].map(row => ({ ...structuredClone(row), state: working[names.events].filter(event => event.snapshotDigest === row.snapshotDigest).at(-1)?.state }))];
        }
        if (sql.startsWith("UPDATE image_workflow_version_scopes SET revision = revision + 1")) {
          record("scope-cas"); expect(params).toEqual([7, 51, 23, working[names.scopes][0].revision]);
          if (fault === "cas-zero") return [{ affectedRows: 0 }];
          working[names.scopes][0].revision++;
          return [{ affectedRows: 1 }];
        }
        if (sql.startsWith("INSERT INTO image_workflow_snapshot_state_events ")) {
          record("event-append");
          expect(params.slice(5)).toEqual([7, 51, 23, params[0]]);
          working[names.events].push({ id: working[names.events].length + 1, ...scope, snapshotDigest: params[0], state: params[1], reason: params[2], actorId: params[3], occurredAt: params[4] });
          failAt("event-after-write");
          return [{ affectedRows: 1 }];
        }
        throw new Error(`Unexpected controlled SQL: ${sql}`);
      },
    };
  }
  const db: any = executor(state, false);
  db.transaction = async (callback: (tx: any) => Promise<unknown>) => {
    transactions++;
    trace.push("begin");
    const working = structuredClone(state);
    try {
      const result = await callback(executor(working, true));
      state = working;
      trace.push("commit");
      return result;
    } catch (error) { trace.push("rollback"); throw error; }
  };
  return { db, trace, txTokens, snapshot: () => structuredClone(state), transactions: () => transactions,
    foreignScope: () => { state[names.projects][0].workspaceId = 8; } };
}

const callerFactory = router({ resetToStep: imageSessionProcedures.resetToStep });
const context = { user: { id: 17, role: "super_admin" }, workspaceId: 7, req: { headers: {} }, res: {} } as TrpcContext;

function arrange(fault?: string) {
  const database = controlledDatabase(fault);
  mocks.getDb.mockResolvedValue(database.db);
  mocks.requireDb.mockResolvedValue(database.db);
  mocks.project.mockResolvedValue({ id: 51, workspaceId: 7, userId: 17 });
  mocks.session.mockResolvedValue(database.snapshot()[names.sessions][0]);
  mocks.agent.mockImplementation(async () => { expect(database.trace.at(-1)).toBe("commit"); });
  return { database, caller: callerFactory.createCaller(context) };
}

describe("resetToStep atomic linkage + version invalidation", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it.each([
    "missing-scopes", "missing-snapshots", "missing-events", "cas-zero", "event-after-write", "legacy-zero",
    `select:${names.groups}`, `write:${names.sessions}`, `write:${names.step4}`,
    `write:${names.selections}:11`, `write:${names.selections}:12`,
    `write:${names.analyses}:11`, `write:${names.analyses}:12`,
    `write:${names.syntheses}`, `write:${names.artifacts}:expression_summary`, `write:${names.artifacts}:composite`,
  ])("rolls back every complete row on %s (no partial linkage commit)", async fault => {
    const { database, caller } = arrange(fault);
    const before = database.snapshot();
    await expect(caller.resetToStep({ projectId: 51, step: 0 })).rejects.toBeDefined();
    const injectedPoint = ({ "missing-scopes": "scope-insert", "missing-snapshots": "snapshots-read",
      "missing-events": "snapshots-read", "cas-zero": "scope-cas", "legacy-zero": `write:${names.sessions}` } as Record<string, string>)[fault] ?? fault;
    expect(database.trace).toContain(injectedPoint);
    expect(database.snapshot()).toEqual(before);
    expect(database.transactions()).toBe(1);
    expect(database.trace).not.toContain("commit");
    expect(mocks.agent).not.toHaveBeenCalled();
  });

  it("fails closed without a real transaction implementation, before any row changes", async () => {
    const { database, caller } = arrange();
    delete database.db.transaction;
    const before = database.snapshot();
    await expect(caller.resetToStep({ projectId: 51, step: 0 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(database.snapshot()).toEqual(before);
    expect(database.trace).toEqual([]);
    expect(mocks.agent).not.toHaveBeenCalled();
  });

  it("rechecks the actual workspace/project/session inside the lock, with no linkage writes on refusal", async () => {
    const { database, caller } = arrange();
    database.foreignScope();
    const before = database.snapshot();
    await expect(caller.resetToStep({ projectId: 51, step: 0 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(database.snapshot()).toEqual(before);
    expect(database.trace).toEqual(["begin", "lock-scope", "rollback"]);
    expect(mocks.agent).not.toHaveBeenCalled();
  });

  it("commits all reset rows once after scope CAS, preserving immutable links, snapshots and foreign rows", async () => {
    const { database, caller } = arrange();
    const before = database.snapshot();
    await expect(caller.resetToStep({ projectId: 51, step: 0 })).resolves.toEqual({ success: true });
    const after = database.snapshot();
    expect(database.transactions()).toBe(1);
    expect(new Set(database.txTokens).size).toBe(1);
    expect(database.trace.indexOf(`select:${names.groups}`)).toBeGreaterThan(database.trace.indexOf("scope-cas"));
    expect(database.trace.indexOf("event-append")).toBeGreaterThan(database.trace.indexOf(`write:${names.artifacts}:composite`));
    expect(mocks.requireDb).not.toHaveBeenCalled();
    for (const table of [names.selections, names.analyses, names.syntheses]) {
      expect(after[table]).toEqual(before[table].map(row => row.workspaceId === 7 && row.projectId === 51 && row.status !== "superseded" ? { ...row, status: "superseded" } : row));
    }
    expect(after[names.links]).toEqual(before[names.links]);
    expect(after[names.snapshots]).toEqual(before[names.snapshots]);
    expect(after[names.artifacts]).toEqual(before[names.artifacts].map(row => row.workspaceId === 7 && row.projectId === 51 && row.status === "confirmed" && ["expression_summary", "composite"].includes(row.artifactType) ? { ...row, status: "superseded" } : row));
    expect(after[names.scopes]).toEqual([{ ...before[names.scopes][0], revision: 5 }]);
    expect(after[names.events].slice(0, 7)).toEqual(before[names.events]);
    expect(after[names.events].slice(7).map(row => [row.snapshotDigest, row.state])).toEqual(Array.from({ length: 7 }, (_, step) => [`digest-${step}`, "invalidated"]));
    expect(after[names.sessions][1]).toEqual(before[names.sessions][1]);
    expect(after[names.sessions][0]).toMatchObject({ currentStep: 0, status: "in_progress", step0AiResult: null, step0UserEdit: null, step0Confirmed: 0, step6Confirmed: 0 });
    expect(after[names.step4]).toEqual([{ ...before[names.step4][0], isCurrent: 0, status: "unlocked" }, before[names.step4][1]]);
    expect(mocks.agent).toHaveBeenCalledOnce();
  });

  it.each([1, 6])("step %i does not read or mutate any linkage table", async step => {
    const { database, caller } = arrange();
    const before = database.snapshot();
    await expect(caller.resetToStep({ projectId: 51, step })).resolves.toEqual({ success: true });
    for (const table of linkageTables) expect(database.snapshot()[table]).toEqual(before[table]);
    expect(database.trace).not.toContain(`select:${names.groups}`);
    expect(database.transactions()).toBe(1);
    expect(mocks.requireDb).not.toHaveBeenCalled();
    expect(mocks.agent).toHaveBeenCalledOnce();
  });
});
