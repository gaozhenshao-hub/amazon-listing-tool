import { TRPCError } from "@trpc/server";

export function assertSkillDistillationGovernor(user: { role?: string | null }) {
  if (user.role !== "super_admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "知识蒸馏项目、来源、草案和发布仅允许超级管理员管理",
    });
  }
}

export function isSkillDistillationGovernor(user: { role?: string | null }) {
  return user.role === "super_admin";
}
