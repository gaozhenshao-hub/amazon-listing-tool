import { describe, expect, it } from "vitest";
import { createSupplementOriginalStorage } from "./storage";
import { supplementBytesHash } from "./protocol";
const identity = { userId: 3, workspaceId: 7 },
  scope = { expectedWorkspaceId: 7, projectId: 11 },
  sourceId = "00000000-0000-4000-8000-000000000001";
function fixture() {
  const bytes = Buffer.from("Exact private original bytes\r\n"),
    metadata = {
      originalType: "file" as const,
      fileName: "source.csv",
      contentType: "text/csv" as const,
      byteSize: bytes.length,
      contentHash: supplementBytesHash(bytes),
    };
  const control = {
    provider: "s3" as "s3" | "oss" | "local",
    bucket: "private",
    url: "https://private.example.test/object",
    present: true,
    status: 200,
    badBody: false,
    badKey: false,
    putUnknown: false,
    deleteUnknown: false,
  };
  const calls = {
    puts: 0,
    deletes: 0,
    requests: 0,
    maxAttempts: null as unknown,
    options: null as unknown,
  };
  const storage = createSupplementOriginalStorage({
    assertPrivate: () => {},
    provider: () => control.provider,
    configuration: () => ({
      region: "region",
      bucket: control.bucket,
      endpoint: "https://private.example.test",
      forcePathStyle: true,
      accessKeyId: "synthetic",
      secretAccessKey: "synthetic",
    }),
    put: async (key, _bytes, _type, options) => {
      calls.puts++;
      calls.maxAttempts = options?.maxAttempts;
      if (control.putUnknown) throw new Error("sensitive provider diagnostic");
      return {
        key,
        url: control.url,
        storageUri: `storage://${control.provider}/${key}`,
      };
    },
    get: async key => ({
      key: control.badKey ? "different-key" : key,
      url: control.url,
    }),
    request: async (_url, options) => {
      calls.requests++;
      calls.options = options;
      return {
        ok: control.present && control.status === 200,
        status: !control.present ? 404 : control.status,
        body: control.present
          ? control.badBody
            ? Buffer.from("Wrong")
            : bytes
          : Buffer.alloc(0),
      };
    },
    remove: async () => {
      calls.deletes++;
      control.present = false;
      if (control.deleteUnknown) throw new Error("sensitive delete diagnostic");
    },
  });
  return {
    bytes,
    metadata,
    control,
    calls,
    storage,
    prepared: storage.prepare(identity, scope, sourceId, metadata),
  };
}
describe("private supplemental original adapter", () => {
  it("keeps original bytes and explicitly forbids SDK retry", async () => {
    const f = fixture();
    await f.storage.putOnce(f.prepared, f.bytes);
    expect(f.calls).toMatchObject({ puts: 1, maxAttempts: 1 });
    expect(await f.storage.readVerified(f.prepared)).toEqual(f.bytes);
    expect(f.calls.options).toMatchObject({
      maxResponseBytes: f.bytes.length,
      maxRedirects: 0,
      allowedHosts: ["private.example.test"],
    });
  });
  it("does not expose provider messages or retry uncertain PUT/DELETE", async () => {
    const f = fixture();
    f.control.putUnknown = true;
    await expect(f.storage.putOnce(f.prepared, f.bytes)).rejects.toMatchObject({
      code: "PUT_OUTCOME_UNKNOWN",
    });
    expect(f.calls.puts).toBe(1);
    f.control.deleteUnknown = true;
    await expect(f.storage.deleteOnce(f.prepared)).rejects.toMatchObject({
      code: "DELETE_OUTCOME_UNKNOWN",
    });
    expect(f.calls.deletes).toBe(1);
    await f.storage.verifyAbsent(f.prepared);
    expect(f.calls.deletes).toBe(1);
  });
  it.each([
    "http://private.example.test/object",
    "https://user:pass@private.example.test/object",
    "https://private.example.test/object#fragment",
    "https://private.example.test:444/object",
  ])("rejects unsafe delivery URL %s before GET", async url => {
    const f = fixture();
    f.control.url = url;
    await expect(f.storage.readVerified(f.prepared)).rejects.toMatchObject({
      code: "OBJECT_UNVERIFIED",
    });
    expect(f.calls.requests).toBe(0);
  });
  it("requires the persisted provider/bucket identity rather than rebinding an old URI", async () => {
    const f = fixture();
    f.control.bucket = "different-bucket";
    await expect(f.storage.readVerified(f.prepared)).rejects.toMatchObject({
      code: "STORAGE_DOMAIN_CHANGED",
    });
    await expect(f.storage.deleteOnce(f.prepared)).rejects.toMatchObject({
      code: "STORAGE_DOMAIN_CHANGED",
    });
    expect(f.calls.deletes).toBe(0);
  });
  it("fails closed for unsupported provider and wrong object key", async () => {
    const f = fixture();
    f.control.provider = "local";
    expect(() =>
      f.storage.prepare(identity, scope, sourceId, f.metadata)
    ).toThrow();
    f.control.provider = "s3";
    f.control.badKey = true;
    await expect(f.storage.readVerified(f.prepared)).rejects.toMatchObject({
      code: "OBJECT_UNVERIFIED",
    });
    expect(f.calls.requests).toBe(0);
  });
  it("verifies actual digest/length and treats 403 or 500 as unknown, not deletion evidence", async () => {
    const f = fixture();
    f.control.badBody = true;
    await expect(f.storage.readVerified(f.prepared)).rejects.toMatchObject({
      code: "OBJECT_UNVERIFIED",
    });
    f.control.badBody = false;
    for (const status of [403, 500]) {
      f.control.status = status;
      await expect(f.storage.verifyAbsent(f.prepared)).rejects.toMatchObject({
        code: "OBJECT_UNVERIFIED",
      });
    }
    expect(f.calls.deletes).toBe(0);
  });
  it("does not let a raw path or changed byte payload select a different object", async () => {
    const f = fixture();
    await expect(
      f.storage.putOnce(f.prepared, Buffer.from("different"))
    ).rejects.toMatchObject({ code: "CONTENT_MISMATCH" });
    await expect(
      f.storage.deleteOnce({
        ...f.prepared,
        objectKey: "another-user/original",
        storageUri: "storage://s3/another-user/original",
      })
    ).rejects.toThrow();
    expect(f.calls.puts).toBe(0);
    expect(f.calls.deletes).toBe(0);
  });
});
