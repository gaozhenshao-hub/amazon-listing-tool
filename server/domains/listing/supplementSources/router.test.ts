import { afterEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../../../_core/context";
import { router } from "../../../_core/trpc";
import {
  createListingSupplementSourcesRouter,
  listingSupplementSourcesRouter,
} from "./router";
import { createListingSupplementTransportService } from "./transportService";
import { createSupplementFixture } from "./testFixture";
import { SupplementSourceError } from "./protocol";
import {
  listingSupplementTransportInputHash,
  SupplementHistoryTransportSchema,
  SupplementDownloadDataSchema,
  SupplementOperationTransportSchema,
} from "../../../../shared/listingSupplementTransport";
import {
  supplementHash,
  type SupplementHistoryInput,
} from "../../../../shared/listingSupplementSources";

function setup() {
  const f = createSupplementFixture();
  // The production authorizer re-reads the actual role/member from SQL; this
  // intentionally elevated context must not grant a fixture policy bypass.
  const context = {
    ...f.context,
    user: { ...f.context.user, role: "super_admin", defaultWorkspaceId: 7 },
  } as TrpcContext;
  const service = createListingSupplementTransportService({
    service: f.service,
    repository: f.repository,
  });
  const surface = createListingSupplementSourcesRouter(service);
  const assembled = router({ listing: router({ supplementSources: surface }) });
  return {
    ...f,
    get state() {
      return f.state;
    },
    context,
    transport: service,
    surface,
    assembled,
    caller: assembled.createCaller(context).listing.supplementSources,
  };
}
afterEach(() => vi.restoreAllMocks());
describe("real protected listing supplement source router and service adapter", () => {
  it("constructs a real nested router with eleven explicit operations and no import-time I/O", () => {
    const f = setup();
    expect(Object.keys(listingSupplementSourcesRouter._def.procedures)).toEqual(
      [
        "capabilities",
        "preview",
        "save",
        "check",
        "complete",
        "cancel",
        "history",
        "download",
        "manifest",
        "deleteOriginal",
        "deleteRecord",
      ]
    );
    expect(Object.keys(f.assembled._def.procedures)).toContain(
      "listing.supplementSources.preview"
    );
    expect(f.surface._def.procedures.preview._def.type).toBe("mutation");
    expect(f.surface._def.procedures.save._def.type).toBe("mutation");
    expect(f.surface._def.procedures.download._def.type).toBe("query");
    expect(f.sqlCalls).toEqual([]);
    expect(f.puts).toEqual([]);
  });
  it("rejects anonymous calls before the typed service port", async () => {
    const f = setup(),
      spy = vi.spyOn(f.transport, "history");
    await expect(
      f.surface.createCaller({ ...f.context, user: null }).history(f.scope)
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(spy).not.toHaveBeenCalled();
    expect(f.sqlCalls).toEqual([]);
  });
  it.each([undefined, null, 0, 8])(
    "never falls back from actual workspace %s to user.defaultWorkspaceId",
    async workspaceId => {
      const f = setup();
      await expect(
        f.surface.createCaller({ ...f.context, workspaceId }).history(f.scope)
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: "LISTING_SUPPLEMENT_ACCESS_DENIED",
      });
      expect(f.sqlCalls).toEqual([]);
    }
  );
  it("strict inputs cannot inject actor, owner, authority, URL, key or config", async () => {
    const f = setup(),
      spy = vi.spyOn(f.transport, "preview");
    for (const extra of [
      { identity: { userId: 4, workspaceId: 7 } },
      { ownerUserId: 4 },
      { role: "super_admin" },
      { objectKey: "some/key" },
      { url: "https://arbitrary.example.test" },
      { configuration: { token: "synthetic" } },
    ]) {
      await expect(
        f.caller.preview({
          ...f.scope,
          kind: "reviews",
          original: f.file(),
          ...extra,
        } as never)
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect(spy).not.toHaveBeenCalled();
    expect(f.puts).toHaveLength(0);
  });
  it("capabilities uses fresh schema/member/project/file-read authorization and not ctx role", async () => {
    const f = setup();
    f.control.enabled = false;
    expect(await f.caller.capabilities(f.scope)).toMatchObject({
      identity: f.identity,
      scope: f.scope,
      input: f.scope,
      inputHash: listingSupplementTransportInputHash(
        "capabilities",
        f.identity,
        f.scope
      ),
      data: {
        sourceWritesEnabled: false,
        sourceOnly: true,
        sealedManifestVersion: 1,
      },
    });
    f.control.member = false;
    await expect(f.caller.capabilities(f.scope)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(f.puts).toHaveLength(0);
  });
  it("fails closed rather than reporting a usable capability when candidate tables are not admitted", async () => {
    const f = setup();
    f.control.badEngine = true;
    await expect(f.caller.capabilities(f.scope)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "LISTING_SUPPLEMENT_SCHEMA_UNAVAILABLE",
    });
    expect(f.puts).toHaveLength(0);
  });
  it("preview is a read-only POST and echoes metadata/full-input hash, not clipboard bytes", async () => {
    const f = setup();
    f.control.enabled = false;
    const input = {
      ...f.scope,
      kind: "attributes" as const,
      original: {
        originalType: "clipboard" as const,
        text: '[{"value":{"name":"Material","value":"steel"}}]',
        html: "<p data-original='exact'>Do not execute or rewrite</p>",
      },
    };
    const preview = await f.caller.preview(input);
    expect(preview.inputHash).toBe(
      listingSupplementTransportInputHash("preview", f.identity, input)
    );
    expect(preview.data.status).toBe("ready");
    expect(preview.data.records).toHaveLength(1);
    expect(preview.input.original).toEqual(preview.data.original);
    expect(preview.input.original).not.toHaveProperty("text");
    expect(preview.input.original).not.toHaveProperty("html");
    expect(f.puts).toHaveLength(0);
    expect(f.state.sources.size).toBe(0);
    expect(f.state.operations.size).toBe(0);
  });
  it("preserves a true unknown receipt and completes the original UUID without another PUT when gate closes", async () => {
    const f = setup(),
      input = await f.input();
    f.control.putUnknown = true;
    const started = await f.caller.save(input);
    expect(started.data.status).toBe("unknown");
    expect(started.inputHash).toBe(
      listingSupplementTransportInputHash("save", f.identity, input)
    );
    expect(started.input.original).not.toHaveProperty("base64");
    const op = { ...f.scope, operationId: input.operationId };
    const checked = await f.caller.check(op);
    expect(checked.data).toEqual(started.data);
    expect(checked.inputHash).toBe(
      listingSupplementTransportInputHash("check", f.identity, op)
    );
    f.control.enabled = false;
    const complete = await f.caller.complete(op);
    expect(complete.data.status).toBe("committed");
    expect(complete.data.sourceId).toBe(input.operationId);
    expect(complete.input).toEqual(op);
    expect(f.puts).toHaveLength(1);
    expect(await f.caller.check(op)).toMatchObject({ data: complete.data });
  });
  it("durably fences a cancelled original UUID and allows check/cancel while writes are disabled", async () => {
    const f = setup(),
      input = await f.input();
    const op = { ...f.scope, operationId: input.operationId };
    f.control.enabled = false;
    expect(await f.caller.cancel(op)).toMatchObject({
      data: { status: "cancelled" },
    });
    expect(await f.caller.complete(op)).toMatchObject({
      data: { status: "cancelled" },
    });
    f.control.enabled = true;
    expect(await f.caller.save(input)).toMatchObject({
      data: { status: "cancelled" },
    });
    expect(f.puts).toHaveLength(0);
  });
  it("new writes obey the actual flag and fresh source assignment revisions", async () => {
    const f = setup(),
      input = await f.input();
    f.control.enabled = false;
    await expect(f.caller.save(input)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "LISTING_SUPPLEMENT_WRITES_DISABLED",
    });
    f.control.enabled = true;
    f.state.analyses[0].title = "Changed after preview";
    await expect(f.caller.save(input)).rejects.toMatchObject({
      code: "CONFLICT",
      message: "LISTING_SUPPLEMENT_PREVIEW_CHANGED",
    });
    expect(f.puts).toHaveLength(0);
  });
  it("history pages echo the exact limit/cursor and include every independently saved source", async () => {
    const f = setup();
    for (let n = 1; n <= 3; n++) await f.caller.save(await f.input(n));
    const first = await f.caller.history({ ...f.scope, limit: 2 });
    expect(first.input).toEqual({ ...f.scope, limit: 2, cursor: null });
    expect(first.data.items).toHaveLength(2);
    expect(first.data.items[0].sourceId).toBe(f.operationId(3));
    const next: SupplementHistoryInput = {
      ...f.scope,
      limit: 2,
      cursor: first.data.nextCursor,
    };
    const second = await f.caller.history(next);
    expect(second.inputHash).toBe(
      listingSupplementTransportInputHash("history", f.identity, next)
    );
    expect(second.data.items.map(item => item.sourceId)).toEqual([
      f.operationId(1),
    ]);
    expect(second.data.nextCursor).toBeNull();
    expect(JSON.stringify(first)).not.toMatch(
      /objectKey|storageUri|base64|private-bucket/u
    );
  });
  it("download returns exact verified bytes and source identity without storage addresses", async () => {
    const f = setup(),
      input = await f.input();
    await f.caller.save(input);
    const source = { ...f.scope, sourceId: input.operationId };
    const response = await f.caller.download(source);
    expect(response.sourceId).toBe(input.operationId);
    expect(response.input).toEqual(source);
    expect(response.inputHash).toBe(
      listingSupplementTransportInputHash("download", f.identity, source)
    );
    expect(response.data.base64).toBe(input.original.base64);
    expect(JSON.stringify(response)).not.toMatch(
      /objectKey|storageUri|signedUrl|private-bucket|accessKey/u
    );
    const manifest = await f.caller.manifest(source);
    expect(manifest.data.sourceId).toBe(source.sourceId);
    expect(manifest.data.records).toHaveLength(1);
    expect(f.state.analyses[0].title).toBe("Synthetic competitor");
  });
  it("fresh file-export revocation after object I/O prevents a late download", async () => {
    const f = setup(),
      input = await f.input();
    await f.caller.save(input);
    f.control.onRead = () => {
      f.control.denyExport = true;
    };
    await expect(
      f.caller.download({ ...f.scope, sourceId: input.operationId })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "LISTING_SUPPLEMENT_ACCESS_DENIED",
    });
  });
  it("deleteOriginal and deleteRecord are separate explicit operations retaining immutable normalized data", async () => {
    const f = setup(),
      input = await f.input(),
      saved = await f.caller.save(input);
    const source = { ...f.scope, sourceId: input.operationId };
    const remove = {
      ...source,
      operationId: f.operationId(2),
      expectedManifestHash: saved.data.manifestHash!,
      confirmPreserveImportedData: true as const,
    };
    const original = await f.caller.deleteOriginal(remove);
    expect(original.data).toMatchObject({
      status: "committed",
      action: "delete_original",
      originalState: "deleted",
      recordState: "visible",
    });
    expect(await f.caller.history(f.scope)).toMatchObject({
      data: { items: [{ originalState: "deleted" }] },
    });
    expect((await f.caller.manifest(source)).data.records).toHaveLength(1);
    const record = await f.caller.deleteRecord({
      ...remove,
      operationId: f.operationId(3),
    });
    expect(record.data).toMatchObject({
      status: "committed",
      action: "delete_record",
      recordState: "deleted",
    });
    expect((await f.caller.history(f.scope)).data.items).toHaveLength(0);
    expect((await f.caller.manifest(source)).data.records).toHaveLength(1);
    expect(f.deletes).toHaveLength(1);
    expect(f.state.analyses).toHaveLength(1);
  });
  it("DELETE outcome unknown keeps the same receipt and never silently re-deletes", async () => {
    const f = setup(),
      input = await f.input(),
      saved = await f.caller.save(input);
    const request = {
      ...f.scope,
      sourceId: input.operationId,
      operationId: f.operationId(2),
      expectedManifestHash: saved.data.manifestHash!,
      confirmPreserveImportedData: true as const,
    };
    f.control.deleteUnknown = true;
    expect(await f.caller.deleteOriginal(request)).toMatchObject({
      data: { status: "unknown" },
    });
    const op = { ...f.scope, operationId: request.operationId };
    expect(await f.caller.cancel(op)).toMatchObject({
      data: {
        status: "unknown",
        reasonCode: "DELETE_ALREADY_DISPATCHED_CHECK_SAME_UUID",
      },
    });
    f.control.enabled = false;
    expect(await f.caller.complete(op)).toMatchObject({
      data: { status: "committed", action: "delete_original" },
    });
    expect(f.deletes).toHaveLength(1);
  });
  it("rejects wrong project or actor recovery even if the UUID is known", async () => {
    const f = setup(),
      input = await f.input();
    await f.caller.save(input);
    await expect(
      f.caller.check({
        ...f.scope,
        projectId: 12,
        operationId: input.operationId,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      f.surface
        .createCaller({ ...f.context, user: { ...f.context.user!, id: 4 } })
        .check({ ...f.scope, operationId: input.operationId })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.puts).toHaveLength(1);
  });
  it("sanitizes unrecognized domain/provider errors instead of exposing keys or configuration", async () => {
    const f = setup();
    vi.spyOn(f.service, "history").mockRejectedValueOnce(
      new Error("storage://s3/private/key?token=secret")
    );
    await expect(f.caller.history(f.scope)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "LISTING_SUPPLEMENT_UNAVAILABLE",
    });
    vi.spyOn(f.service, "history").mockRejectedValueOnce(
      new SupplementSourceError("PRIVATE_BUCKET_SECRET")
    );
    await expect(f.caller.history(f.scope)).rejects.toMatchObject({
      message: "LISTING_SUPPLEMENT_UNAVAILABLE",
    });
  });
  it("validates the inner service response identity and strict output before sending it", async () => {
    const f = setup();
    const result = await f.service.history(f.context, f.scope);
    vi.spyOn(f.service, "history").mockResolvedValueOnce({
      ...result,
      identity: { userId: 4, workspaceId: 7 },
    });
    await expect(f.caller.history(f.scope)).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "系统内部错误",
      cause: {
        retryable: false,
        expose: false,
        details: {
          domain: "listing_supplement_sources",
          reasonCode: "RESPONSE_INVALID",
        },
      },
    });
    vi.spyOn(f.service, "history").mockResolvedValueOnce({
      ...result,
      objectKey: "private",
    } as never);
    await expect(f.caller.history(f.scope)).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });
  it("rejects plausible but wrong download digest and noncanonical base64", async () => {
    const f = setup();
    const response = {
      fileName: "source.csv",
      contentType: "text/csv" as const,
      byteSize: 1,
      contentHash: "a".repeat(64),
      base64: "YQ==",
    };
    vi.spyOn(f.service, "download").mockResolvedValueOnce(response);
    await expect(
      f.caller.download({ ...f.scope, sourceId: f.operationId() })
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(
      SupplementDownloadDataSchema.safeParse({ ...response, base64: "YR==" })
        .success
    ).toBe(false);
    expect(
      SupplementDownloadDataSchema.safeParse({ ...response, base64: "YQ=\n" })
        .success
    ).toBe(false);
  });
  it("rejects service history pages with wrong order, missing echo, duplicates or a forged next cursor", async () => {
    const f = setup();
    await f.caller.save(await f.input(1));
    await f.caller.save(await f.input(2));
    const response = await f.caller.history({ ...f.scope, limit: 2 });
    expect(SupplementHistoryTransportSchema.safeParse(response).success).toBe(
      true
    );
    const data = {
      ...response.data,
      items: [...response.data.items].reverse(),
    };
    expect(
      SupplementHistoryTransportSchema.safeParse({ ...response, data }).success
    ).toBe(false);
    expect(
      SupplementHistoryTransportSchema.safeParse({
        ...response,
        input: f.scope,
      }).success
    ).toBe(false);
    expect(
      SupplementHistoryTransportSchema.safeParse({
        ...response,
        data: {
          ...response.data,
          nextCursor: {
            createdAt: response.data.items[0].createdAt,
            sourceId: f.operationId(9),
          },
        },
      }).success
    ).toBe(false);
    expect(
      SupplementHistoryTransportSchema.safeParse({
        ...response,
        data: {
          ...response.data,
          items: [response.data.items[0], response.data.items[0]],
        },
      }).success
    ).toBe(false);
  });
  it("full-input hashes bind untouched clipboard representations and distinguish recovery methods", () => {
    const f = setup();
    const input = {
      ...f.scope,
      kind: "attributes",
      original: {
        originalType: "clipboard",
        text: "[]",
        html: "<b>original</b>",
      },
    };
    expect(
      listingSupplementTransportInputHash("preview", f.identity, input)
    ).not.toBe(
      listingSupplementTransportInputHash("preview", f.identity, {
        ...input,
        original: { ...input.original, html: "<b>changed</b>" },
      })
    );
    const op = { ...f.scope, operationId: f.operationId() };
    expect(
      listingSupplementTransportInputHash("check", f.identity, op)
    ).not.toBe(listingSupplementTransportInputHash("complete", f.identity, op));
    expect(
      listingSupplementTransportInputHash("history", f.identity, f.scope)
    ).toBe(
      listingSupplementTransportInputHash("history", f.identity, {
        ...f.scope,
        limit: 30,
        cursor: null,
      })
    );
  });
  it("receipt transport cannot relabel a different original UUID or workspace as the request", async () => {
    const f = setup(),
      op = { ...f.scope, operationId: f.operationId() };
    const response = await f.caller.check(op);
    expect(
      SupplementOperationTransportSchema.safeParse({
        ...response,
        data: {
          ...response.data,
          scope: { ...op, operationId: f.operationId(2) },
        },
      }).success
    ).toBe(false);
    expect(
      SupplementOperationTransportSchema.safeParse({
        ...response,
        identity: { userId: 3, workspaceId: 8 },
      }).success
    ).toBe(false);
    expect(response.inputHash).not.toBe(supplementHash(response.input));
  });
});
