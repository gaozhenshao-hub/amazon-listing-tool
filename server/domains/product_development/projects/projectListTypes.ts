import type {
  DevProduct,
  DevProfitCalculation,
  DevProject,
  DevProjectProgress,
  DevTimePlan,
} from "../../../../drizzle/schema";

export type ProjectListMember = {
  projectId: number;
  userId: number;
  name: string;
  role: string;
};

export type ProjectListSourceData = {
  projects: Array<DevProject & { ownerName?: string }>;
  progress: DevProjectProgress[];
  products: DevProduct[];
  timePlans: DevTimePlan[];
  profits: DevProfitCalculation[];
  members: ProjectListMember[];
};

export type ProjectReviewStatus = "unreviewed" | "reviewing" | "approved" | "rejected";

export type ProjectLandingStage =
  | "research"
  | "decoding"
  | "copying"
  | "sample_sourcing"
  | "solution_design"
  | "first_prototype"
  | "supplier_selection"
  | "production"
  | "shipped"
  | "completed";

export type ProjectProgressPatch = {
  primaryCompetitorAsin?: string | null;
  selectorName?: string | null;
  operatorName?: string | null;
  landingStage?: ProjectLandingStage | null;
  landingProgress?: number;
  reviewStatus?: ProjectReviewStatus;
  assistantName?: string | null;
};
