export type DomainLayer = "platform" | "business";

export type DomainDependencySlug = DomainBoundary["slug"];

export type DomainBoundary = {
  slug: "ai_os" | "listing" | "image" | "ops" | "ads" | "product_development";
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
    allowedPlatformImports: [
      "server/domains/ai_os/services/skillRunner.ts",
      "server/domains/ai_os/services/businessSkillGateway.ts",
    ],
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
    allowedPlatformImports: [
      "server/domains/ai_os/services/jobRunner.ts",
      "server/domains/ai_os/services/businessSkillGateway.ts",
    ],
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
    allowedPlatformImports: ["server/domains/ai_os/services/businessSkillGateway.ts"],
    notes: "Product operations owns operational reports and actions; conversion helpers are exposed through the domain service facade.",
  },
  {
    slug: "ads",
    layer: "business",
    router: "server/domains/ads/router.ts",
    service: "server/domains/ads/service.ts",
    repository: "server/domains/ads/repository.ts",
    schema: "server/domains/ads/schema.ts",
    types: "server/domains/ads/types.ts",
    allowedPlatformImports: ["server/domains/ai_os/services/businessSkillGateway.ts"],
    notes: "Advertising owns ad analysis contracts and data access; AI execution is delegated to Emperor Skill.",
  },
  {
    slug: "product_development",
    layer: "business",
    router: "server/domains/product_development/router.ts",
    service: "server/domains/product_development/service.ts",
    repository: "server/domains/product_development/repository.ts",
    schema: "server/domains/product_development/schema.ts",
    types: "server/domains/product_development/types.ts",
    allowedPlatformImports: [
      "server/domains/ai_os/services/businessSkillGateway.ts",
      "server/domains/ai_os/services/businessArtifactRegistry.ts",
    ],
    notes: "Product development owns staged analysis and human confirmation while AI OS owns execution and artifacts.",
  },
];

/**
 * Directional domain dependencies. The platform must never depend on a
 * business domain; business domains may consume AI OS through its public
 * services, and ads may reuse the workspace boundary owned by ops.
 */
export const DOMAIN_DEPENDENCY_RULES: Record<DomainDependencySlug, readonly DomainDependencySlug[]> = {
  ai_os: [],
  listing: ["ai_os"],
  image: ["ai_os"],
  ops: ["ai_os"],
  ads: ["ai_os", "ops"],
  product_development: ["ai_os"],
};

export function getDomainBoundary(slug: DomainBoundary["slug"]) {
  return DOMAIN_BOUNDARIES.find((domain) => domain.slug === slug) ?? null;
}

export function listBusinessDomains() {
  return DOMAIN_BOUNDARIES.filter((domain) => domain.layer === "business");
}
