import { useCallback, useEffect, useReducer, type SetStateAction } from "react";
import { emptySellingPointPlanMetadata, recoverSellingPointPlan, sellingPointBuyerReason, type ReviewedCoreRecovery } from "./reviewRecovery";

function initialState(projectId: number | null | undefined) {
  return {
    projectId, points: null as Array<any | null> | null, metadata: emptySellingPointPlanMetadata(),
    sourceRunId: null as string | null, ignoredRunId: null as string | null, reviewedSignature: "",
    hydrated: false, dirty: false, dismissed: false, awaitingNewRun: false, restorationVersion: 0,
  };
}
type State = ReturnType<typeof initialState>;
type Action = { projectId: State["projectId"] } & (
  | { type: "project" }
  | { type: "edit"; update: SetStateAction<State["points"]> }
  | { type: "dirty" }
  | { type: "reset" }
  | { type: "prepare"; runId: string | null }
  | { type: "unsuccessful"; run?: { runId: string; status: string } }
  | { type: "restore"; runId: string | null; output: any; reviewedCores: ReviewedCoreRecovery[] }
);

function reducer(state: State, action: Action): State {
  if (action.type === "project") return state.projectId === action.projectId ? state : initialState(action.projectId);
  // Async work from a project that has been left must not mutate the current plan.
  if (state.projectId !== action.projectId) return state;
  if (action.type === "edit") return { ...state, dirty: true, points: typeof action.update === "function" ? action.update(state.points) : action.update };
  if (action.type === "dirty") return { ...state, dirty: true };
  if (action.type === "reset") return { ...initialState(action.projectId), dismissed: true, restorationVersion: state.restorationVersion };
  if (action.type === "prepare") return { ...initialState(action.projectId), ignoredRunId: action.runId, awaitingNewRun: true, restorationVersion: state.restorationVersion };
  if (action.type === "unsuccessful") {
    if (!state.awaitingNewRun || (action.run && (action.run.runId === state.ignoredRunId
      || !["failed", "canceled"].includes(action.run.status)))) return state;
    return { ...state, awaitingNewRun: false, ignoredRunId: null };
  }
  if (state.dismissed) return state;
  const usableRunId = action.runId !== state.ignoredRunId ? action.runId : null;
  if (state.dirty) {
    if (state.sourceRunId || !usableRunId || !state.metadata.missingPlanningMetadata) return state;
    // A late history response may fill missing read-only strategy, but must
    // leave edited cards, confirmation work and fact selections untouched.
    const recovered = recoverSellingPointPlan(action.output, action.reviewedCores);
    return { ...state, sourceRunId: usableRunId, metadata: { ...recovered.metadata,
      hasReviewedEdits: recovered.metadata.hasReviewedEdits || Boolean(state.points?.some((point, index) =>
        point && sellingPointBuyerReason(point) !== sellingPointBuyerReason(recovered.points?.[index]))),
    } };
  }
  // While a newly requested job is pending, do not immediately restore the plan it replaces.
  if (state.awaitingNewRun && !usableRunId) return state;
  const reviewedSignature = JSON.stringify(action.reviewedCores.map((core) => [core.id, core.revision, core.status, core.buyerReason, core.factRevisionIdsJson]));
  if (state.hydrated && (!usableRunId || usableRunId === state.sourceRunId) && reviewedSignature === state.reviewedSignature) return state;
  // A temporarily empty job query must not strip a complete plan already held
  // in memory. Refetching the same run still reconciles a newer review ledger.
  if (state.sourceRunId && !usableRunId) return state;
  const restored = recoverSellingPointPlan(usableRunId ? action.output : null, action.reviewedCores);
  if (!restored.points) return state;
  return { ...state, points: restored.points, metadata: restored.metadata, sourceRunId: usableRunId, reviewedSignature,
    hydrated: true, awaitingNewRun: false, restorationVersion: state.restorationVersion + 1 };
}

/** Read-only recovery is separate from edits: polling can never overwrite an operator's draft. */
export function useSellingPointPlanRecovery(projectId: number | null | undefined) {
  const [state, dispatch] = useReducer(reducer, projectId, initialState);
  useEffect(() => { dispatch({ type: "project", projectId }); }, [projectId]);
  const current = state.projectId === projectId ? state : initialState(projectId);
  const setPoints = useCallback((update: SetStateAction<State["points"]>) => dispatch({ type: "edit", projectId, update }), [projectId]);
  const markDirty = useCallback(() => dispatch({ type: "dirty", projectId }), [projectId]);
  const reset = useCallback(() => dispatch({ type: "reset", projectId }), [projectId]);
  const prepare = useCallback((runId: string | null) => dispatch({ type: "prepare", projectId, runId }), [projectId]);
  const settleUnsuccessfulAttempt = useCallback((run?: { runId: string; status: string }) =>
    dispatch({ type: "unsuccessful", projectId, run }), [projectId]);
  const restore = useCallback((runId: string | null, output: any, reviewedCores: ReviewedCoreRecovery[]) => {
    dispatch({ type: "restore", projectId, runId, output, reviewedCores });
  }, [projectId]);
  return { ...current, setPoints, markDirty, reset, prepare, restore, settleUnsuccessfulAttempt };
}
