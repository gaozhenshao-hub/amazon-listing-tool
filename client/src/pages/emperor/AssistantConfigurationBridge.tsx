import { useEffect, useRef, useState } from "react";
import type { AgentLibraryKey } from "@shared/agentLibraryContracts";
import type {
  AssistantConfigurationMetadata, AssistantConfigurationRead, AssistantConfigurationOptions,
  AssistantConfigurationHistory,
} from "@shared/assistantConfigurations";
import { trpc } from "@/lib/trpc";
import AssistantConfigurationPanel, {
  type AssistantConfigurationPanelProps, type AssistantConfigurationReadState,
} from "./AssistantConfigurationPanel";

type Props = { agentKey: AgentLibraryKey; scopeKey: string; workspaceId: number; canEdit: boolean };
type ReadState<T> = AssistantConfigurationReadState<T>;

function denial(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { data?: { code?: string }; shape?: { data?: { code?: string } }; message?: string };
  const code = value.data?.code ?? value.shape?.data?.code;
  return code === "FORBIDDEN" || code === "UNAUTHORIZED" || value.message === "ASSISTANT_WORKSPACE_CHANGED";
}
function failure(error: unknown): { status: "error"; message: string } {
  return { status: "error", message: error instanceof Error ? error.message : "请求未完成，请刷新重试" };
}

/** A fresh, owned reader: never reuses another identity's fixed query-cache key. */
export default function AssistantConfigurationBridge(props: Props) {
  return <OwnedConfigurationBridge key={JSON.stringify([props.scopeKey, props.workspaceId, props.agentKey, props.canEdit])} {...props} />;
}

