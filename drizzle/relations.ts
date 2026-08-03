import { relations } from "drizzle-orm";
import {
  adStructures,
  aiJobDeadLetters,
  aiJobs,
  analysisVersions,
  competitorAnalyses,
  competitorImageAnalyses,
  emperorAgentArtifacts,
  emperorAgentCheckpoints,
  emperorAgentEvents,
  emperorAgentRuns,
  emperorAgents,
  emperorAgentTemplateVersions,
  emperorSkillRuns,
  emperorSkills,
  emperorToolRuns,
  emperorTools,
  expressionGroupImages,
  expressionGroups,
  imageWorkflowSessions,
  keywords,
  listings,
  listingVersions,
  loginLogs,
  negativeKeywords,
  organizations,
  projectFiles,
  projects,
  reviewAggregations,
  reviewImports,
  securityAccessPolicies,
  securityAuditLogs,
  sellingPointDrafts,
  usageStats,
  users,
  workspaceMemberships,
  workspaces,
} from "./schema";

export const organizationsRelations = relations(organizations, ({ many, one }) => ({
  owner: one(users, {
    fields: [organizations.ownerUserId],
    references: [users.id],
  }),
  workspaces: many(workspaces),
}));

export const workspacesRelations = relations(workspaces, ({ many, one }) => ({
  memberships: many(workspaceMemberships),
  organization: one(organizations, {
    fields: [workspaces.organizationId],
    references: [organizations.id],
  }),
  owner: one(users, {
    fields: [workspaces.ownerUserId],
    references: [users.id],
  }),
  projects: many(projects),
}));

export const workspaceMembershipsRelations = relations(workspaceMemberships, ({ one }) => ({
  user: one(users, {
    fields: [workspaceMemberships.userId],
    references: [users.id],
  }),
  workspace: one(workspaces, {
    fields: [workspaceMemberships.workspaceId],
    references: [workspaces.id],
  }),
}));

export const securityAuditLogsRelations = relations(securityAuditLogs, ({ one }) => ({
  actor: one(users, {
    fields: [securityAuditLogs.actorUserId],
    references: [users.id],
  }),
  project: one(projects, {
    fields: [securityAuditLogs.projectId],
    references: [projects.id],
  }),
  workspace: one(workspaces, {
    fields: [securityAuditLogs.workspaceId],
    references: [workspaces.id],
  }),
}));

export const securityAccessPoliciesRelations = relations(securityAccessPolicies, ({ one }) => ({
  createdByUser: one(users, {
    fields: [securityAccessPolicies.createdBy],
    references: [users.id],
  }),
  workspace: one(workspaces, {
    fields: [securityAccessPolicies.workspaceId],
    references: [workspaces.id],
  }),
}));

export const usersRelations = relations(users, ({ many, one }) => ({
  aiJobs: many(aiJobs),
  defaultWorkspace: one(workspaces, {
    fields: [users.defaultWorkspaceId],
    references: [workspaces.id],
  }),
  loginLogs: many(loginLogs),
  memberships: many(workspaceMemberships),
  organization: one(organizations, {
    fields: [users.organizationId],
    references: [organizations.id],
  }),
  projects: many(projects),
  usageStats: many(usageStats),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  owner: one(users, {
    fields: [projects.userId],
    references: [users.id],
  }),
  workspace: one(workspaces, {
    fields: [projects.workspaceId],
    references: [workspaces.id],
  }),
  adStructures: many(adStructures),
  agentRuns: many(emperorAgentRuns),
  artifacts: many(emperorAgentArtifacts),
  competitorAnalyses: many(competitorAnalyses),
  competitorImages: many(competitorImageAnalyses),
  expressionGroups: many(expressionGroups),
  imageWorkflowSessions: many(imageWorkflowSessions),
  keywords: many(keywords),
  listings: many(listings),
  negativeKeywords: many(negativeKeywords),
  projectFiles: many(projectFiles),
  reviewAggregations: many(reviewAggregations),
  reviewImports: many(reviewImports),
  sellingPointDrafts: many(sellingPointDrafts),
}));

export const loginLogsRelations = relations(loginLogs, ({ one }) => ({
  user: one(users, {
    fields: [loginLogs.userId],
    references: [users.id],
  }),
}));

export const usageStatsRelations = relations(usageStats, ({ one }) => ({
  user: one(users, {
    fields: [usageStats.userId],
    references: [users.id],
  }),
}));

export const competitorAnalysesRelations = relations(competitorAnalyses, ({ one }) => ({
  project: one(projects, {
    fields: [competitorAnalyses.projectId],
    references: [projects.id],
  }),
}));

export const listingsRelations = relations(listings, ({ one, many }) => ({
  project: one(projects, {
    fields: [listings.projectId],
    references: [projects.id],
  }),
  versions: many(listingVersions),
}));

export const listingVersionsRelations = relations(listingVersions, ({ one }) => ({
  project: one(projects, {
    fields: [listingVersions.projectId],
    references: [projects.id],
  }),
}));

export const reviewImportsRelations = relations(reviewImports, ({ one }) => ({
  project: one(projects, {
    fields: [reviewImports.projectId],
    references: [projects.id],
  }),
  user: one(users, {
    fields: [reviewImports.userId],
    references: [users.id],
  }),
}));

export const projectFilesRelations = relations(projectFiles, ({ one, many }) => ({
  analysisVersions: many(analysisVersions),
  project: one(projects, {
    fields: [projectFiles.projectId],
    references: [projects.id],
  }),
  user: one(users, {
    fields: [projectFiles.userId],
    references: [users.id],
  }),
}));

export const analysisVersionsRelations = relations(analysisVersions, ({ one }) => ({
  file: one(projectFiles, {
    fields: [analysisVersions.projectFileId],
    references: [projectFiles.id],
  }),
  user: one(users, {
    fields: [analysisVersions.userId],
    references: [users.id],
  }),
}));

