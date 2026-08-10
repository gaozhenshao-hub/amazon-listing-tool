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

export type ProjectProgressPatch = {
  primaryCompetitorAsin?: string | null;
  selectorName?: string | null;
  landingProgress?: number;
  reviewStatus?: ProjectReviewStatus;
  assistantName?: string | null;
};