function OwnedConfigurationBridge({ agentKey, scopeKey, workspaceId, canEdit }: Props) {
  const client = trpc.useUtils().client.emperor.assistantConfigurations;
  const [metadata, setMetadata] = useState<ReadState<AssistantConfigurationMetadata>>({ status: "loading" });
  const [detail, setDetail] = useState<ReadState<AssistantConfigurationRead>>({ status: "loading" });
  const [options, setOptions] = useState<ReadState<AssistantConfigurationOptions>>({ status: "loading" });
  const [history, setHistory] = useState<ReadState<AssistantConfigurationHistory>>({ status: "loading" });
  const [reload, setReload] = useState(0);
  const [denied, setDenied] = useState(false);
  const lifecycle = useRef({ active: false, generation: 0, denied: false });
  const extraReads = useRef(new Set<AbortController>());
  const pagePending = useRef(false);
  const scope = { expectedWorkspaceId: workspaceId };

  function revoke(error: unknown) {
    if (!lifecycle.current.active || !denial(error)) return;
    lifecycle.current.denied = true;
    setDenied(true);
    // Remove full prompts, local drafts, previews and histories immediately.
    setDetail({ status: "error", message: "配置权限或工作区已变更" });
    setOptions({ status: "error", message: "配置权限或工作区已变更" });
    setHistory({ status: "error", message: "配置权限或工作区已变更" });
    for (const controller of extraReads.current) controller.abort();
  }

  useEffect(() => {
    const state = lifecycle.current;
    state.active = true;
    const generation = ++state.generation;
    const controller = new AbortController();
    const pendingReads = extraReads.current;
    const current = () => state.active && generation === state.generation;
    const privateCurrent = () => current() && !state.denied;
    const ready = <T,>(data: T): ReadState<T> => ({ status: "ready", scopeKey, data });
    setMetadata({ status: "loading" });
    void client.listMetadata.query({ expectedWorkspaceId: workspaceId }, { signal: controller.signal }).then(result => {
      if (!current()) return;
      const item = result.items.find(row => row.agentKey === agentKey);
      setMetadata(item ? ready(item) : { status: "error", message: "配置目录未返回所选角色，未视为未配置" });
    }).catch(error => {
      if (!current()) return;
      revoke(error); setMetadata(failure(error));
    });
    if (canEdit && !state.denied) {
      setDetail({ status: "loading" }); setOptions({ status: "loading" }); setHistory({ status: "loading" });
      void client.get.query({ expectedWorkspaceId: workspaceId, agentKey }, { signal: controller.signal })
        .then(data => { if (privateCurrent()) setDetail(ready(data)); })
        .catch(error => { if (privateCurrent()) { revoke(error); if (!state.denied) setDetail(failure(error)); } });
      void client.options.query({ expectedWorkspaceId: workspaceId }, { signal: controller.signal })
        .then(data => { if (privateCurrent()) setOptions(ready(data)); })
        .catch(error => { if (privateCurrent()) { revoke(error); if (!state.denied) setOptions(failure(error)); } });
      void client.history.query({ expectedWorkspaceId: workspaceId, agentKey, limit: 10 }, { signal: controller.signal })
        .then(data => { if (privateCurrent()) setHistory(ready(data)); })
        .catch(error => { if (privateCurrent()) { revoke(error); if (!state.denied) setHistory(failure(error)); } });
    }
    return () => {
      state.active = false; state.generation += 1; controller.abort(); pagePending.current = false;
      for (const pending of pendingReads) pending.abort();
      pendingReads.clear();
    };
    // The keyed owner fixes identity, role and workspace for its lifetime.
  }, [client, agentKey, scopeKey, workspaceId, canEdit, reload]);

  const writesEnabled = canEdit && !denied && options.status === "ready"
    && options.scopeKey === scopeKey && options.data.writeEnabled === true;
  function requirePrivateAccess(write = false) {
    if (!lifecycle.current.active || lifecycle.current.denied || !canEdit || (write && !writesEnabled)) {
      throw new Error("配置权限或保存开关不可用，请重新读取");
    }
  }

  const onSave: AssistantConfigurationPanelProps["onSave"] = async input => {
    requirePrivateAccess(true);
    try { return await client.save.mutate({ ...input, ...scope }); }
    catch (error) { revoke(error); throw error; }
  };
  const onRestore: AssistantConfigurationPanelProps["onRestore"] = async input => {
    requirePrivateAccess(true);
    try { return await client.rollback.mutate({ ...input, ...scope }); }
    catch (error) { revoke(error); throw error; }
  };
  const onReadVersion: AssistantConfigurationPanelProps["onReadVersion"] = async input => {
    requirePrivateAccess();
    const controller = new AbortController(); extraReads.current.add(controller);
    const generation = lifecycle.current.generation;
    try {
      const result = await client.getVersion.query({ ...input, ...scope }, { signal: controller.signal });
      requirePrivateAccess();
      if (generation !== lifecycle.current.generation) throw new Error("读取已过期，请重新选择版本");
      return result;
    } catch (error) { revoke(error); throw error; }
    finally { extraReads.current.delete(controller); }
  };

  async function loadHistoryPage(beforeRevision: number) {
    if (!lifecycle.current.active || lifecycle.current.denied || !canEdit
      || pagePending.current || history.status !== "ready" || history.scopeKey !== scopeKey
      || history.data.nextBeforeRevision !== beforeRevision) return;
    pagePending.current = true;
    const controller = new AbortController(); extraReads.current.add(controller);
    const generation = lifecycle.current.generation;
    try {
      const page = await client.history.query({ ...scope, agentKey, beforeRevision, limit: 10 }, { signal: controller.signal });
      if (!lifecycle.current.active || lifecycle.current.denied || generation !== lifecycle.current.generation) return;
      setHistory(previous => {
        if (previous.status !== "ready" || previous.scopeKey !== scopeKey || previous.data.nextBeforeRevision !== beforeRevision) return previous;
        const seen = new Set(previous.data.versions.map(item => item.revision));
        return { ...previous, data: { versions: [...previous.data.versions, ...page.versions.filter(item => !seen.has(item.revision))], nextBeforeRevision: page.nextBeforeRevision } };
      });
    } catch (error) {
      if (lifecycle.current.active && generation === lifecycle.current.generation && !lifecycle.current.denied) {
        revoke(error); if (!lifecycle.current.denied) setHistory(failure(error));
      }
    } finally {
      extraReads.current.delete(controller);
      if (generation === lifecycle.current.generation) pagePending.current = false;
    }
  }

  return <>
    {denied && <p role="alert" className="text-sm text-amber-300">配置权限或工作区已变更，完整配置和草稿已关闭。请刷新登录状态后重新进入。</p>}
    <AssistantConfigurationPanel agentKey={agentKey} scopeKey={scopeKey} canEdit={canEdit && !denied}
      writesEnabled={writesEnabled} metadata={metadata} detail={denied ? undefined : detail}
      options={denied ? undefined : options} history={denied ? undefined : history}
      onSave={onSave} onRestore={onRestore} onReadVersion={onReadVersion}
      onReload={() => setReload(value => value + 1)} onLoadHistoryPage={before => { void loadHistoryPage(before); }} />
  </>;
}
