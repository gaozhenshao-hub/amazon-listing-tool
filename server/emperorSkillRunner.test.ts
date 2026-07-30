import { describe, expect, it } from "vitest";
import { renderSkillTemplate, SkillRunError } from "./services/emperorSkillRunner";

describe("renderSkillTemplate", () => {
  it("renders scalar variables", () => {
    expect(renderSkillTemplate("Product: {{name}}", { name: "Coffee Grinder" }))
      .toBe("Product: Coffee Grinder");
  });

  it("renders nested variables", () => {
    expect(renderSkillTemplate("Brand: {{product.brand}}", {
      product: { brand: "Example" },
    })).toBe("Brand: Example");
  });

  it("serializes objects and removes missing variables", () => {
    expect(renderSkillTemplate("{{payload}}|{{missing}}", {
      payload: { count: 2 },
    })).toBe('{"count":2}|');
  });
});

describe("SkillRunError", () => {
  it("preserves error code and retryability", () => {
    const error = new SkillRunError("PROVIDER_TIMEOUT", "timeout", true);
    expect(error.code).toBe("PROVIDER_TIMEOUT");
    expect(error.retryable).toBe(true);
    expect(error.name).toBe("SkillRunError");
  });
});