export const imageWorkflowSessionsRelations = relations(imageWorkflowSessions, ({ one }) => ({
  project: one(projects, {
    fields: [imageWorkflowSessions.projectId],
    references: [projects.id],
  }),
  user: one(users, {
    fields: [imageWorkflowSessions.userId],
    references: [users.id],
  }),
}));

export const competitorImageAnalysesRelations = relations(competitorImageAnalyses, ({ one }) => ({
  project: one(projects, {
    fields: [competitorImageAnalyses.projectId],
    references: [projects.id],
  }),
  user: one(users, {
    fields: [competitorImageAnalyses.userId],
    references: [users.id],
  }),
}));

export const expressionGroupsRelations = relations(expressionGroups, ({ one, many }) => ({
  images: many(expressionGroupImages),
  project: one(projects, {
    fields: [expressionGroups.projectId],
    references: [projects.id],
  }),
  user: one(users, {
    fields: [expressionGroups.userId],
    references: [users.id],
  }),
}));

export const expressionGroupImagesRelations = relations(expressionGroupImages, ({ one }) => ({
  group: one(expressionGroups, {
    fields: [expressionGroupImages.groupId],
    references: [expressionGroups.id],
  }),
  project: one(projects, {
    fields: [expressionGroupImages.projectId],
    references: [projects.id],
  }),
  user: one(users, {
    fields: [expressionGroupImages.userId],
    references: [users.id],
  }),
}));

export const aiJobsRelations = relations(aiJobs, ({ one }) => ({
  project: one(projects, {
    fields: [aiJobs.projectId],
    references: [projects.id],
  }),
  user: one(users, {
    fields: [aiJobs.userId],
    references: [users.id],
  }),
}));

export const aiJobDeadLettersRelations = relations(aiJobDeadLetters, ({ one }) => ({
  project: one(projects, {
    fields: [aiJobDeadLetters.projectId],
    references: [projects.id],
  }),
  user: one(users, {
    fields: [aiJobDeadLetters.userId],
    references: [users.id],
  }),
}));

export const emperorSkillsRelations = relations(emperorSkills, ({ many }) => ({
  runs: many(emperorSkillRuns),
}));

export const emperorSkillRunsRelations = relations(emperorSkillRuns, ({ one }) => ({
  skill: one(emperorSkills, {
    fields: [emperorSkillRuns.skillSlug],
    references: [emperorSkills.slug],
  }),
  user: one(users, {
    fields: [emperorSkillRuns.userId],
    references: [users.id],
  }),
}));

export const emperorAgentsRelations = relations(emperorAgents, ({ many }) => ({
  runs: many(emperorAgentRuns),
  templateVersions: many(emperorAgentTemplateVersions),
}));

export const emperorAgentTemplateVersionsRelations = relations(
  emperorAgentTemplateVersions,
  ({ one }) => ({
    agent: one(emperorAgents, {
      fields: [emperorAgentTemplateVersions.agentSlug],
      references: [emperorAgents.slug],
    }),
  }),
);

export const emperorAgentRunsRelations = relations(emperorAgentRuns, ({ one, many }) => ({
  agent: one(emperorAgents, {
    fields: [emperorAgentRuns.agentSlug],
    references: [emperorAgents.slug],
  }),
  artifacts: many(emperorAgentArtifacts),
  checkpoints: many(emperorAgentCheckpoints),
  events: many(emperorAgentEvents),
  project: one(projects, {
    fields: [emperorAgentRuns.projectId],
    references: [projects.id],
  }),
  user: one(users, {
    fields: [emperorAgentRuns.userId],
    references: [users.id],
  }),
}));

export const emperorAgentCheckpointsRelations = relations(emperorAgentCheckpoints, ({ one, many }) => ({
  artifacts: many(emperorAgentArtifacts),
  run: one(emperorAgentRuns, {
    fields: [emperorAgentCheckpoints.runId],
    references: [emperorAgentRuns.runId],
  }),
}));

export const emperorAgentEventsRelations = relations(emperorAgentEvents, ({ one }) => ({
  run: one(emperorAgentRuns, {
    fields: [emperorAgentEvents.runId],
    references: [emperorAgentRuns.runId],
  }),
}));

export const emperorAgentArtifactsRelations = relations(emperorAgentArtifacts, ({ one }) => ({
  checkpoint: one(emperorAgentCheckpoints, {
    fields: [emperorAgentArtifacts.runId, emperorAgentArtifacts.nodeId],
    references: [emperorAgentCheckpoints.runId, emperorAgentCheckpoints.nodeId],
  }),
  project: one(projects, {
    fields: [emperorAgentArtifacts.projectId],
    references: [projects.id],
  }),
  run: one(emperorAgentRuns, {
    fields: [emperorAgentArtifacts.runId],
    references: [emperorAgentRuns.runId],
  }),
  user: one(users, {
    fields: [emperorAgentArtifacts.userId],
    references: [users.id],
  }),
}));

export const emperorToolsRelations = relations(emperorTools, ({ many }) => ({
  runs: many(emperorToolRuns),
}));

export const emperorToolRunsRelations = relations(emperorToolRuns, ({ one }) => ({
  agentRun: one(emperorAgentRuns, {
    fields: [emperorToolRuns.agentRunId],
    references: [emperorAgentRuns.runId],
  }),
  project: one(projects, {
    fields: [emperorToolRuns.projectId],
    references: [projects.id],
  }),
  tool: one(emperorTools, {
    fields: [emperorToolRuns.toolSlug],
    references: [emperorTools.slug],
  }),
  user: one(users, {
    fields: [emperorToolRuns.userId],
    references: [users.id],
  }),
}));
