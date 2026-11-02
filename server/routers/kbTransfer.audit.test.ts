import { describe, expect, it } from "vitest";
import {
  buildProductKnowledgeTransferExportAuditMetadata,
  readProductKnowledgeTransferExportAuditMetadata,
} from "./kbTransfer";

describe("product knowledge transfer export audit metadata", () => {
  it("records only the approved export scope and scale fields", () => {
    const metadata = buildProductKnowledgeTransferExportAuditMetadata({
      modules: ["images", "skills"],
      dateField: "updated_at",
      startAt: new Date("2026-08-01T00:00:00.000Z"),
      endAt: new Date("2026-08-28T23:59:59.999Z"),
      tags: ["A+", "主图"],
    }, { itemCount: 31, attachmentCount: 561, bytes: 123456 });

    expect(metadata).toEqual({
      filter: {
        modules: ["images", "skills"],
        dateField: "updated_at",
        startAt: "2026-08-01T00:00:00.000Z",
        endAt: "2026-08-28T23:59:59.999Z",
        tags: ["A+", "主图"],
      },
      itemCount: 31,
      attachmentCount: 561,
      archiveBytes: 123456,
    });
    expect(JSON.stringify(metadata)).not.toMatch(/url|token|secret|attachmentPath/i);
  });

  it("returns an allowlisted view even if a stored audit payload contains extra fields", () => {
    const metadata = readProductKnowledgeTransferExportAuditMetadata({
      filter: { modules: ["images"], dateField: "created_at", startAt: "2026-08-01T00:00:00.000Z", tags: ["A+"] },
      itemCount: 2,
      attachmentCount: 9,
      archiveBytes: 1024,
      url: "https://signed.example.com/private.zip?token=leak",
      attachmentPath: "private/path",
    });
    expect(metadata).toEqual({
      filter: { modules: ["images"], dateField: "created_at", startAt: "2026-08-01T00:00:00.000Z", endAt: null, tags: ["A+"] },
      itemCount: 2,
      attachmentCount: 9,
      archiveBytes: 1024,
    });
  });
});
