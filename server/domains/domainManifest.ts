export type DomainLayer = "platform" | "business";

export type DomainBoundary = {
  slug: "ai_os" | "listing" | "image" | "ops";
  layer: DomainLayer;
  router: string;
  service: string;
  repository: string;
  schema: string;
  types: string;
  allowedPlatformImports: string[];
  notes: string;
};

export const DOMAIN_BOUNDARIES: DomainBoundary[] = [
  {
    slug: "ai_os",
    layer: "platform",
    router: "server/domains/ai_os/router.ts",
    service: "server/domains/ai_os/services",
    repository: "server/domains/ai_os/repository.ts",
    schema: "server/domains/ai_os/schema.ts",
    types: "server/domains/ai_os/types.ts",
    allowedPlatformImports: [],
    notes: "Owns Skill, Agent, Tool, Job, Run, Checkpoint, Artifact, Event and observability runtime.",
  },
  {
    slug: "listing",
    layer: "business",
    router: "server/domains/listing/router.ts",
    service: "server/domains/listing/service.ts",
    repository: "server/domains/listing/repository.ts",
    schema: "server/domains/listing/schema.ts",
    types: "server/domains/listing/types.ts",
    allowedPlatformImports: ["server/domains/ai_os/services/skillRunner.ts"],
    notes: "Listing business code may call AI OS as a platform capability, but owns listing copy workflow data.",
  },
  {
    slug: "image",
    layer: "business",
    router: "server/domains/image/router.ts",
    service: "server/domains/image/service.ts",
    repository: "server/domains/image/repository.ts",
    schema: "server/domains/image/schema.ts",
    types: "server/domains/image/types.ts",
    allowedPlatformImports: ["server/domains/ai_os/services/jobRunner.ts"],
    notes: "Image workflow owns image sessions and suggestions; long-running execution stays in AI OS Job.",
  },
  {
    slug: "ops",
    layer: "business",
    router: "server/domains/ops/router.ts",
    service: "server/domains/ops/service.ts",
    repository: "server/domains/ops/repository.ts",
    schema: "server/domains/ops/schema.ts",
    types: "server/domains/ops/types.ts",
    allowedPlatformImports: [],
    notes: "Product operations owns operational reports and actions; conversion helpers are exposed through the domain service facade.",
  },
];

export function getDomainBoundary(slug: DomainBoundary["slug"]) {
  return DOMAIN_BOUNDARIES.find((domain) => domain.slug === slug) ?? null;
}

export function listBusinessDomains() {
  return DOMAIN_BOUNDARIES.filter((domain) => domain.layer === "business");
}
