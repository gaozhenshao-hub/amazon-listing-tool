export type RuntimeRole = "web" | "worker" | "scheduler" | "all";

const RUNTIME_ROLES = new Set<RuntimeRole>([
  "web",
  "worker",
  "scheduler",
  "all",
]);

export function getRuntimeRole(
  env: NodeJS.ProcessEnv = process.env
): RuntimeRole {
  const explicitRole = env.APP_PROCESS_ROLE || env.PROCESS_ROLE;
  if (explicitRole && RUNTIME_ROLES.has(explicitRole as RuntimeRole)) {
    return explicitRole as RuntimeRole;
  }

  if (env.AI_JOB_RUNNER_MODE === "worker") return "worker";
  if (env.SCHEDULER_ENABLED === "true" || env.RUN_SCHEDULER === "true")
    return "scheduler";
  if (env.NODE_ENV !== "production") return "all";
  return "web";
}

export function isRuntimeRoleEnabled(
  current: RuntimeRole,
  target: RuntimeRole
): boolean {
  return current === "all" || current === target;
}

export function shouldStartWebServer(role = getRuntimeRole()): boolean {
  return isRuntimeRoleEnabled(role, "web");
}

export function shouldStartWebLocalTasks(role = getRuntimeRole()): boolean {
  return isRuntimeRoleEnabled(role, "web");
}

export function shouldStartSchedulerTasks(role = getRuntimeRole()): boolean {
  return isRuntimeRoleEnabled(role, "scheduler");
}

export function shouldStartWorkerTasks(role = getRuntimeRole()): boolean {
  return isRuntimeRoleEnabled(role, "worker");
}

export function describeRuntimeRole(role = getRuntimeRole()) {
  return {
    role,
    web: shouldStartWebServer(role),
    webLocalTasks: shouldStartWebLocalTasks(role),
    workerTasks: shouldStartWorkerTasks(role),
    schedulerTasks: shouldStartSchedulerTasks(role),
  };
}
