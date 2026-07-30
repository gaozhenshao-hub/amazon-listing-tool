import { describe, expect, it } from "vitest";
import { renderSkillTemplate, safeParseSkillJSON, SkillRunError } from "./services/emperorSkillRunner";

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

  it("renders if/else blocks", () => {
    expect(renderSkillTemplate("{{#if emphasis}}Focus: {{emphasis}}{{else}}Default{{/if}}", {
      emphasis: "durability",
    })).toBe("Focus: durability");
    expect(renderSkillTemplate("{{#if emphasis}}Focus{{else}}Default{{/if}}", {})).toBe("Default");
  });

  it("renders each blocks with this and index", () => {
    expect(renderSkillTemplate("{{#each keywords}}{{@index}}:{{this}};{{/each}}", {
      keywords: ["mug", "cup"],
    })).toBe("0:mug;1:cup;");
  });

  it("renders conditions inside each blocks", () => {
    expect(renderSkillTemplate("{{#each items}}{{#if this.enabled}}{{this.name}};{{/if}}{{/each}}", {
      items: [{ name: "A", enabled: true }, { name: "B", enabled: false }],
    })).toBe("A;");
  });
});

describe("safeParseSkillJSON", () => {
  it("extracts fenced JSON after thinking text", () => {
    expect(safeParseSkillJSON('<thinking>draft</thinking>\n```json\n{"ok":true}\n```'))
      .toEqual({ ok: true });
  });

  it("returns raw content when parsing fails", () => {
    expect(safeParseSkillJSON("not json")).toEqual({ raw: "not json" });
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
