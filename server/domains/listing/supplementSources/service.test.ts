import { describe, expect, it } from "vitest";
import { createSupplementFixture } from "./testFixture";
import { supplementOperationKey } from "./protocol";
import {
  supplementHash,
  type SupplementSaveInput,
} from "../../../../shared/listingSupplementSources";

describe("independent private supplemental original foundation: actual SQL service", () => {
  it("mount-equivalent preview is read-only; one save preserves exact bytes and immutable typed manifest", async () => {
    const f = createSupplementFixture(),
      input = await f.input();
    expect(f.puts).toHaveLength(0);
    expect(f.state.sources.size).toBe(0);
    const receipt = await f.service.save(f.context, input);
    expect(receipt).toMatchObject({
      status: "committed",
      action: "save",
      sourceId: input.operationId,
    });
    expect(f.puts).toHaveLength(1);
    expect(f.puts[0].maxAttempts).toBe(1);
    const manifest = await f.service.manifest(f.context, {
      ...f.scope,
      sourceId: input.operationId,
    });
    expect(manifest.records[0]).toMatchObject({
      source: {
        kind: "reviews",
        value: { body: "Exact synthetic review", rating: 5 },
      },
      target: { type: "competitor", analysisId: 21 },
    });
    const download = await f.service.download(f.context, {
      ...f.scope,
      sourceId: input.operationId,
    });
    expect(
      Buffer.from(download.base64, "base64").equals(
        Buffer.from(input.original.base64, "base64")
      )
    ).toBe(true);
    expect(JSON.stringify(receipt)).not.toMatch(
      /objectKey|Exact synthetic review|base64|storage:\/\//u
    );
    expect(
      [...f.state.audits.values()].every(
        row =>
          !/Exact synthetic review|base64|storage:\/\//u.test(
            String(row.metadata)
          )
      )
    ).toBe(true);
  });
  it("same UUID is idempotent and changed bytes/decisions cannot replace it", async () => {
    const f = createSupplementFixture(),
      input = await f.input(),
      first = await f.service.save(f.context, input);
    expect(await f.service.save(f.context, input)).toEqual(first);
    expect(f.puts).toHaveLength(1);
    await expect(
      f.service.save(f.context, {
        ...input,
        original: f.file("asin,body\nB000000021,Changed\n"),
      })
    ).rejects.toMatchObject({ code: "UUID_REQUEST_CONFLICT" });
    expect(f.state.manifests.size).toBe(1);
  });
  it("another tab/new UUID cannot blindly re-PUT the same pending original", async () => {
    const f = createSupplementFixture(),
      first = await f.input(1);
    f.control.putUnknown = true;
    expect(await f.service.save(f.context, first)).toMatchObject({
      status: "unknown",
    });
    const second = await f.input(2);
    await expect(f.service.save(f.context, second)).rejects.toMatchObject({
      code: "ORIGINAL_OPERATION_PENDING_CHECK_SAME_UUID",
    });
    expect(f.puts).toHaveLength(1);
    await f.service.cancel(f.context, {
      ...f.scope,
      operationId: first.operationId,
    });
    f.control.putUnknown = false;
    expect(await f.service.save(f.context, second)).toMatchObject({
      status: "committed",
    });
    expect(f.puts).toHaveLength(2);
  });
  it("PUT result unknown is recovered by original UUID GET only, even with new writes disabled", async () => {
    const f = createSupplementFixture(),
      input = await f.input();
    f.control.putUnknown = true;
    expect(await f.service.save(f.context, input)).toMatchObject({
      status: "unknown",
    });
    expect(f.puts).toHaveLength(1);
    expect(
      await f.service.check(f.context, {
        ...f.scope,
        operationId: input.operationId,
      })
    ).toMatchObject({ status: "unknown" });
    expect(await f.service.save(f.context, input)).toMatchObject({
      status: "unknown",
    });
    expect(f.puts).toHaveLength(1);
    f.control.enabled = false;
    expect(
      await f.service.complete(f.context, {
        ...f.scope,
        operationId: input.operationId,
      })
    ).toMatchObject({ status: "committed" });
    expect(f.puts).toHaveLength(1);
  });
  it.each(["prepare", "dispatch", "complete"] as const)(
    "lost %s ACK cannot repeat PUT or overwrite an old receipt",
    async phase => {
      const f = createSupplementFixture(),
        input = await f.input();
      f.control.commitAckLost = phase;
      expect(await f.service.save(f.context, input)).toMatchObject({
        status: "unknown",
      });
      const expectedPuts = phase === "complete" ? 1 : 0;
      expect(f.puts).toHaveLength(expectedPuts);
      const checked = await f.service.check(f.context, {
        ...f.scope,
        operationId: input.operationId,
      });
      expect(checked.status).toBe(
        phase === "complete" ? "committed" : "unknown"
      );
      await f.service.save(f.context, input);
      expect(f.puts).toHaveLength(expectedPuts);
    }
  );
  it("cancel is durable, gates late completion, and a missing UUID can be fenced before a save", async () => {
    const f = createSupplementFixture(),
      input = await f.input();
    f.control.putUnknown = true;
    await f.service.save(f.context, input);
    f.control.enabled = false;
    expect(
      await f.service.cancel(f.context, {
        ...f.scope,
        operationId: input.operationId,
      })
    ).toMatchObject({ status: "cancelled" });
    expect(
      await f.service.complete(f.context, {
        ...f.scope,
        operationId: input.operationId,
      })
    ).toMatchObject({ status: "cancelled" });
    expect(f.state.manifests.size).toBe(0);
    const other = await f.input(2);
    await f.service.cancel(f.context, {
      ...f.scope,
      operationId: other.operationId,
    });
    f.control.enabled = true;
    expect(await f.service.save(f.context, other)).toMatchObject({
      status: "cancelled",
    });
    expect(f.puts).toHaveLength(1);
  });
  it.each([
    "badEngine",
    "badColumn",
    "badIndex",
    "trigger",
    "foreignKey",
  ] as const)("complete physical %s admission precedes all PUT", async flag => {
    const f = createSupplementFixture(),
      input = await f.input();
    f.control[flag] = true;
    await expect(f.service.save(f.context, input)).rejects.toMatchObject({
      code: "SCHEMA_UNAVAILABLE",
    });
    expect(f.puts).toHaveLength(0);
    expect(f.state.sources.size).toBe(0);
  });
  it.each(["allowed", "member", "actor"] as const)(
    "fresh %s removal blocks read, recovery, cancel and download",
    async flag => {
      const f = createSupplementFixture(),
        input = await f.input();
      await f.service.save(f.context, input);
      f.control[flag] = false;
      await expect(
        f.service.check(f.context, {
          ...f.scope,
          operationId: input.operationId,
        })
      ).rejects.toMatchObject({ code: "ACCESS_DENIED" });
      await expect(
        f.service.download(f.context, {
          ...f.scope,
          sourceId: input.operationId,
        })
      ).rejects.toMatchObject({ code: "ACCESS_DENIED" });
      await expect(
        f.service.cancel(f.context, {
          ...f.scope,
          operationId: input.operationId,
        })
      ).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    }
  );
  it("cross workspace/project/actor and reused UUID scope cannot read or mutate another source", async () => {
    const f = createSupplementFixture(),
      input = await f.input();
    await f.service.save(f.context, input);
    await expect(
      f.service.history(
        { user: { id: 3 }, workspaceId: 8 },
        { ...f.scope, expectedWorkspaceId: 7 }
      )
    ).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    await expect(
      f.service.check(f.context, {
        ...f.scope,
        projectId: 12,
        operationId: input.operationId,
      })
    ).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    await expect(
      f.repository.downloadable(
        { userId: 4, workspaceId: 7 },
        { ...f.scope, sourceId: input.operationId }
      )
    ).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    expect(f.puts).toHaveLength(1);
  });
  it("explicit complete assignment and source CAS are required, not filename or guessed brand", async () => {
    const f = createSupplementFixture(),
      input = await f.input();
    await expect(
      f.service.save(f.context, { ...input, assignments: [] })
    ).rejects.toMatchObject({ code: "EXPLICIT_ASSIGNMENTS_REQUIRED" });
    await expect(
      f.service.save(f.context, {
        ...input,
        assignments: [
          {
            ...input.assignments[0],
            target: { ...input.assignments[0].target, asin: "B000000022" },
          },
        ],
      })
    ).rejects.toMatchObject({ code: "TARGETS_CHANGED" });
    f.state.analyses[0].title = "Changed after preview";
    await expect(f.service.save(f.context, input)).rejects.toMatchObject({
      code: "PREVIEW_CHANGED",
    });
    expect(f.puts).toHaveLength(0);
  });
  it("late source change prevents explicit completion without repeating upload", async () => {
    const f = createSupplementFixture(),
      input = await f.input();
    f.control.putUnknown = true;
    await f.service.save(f.context, input);
    f.state.analyses[0].title = "Changed source";
    await expect(
      f.service.complete(f.context, {
        ...f.scope,
        operationId: input.operationId,
      })
    ).rejects.toMatchObject({ code: "TARGETS_CHANGED" });
    expect(f.puts).toHaveLength(1);
    expect(f.state.manifests.size).toBe(0);
  });
  it("tampered bytes or private bucket/provider drift cannot complete or download", async () => {
    const f = createSupplementFixture(),
      input = await f.input();
    f.control.putUnknown = true;
    await f.service.save(f.context, input);
    f.control.badBytes = true;
    expect(
      await f.service.complete(f.context, {
        ...f.scope,
        operationId: input.operationId,
      })
    ).toMatchObject({ status: "unknown" });
    f.control.badBytes = false;
    f.control.domainChanged = true;
    await expect(
      f.service.complete(f.context, {
        ...f.scope,
        operationId: input.operationId,
      })
    ).rejects.toMatchObject({ code: "STORAGE_DOMAIN_CHANGED" });
    expect(f.puts).toHaveLength(1);
  });
  it("a storage callback cannot deliver bytes after authorization is revoked", async () => {
    const f = createSupplementFixture(),
      input = await f.input();
    await f.service.save(f.context, input);
    f.control.onRead = () => {
      f.control.allowed = false;
    };
    await expect(
      f.service.download(f.context, { ...f.scope, sourceId: input.operationId })
    ).rejects.toMatchObject({ code: "ACCESS_DENIED" });
  });
  it("authorized listing read does not bypass a separately revoked file-export permission", async () => {
    const f = createSupplementFixture(),
      input = await f.input();
    await f.service.save(f.context, input);
    f.control.denyExport = true;
    expect((await f.service.history(f.context, f.scope)).items).toHaveLength(1);
    await expect(
      f.service.download(f.context, { ...f.scope, sourceId: input.operationId })
    ).rejects.toMatchObject({ code: "ACCESS_DENIED" });
  });
  it("a manifest without its exact committed original-save receipt cannot be delivered as published proof", async () => {
    const f = createSupplementFixture(),
      input = await f.input();
    await f.service.save(f.context, input);
    f.state.operations.delete(
      supplementOperationKey(f.identity, input.operationId)
    );
    await expect(
      f.service.manifest(f.context, { ...f.scope, sourceId: input.operationId })
    ).rejects.toMatchObject({ code: "MANIFEST_ORIGIN_UNAVAILABLE" });
    await expect(
      f.service.download(f.context, { ...f.scope, sourceId: input.operationId })
    ).rejects.toMatchObject({ code: "MANIFEST_ORIGIN_UNAVAILABLE" });
    expect(f.deletes).toHaveLength(0);
  });
  it("many independent originals survive keyset history and separate authorized downloads", async () => {
    const f = createSupplementFixture();
    const originals: string[] = [];
    for (let n = 1; n <= 4; n++) {
      const original = f.file(
          `asin,body\nB000000021,File ${n} unique body\n`,
          "same-name.csv"
        ),
        preview = await f.service.preview(f.context, {
          ...f.scope,
          kind: "reviews",
          original,
        });
      const input = {
        ...f.scope,
        original,
        kind: "reviews",
        operationId: f.operationId(n),
        expectedPreviewHash: preview.previewHash,
        assignments: preview.records.map(row => ({
          recordId: row.recordId,
          target: preview.targets[0],
        })),
        confirmSourceOnly: true,
      };
      await f.service.save(f.context, input);
      originals.push(original.base64);
    }
    const first = await f.service.history(f.context, { ...f.scope, limit: 2 }),
      second = await f.service.history(f.context, {
        ...f.scope,
        limit: 2,
        cursor: first.nextCursor,
      });
    expect([...first.items, ...second.items].map(row => row.sourceId)).toEqual(
      [4, 3, 2, 1].map(f.operationId)
    );
    expect(second.nextCursor).toBeNull();
    for (let n = 1; n <= 4; n++)
      expect(
        (
          await f.service.download(f.context, {
            ...f.scope,
            sourceId: f.operationId(n),
          })
        ).base64
      ).toBe(originals[n - 1]);
    expect(f.state.manifests.size).toBe(4);
    expect(JSON.stringify(first)).not.toMatch(
      /base64|File 4 unique body|objectKey|storageUri/u
    );
  });
  it("failed parsing is a durable, downloadable original rather than a fabricated empty successful corpus", async () => {
    const f = createSupplementFixture(),
      original = f.file("wrong,columns\nnot,a review\n"),
      preview = await f.service.preview(f.context, {
        ...f.scope,
        kind: "reviews",
        original,
      });
    expect(preview).toMatchObject({
      status: "failed",
      records: [],
      coverage: { totalRows: null },
    });
    const input = {
      ...f.scope,
      original,
      kind: "reviews",
      operationId: f.operationId(),
      expectedPreviewHash: preview.previewHash,
      assignments: [],
      confirmSourceOnly: true,
    };
    expect(await f.service.save(f.context, input)).toMatchObject({
      status: "committed",
    });
    expect(
      (await f.service.history(f.context, f.scope)).items[0]
    ).toMatchObject({ previewStatus: "failed", reasonCode: "HEADER_MISSING" });
    expect(
      (
        await f.service.download(f.context, {
          ...f.scope,
          sourceId: input.operationId,
        })
      ).base64
    ).toBe(original.base64);
  });
  it("clipboard text/html original is exact, not CSV or a reconstructed normalized review", async () => {
    const f = createSupplementFixture(),
      text =
        "5 out of 5 stars\r\nA title\r\nReviewed in US on October 19, 2026\r\nExact  internal  spacing\r\nHelpful",
      html = "<div>Other complete clipboard representation</div>";
    const original = { originalType: "clipboard", text, html },
      preview = await f.service.preview(f.context, {
        ...f.scope,
        kind: "reviews",
        original,
      });
    expect(preview.records[0]).toMatchObject({
      kind: "reviews",
      value: { body: "Exact  internal  spacing" },
    });
    const input = {
      ...f.scope,
      kind: "reviews",
      original,
      operationId: f.operationId(),
      expectedPreviewHash: preview.previewHash,
      assignments: preview.records.map(row => ({
        recordId: row.recordId,
        target: preview.targets[0],
      })),
      confirmSourceOnly: true,
    };
    await f.service.save(f.context, input);
    const raw = await f.service.download(f.context, {
      ...f.scope,
      sourceId: input.operationId,
    });
    expect(
      JSON.parse(Buffer.from(raw.base64, "base64").toString("utf8"))
    ).toEqual({ version: 1, text, html });
    expect(raw.contentType).toBe("application/vnd.listing.clipboard+json");
  });
  it("original/record delete preserves immutable normalized manifest and never deletes business rows", async () => {
    const f = createSupplementFixture(),
      input = await f.input(),
      saved = await f.service.save(f.context, input),
      before = await f.service.manifest(f.context, {
        ...f.scope,
        sourceId: input.operationId,
      });
    const deletion = {
      ...f.scope,
      sourceId: input.operationId,
      operationId: f.operationId(2),
      expectedManifestHash: saved.manifestHash,
      confirmPreserveImportedData: true,
    };
    expect(await f.service.deleteOriginal(f.context, deletion)).toMatchObject({
      status: "committed",
      originalState: "deleted",
      recordState: "visible",
    });
    expect(f.deletes).toHaveLength(1);
    await expect(
      f.service.download(f.context, { ...f.scope, sourceId: input.operationId })
    ).rejects.toMatchObject({ code: "ORIGINAL_UNAVAILABLE" });
    expect(
      await f.service.manifest(f.context, {
        ...f.scope,
        sourceId: input.operationId,
      })
    ).toEqual(before);
    expect(
      await f.service.deleteRecord(f.context, {
        ...deletion,
        operationId: f.operationId(3),
      })
    ).toMatchObject({ status: "committed", recordState: "deleted" });
    expect(f.deletes).toHaveLength(1);
    expect((await f.service.history(f.context, f.scope)).items).toHaveLength(0);
    expect(
      await f.service.manifest(f.context, {
        ...f.scope,
        sourceId: input.operationId,
      })
    ).toEqual(before);
    expect(
      f.sqlCalls.some(row =>
        /DELETE FROM|UPDATE competitorAnalyses|UPDATE projectFiles|UPDATE buyerQuestions/iu.test(
          row.text
        )
      )
    ).toBe(false);
  });
  it("unknown delete is verified absent with same UUID, never retried or misreported cancelled", async () => {
    const f = createSupplementFixture(),
      input = await f.input(),
      saved = await f.service.save(f.context, input);
    f.control.deleteUnknown = true;
    const deletion = {
      ...f.scope,
      sourceId: input.operationId,
      operationId: f.operationId(2),
      expectedManifestHash: saved.manifestHash,
      confirmPreserveImportedData: true,
    };
    expect(await f.service.deleteRecord(f.context, deletion)).toMatchObject({
      status: "unknown",
    });
    expect(f.deletes).toHaveLength(1);
    expect(
      await f.service.cancel(f.context, {
        ...f.scope,
        operationId: deletion.operationId,
      })
    ).toMatchObject({
      status: "unknown",
      reasonCode: "DELETE_ALREADY_DISPATCHED_CHECK_SAME_UUID",
    });
    expect(await f.service.deleteRecord(f.context, deletion)).toMatchObject({
      status: "unknown",
    });
    expect(f.deletes).toHaveLength(1);
    f.control.enabled = false;
    expect(
      await f.service.complete(f.context, {
        ...f.scope,
        operationId: deletion.operationId,
      })
    ).toMatchObject({ status: "committed", recordState: "deleted" });
    expect(f.deletes).toHaveLength(1);
  });
  it("default gate rejects new saves/deletes; known request check/cancel remain available", async () => {
    const f = createSupplementFixture(),
      input = await f.input();
    f.control.enabled = false;
    await expect(f.service.save(f.context, input)).rejects.toMatchObject({
      code: "WRITES_DISABLED",
    });
    expect(f.puts).toHaveLength(0);
    expect(
      await f.service.cancel(f.context, {
        ...f.scope,
        operationId: input.operationId,
      })
    ).toMatchObject({ status: "cancelled" });
    expect(
      await f.service.check(f.context, {
        ...f.scope,
        operationId: input.operationId,
      })
    ).toMatchObject({ status: "cancelled" });
  });
  it("prepared manifest tampering cannot be used as proof of original content", async () => {
    const f = createSupplementFixture(),
      input = await f.input();
    f.control.putUnknown = true;
    await f.service.save(f.context, input);
    const row = f.state.operations.get(
      supplementOperationKey(f.identity, input.operationId)
    )!;
    const prepared = JSON.parse(String(row.preparedJson));
    prepared.manifest.records[0].source.value.body = "Forged";
    row.preparedJson = JSON.stringify(prepared);
    expect(
      await f.service.complete(f.context, {
        ...f.scope,
        operationId: input.operationId,
      })
    ).toMatchObject({ status: "unknown" });
    expect(f.puts).toHaveLength(1);
    expect(f.state.manifests.size).toBe(0);
  });
  it("question/attribute inputs remain distinct and product attributes bind the product target, never a competitor", async () => {
    const f = createSupplementFixture();
    for (const [n, kind, rows] of [
      [
        1,
        "questions",
        [
          {
            value: {
              question: "Can it fit?",
              questionCn: "可以适配吗？",
              answer: "Unknown",
              answerCn: null,
              parentQuestion: null,
              type: "alexa",
            },
          },
        ],
      ],
      [
        2,
        "attributes",
        [{ value: { name: "Material", value: "Test material" } }],
      ],
    ] as const) {
      const original = {
          originalType: "clipboard",
          text: JSON.stringify(rows),
          html: "<p>Complete original HTML is preserved</p>",
        },
        preview = await f.service.preview(f.context, {
          ...f.scope,
          kind,
          original,
        });
      expect(preview.status).toBe("ready");
      const request: SupplementSaveInput = {
        ...f.scope,
        kind,
        original: { ...original, originalType: "clipboard" },
        operationId: f.operationId(n),
        expectedPreviewHash: preview.previewHash,
        assignments: preview.records.map(row => ({
          recordId: row.recordId,
          target: preview.targets[0],
        })),
        confirmSourceOnly: true,
      };
      expect(await f.service.save(f.context, request)).toMatchObject({
        status: "committed",
      });
      const manifest = await f.service.manifest(f.context, {
        ...f.scope,
        sourceId: request.operationId,
      });
      expect(manifest.kind).toBe(kind);
      expect(manifest.records[0].target.type).toBe(
        kind === "attributes" ? "product" : "competitor"
      );
      expect(supplementHash(manifest.records)).toHaveLength(64);
    }
  });
});
