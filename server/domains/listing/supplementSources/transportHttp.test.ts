import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { createTRPCProxyClient, httpLink } from "@trpc/client";
import superjson from "superjson";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { router } from "../../../_core/trpc";
import type { TrpcContext } from "../../../_core/context";
import { createSupplementFixture } from "./testFixture";
import { createListingSupplementTransportService } from "./transportService";
import { createListingSupplementSourcesRouter } from "./router";
import { SupplementSourceError } from "./protocol";
import { LISTING_SUPPLEMENT_LIMITS } from "../../../../shared/listingSupplementSources";
import {
  LISTING_SUPPLEMENT_TRANSPORT_LIMITS,
  SupplementDownloadTransportSchema,
  SupplementPreviewTransportSchema,
} from "../../../../shared/listingSupplementTransport";

const servers: Server[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    servers.splice(0).map(
      server =>
        new Promise<void>((resolve, reject) => {
          server.close(error => (error ? reject(error) : resolve()));
          server.closeAllConnections();
        })
    )
  );
});
async function httpFixture() {
  const f = createSupplementFixture();
  const context = {
    ...f.context,
    user: { ...f.context.user, role: "operator", defaultWorkspaceId: 7 },
  } as TrpcContext;
  const service = createListingSupplementTransportService({
    service: f.service,
    repository: f.repository,
  });
  const api = router({
    listing: router({
      supplementSources: createListingSupplementSourcesRouter(service),
    }),
  });
  // Check the actual web entrypoint rather than inventing a larger upload
  // budget only in a test harness. No production server is imported/started.
  const source = readFileSync(
    new URL("../../../_core/index.ts", import.meta.url),
    "utf8"
  );
  const match = /express\.json\(\{\s*limit:\s*"(\d+)mb"\s*\}\)/u.exec(source);
  expect(Number(match?.[1]) * 1024 * 1024).toBe(
    LISTING_SUPPLEMENT_TRANSPORT_LIMITS.httpBodyBytes
  );
  const app = express();
  app.use(
    express.json({ limit: LISTING_SUPPLEMENT_TRANSPORT_LIMITS.httpBodyBytes })
  );
  app.use(
    "/api/trpc",
    createExpressMiddleware({ router: api, createContext: () => context })
  );
  // Deliberately sanitize the synthetic harness' body-parser error too.
  const errorHandler: express.ErrorRequestHandler = (
    error: unknown,
    _request,
    response,
    _next
  ) => {
    const large =
      error instanceof Error &&
      "type" in error &&
      error.type === "entity.too.large";
    response
      .status(large ? 413 : 500)
      .json({ error: large ? "BODY_LIMIT" : "INTERNAL" });
  };
  app.use(errorHandler);
  const server = await new Promise<Server>(resolve => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  servers.push(server);
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/trpc`;
  const requestSizes: number[] = [];
  const client = createTRPCProxyClient<typeof api>({
    links: [
      httpLink({
        url,
        transformer: superjson,
        fetch: (input, init) => {
          if (typeof init?.body === "string")
            requestSizes.push(Buffer.byteLength(init.body));
          return fetch(input, { ...init, signal: AbortSignal.timeout(30_000) });
        },
      }),
    ],
  });
  return {
    f,
    service,
    client: client.listing.supplementSources,
    url,
    requestSizes,
  };
}

describe("actual tRPC HTTP source-only transport budget", () => {
  it("round-trips ALL 20MiB original bytes through Express + single-request tRPC + actual storage adapter", async () => {
    const { f, client, requestSizes } = await httpFixture();
    const original = {
      originalType: "file" as const,
      fileName: "complete-original.txt",
      contentType: "text/plain" as const,
      base64: Buffer.alloc(LISTING_SUPPLEMENT_LIMITS.fileBytes, 0x61).toString(
        "base64"
      ),
    };
    expect(original.base64.length).toBe(27_962_028);
    const input = { ...f.scope, kind: "reviews" as const, original };
    const preview = SupplementPreviewTransportSchema.parse(
      await client.preview.mutate(input)
    );
    expect(preview.data).toMatchObject({
      status: "failed",
      reasonCode: "FORMAT_UNSUPPORTED",
      coverage: { totalRows: null, acceptedRows: 0 },
    });
    expect(preview.input.original.byteSize).toBe(
      LISTING_SUPPLEMENT_LIMITS.fileBytes
    );
    expect(f.puts).toHaveLength(0);
    const saved = await client.save.mutate({
      ...input,
      operationId: f.operationId(),
      expectedPreviewHash: preview.data.previewHash,
      assignments: [],
      confirmSourceOnly: true,
    });
    expect(saved.data.status).toBe("committed");
    expect(f.puts).toHaveLength(1);
    const downloaded = SupplementDownloadTransportSchema.parse(
      await client.download.query({
        ...f.scope,
        sourceId: f.operationId(),
      })
    );
    expect(downloaded.data.base64).toBe(original.base64);
    const bytes = Buffer.from(downloaded.data.base64, "base64");
    expect(bytes.length).toBe(LISTING_SUPPLEMENT_LIMITS.fileBytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      downloaded.data.contentHash
    );
    expect(requestSizes).toHaveLength(2);
    expect(
      requestSizes.every(
        size =>
          size > 27_962_028 &&
          size < LISTING_SUPPLEMENT_TRANSPORT_LIMITS.httpBodyBytes
      )
    ).toBe(true);
    expect(JSON.stringify(downloaded)).not.toMatch(
      /objectKey|storageUri|presigned|private-bucket/u
    );
    // An unsupported format is archived as an explicit failed preview, never a
    // fabricated zero-row complete business import or an adopted Listing fact.
    expect(f.state.analyses).toHaveLength(1);
    expect(f.state.manifests.size).toBe(1);
  }, 30_000);
  it("an oversized multi-original HTTP batch is rejected before either preview or storage side effect", async () => {
    const { f, url } = await httpFixture();
    const preview = vi.spyOn(f.service, "preview");
    const input = {
      ...f.scope,
      kind: "reviews",
      original: {
        originalType: "file",
        fileName: "original.txt",
        contentType: "text/plain",
        base64: Buffer.alloc(
          LISTING_SUPPLEMENT_LIMITS.fileBytes,
          0x61
        ).toString("base64"),
      },
    };
    const body = JSON.stringify({
      "0": superjson.serialize(input),
      "1": superjson.serialize(input),
    });
    expect(Buffer.byteLength(body)).toBeGreaterThan(
      LISTING_SUPPLEMENT_TRANSPORT_LIMITS.httpBodyBytes
    );
    const response = await fetch(
      `${url}/listing.supplementSources.preview,listing.supplementSources.preview?batch=1`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(30_000),
      }
    );
    expect(response.status).toBe(413);
    expect(preview).not.toHaveBeenCalled();
    expect(f.sqlCalls).toHaveLength(0);
    expect(f.puts).toHaveLength(0);
  }, 30_000);
  it("HTTP errors expose stable reason codes, not driver/storage diagnostics", async () => {
    const { f, client } = await httpFixture();
    const original = await f.service.history(f.context, f.scope);
    const history = vi
      .spyOn(f.service, "history")
      .mockRejectedValueOnce(
        new Error("storage://s3/private-object?token=credential")
      );
    const unavailable = await client.history
      .query(f.scope)
      .catch(error => error);
    expect(unavailable).toMatchObject({
      message: "LISTING_SUPPLEMENT_UNAVAILABLE",
      data: {
        code: "PRECONDITION_FAILED",
        appCode: "PRECONDITION_FAILED",
        retryable: false,
        details: {
          domain: "listing_supplement_sources",
          reasonCode: "UNAVAILABLE",
        },
      },
    });
    expect(JSON.stringify(unavailable)).not.toMatch(
      /storage:\/\/|private-object|token=credential/u
    );
    expect(history).toHaveBeenCalledTimes(1);
    history.mockRejectedValueOnce(new SupplementSourceError("ACCESS_DENIED"));
    const denied = await client.history.query(f.scope).catch(error => error);
    expect(denied).toMatchObject({
      message: "LISTING_SUPPLEMENT_ACCESS_DENIED",
      data: {
        code: "FORBIDDEN",
        appCode: "PERMISSION_DENIED",
        retryable: false,
        details: {
          domain: "listing_supplement_sources",
          reasonCode: "ACCESS_DENIED",
        },
      },
    });
    expect(history).toHaveBeenCalledTimes(2);
    history.mockResolvedValueOnce({
      ...original,
      identity: { userId: 4, workspaceId: 7 },
    });
    const invalid = await client.history.query(f.scope).catch(error => error);
    expect(invalid).toMatchObject({
      message: "系统内部错误",
      data: {
        code: "INTERNAL_SERVER_ERROR",
        appCode: "INTERNAL_ERROR",
        retryable: false,
        details: {
          domain: "listing_supplement_sources",
          reasonCode: "RESPONSE_INVALID",
        },
      },
    });
    expect(JSON.stringify(invalid)).not.toMatch(
      /storage:\/\/|private-object|token=credential/u
    );
    expect(history).toHaveBeenCalledTimes(3);
    expect(f.puts).toHaveLength(0);
  });
});
