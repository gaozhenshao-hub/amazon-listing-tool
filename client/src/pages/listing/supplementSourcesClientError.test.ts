import { describe, expect, it } from "vitest";
import { SupplementClientError } from "./supplementSourcesClientError";
describe("structured supplement client errors", () => {
  it("keeps the diagnostic message independent of its typed code", () => { const error = new SupplementClientError("SUPPLEMENT_FILE_LIMIT"); expect(error).toBeInstanceOf(Error); expect(error.code).toBe("SUPPLEMENT_FILE_LIMIT"); expect(error.message).toBe("SUPPLEMENT_FILE_LIMIT"); error.message = "Different diagnostic text"; expect(error.code).toBe("SUPPLEMENT_FILE_LIMIT"); });
  it("does not classify an ordinary Error by a matching name or message", () => { const error = new Error("SUPPLEMENT_FILE_LIMIT"); error.name = "SupplementClientError"; expect(error).not.toBeInstanceOf(SupplementClientError); });
});
