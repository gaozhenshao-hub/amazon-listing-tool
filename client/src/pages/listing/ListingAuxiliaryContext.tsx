import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { listingAuxiliaryDraftHash, listingAuxiliaryCanonical as canonical, type ListingAuxiliaryPreviewInput, type ListingAuxiliaryCandidate, type ListingAuxiliaryApplyReceipt } from "@shared/listingAuxiliaryWorkflow";
import { useListingConfiguredGeneration } from "./ListingConfiguredGenerationContext";

type IntentOf<T> = T extends ListingAuxiliaryPreviewInput ? Omit<T, "expectedWorkspaceId" | "projectId" | "operationId"> : never;
export type ListingAuxiliaryIntent = IntentOf<ListingAuxiliaryPreviewInput>;
export type AuxiliaryApplication = Pick<ListingAuxiliaryApplyReceipt, "candidateIds" | "reportArtifactId">;
type Receiver = { fingerprint: string; accept: (candidate: ListingAuxiliaryCandidate, application?: AuxiliaryApplication) => void };
export type AuxiliaryBinding = { key: string; receiver: Receiver; intentHash: string; draftHash: string; selectionKey: string; accept?: Receiver["accept"] };
export type ListingAuxiliaryBridge = {
  intent: ListingAuxiliaryIntent | null;
  request: (intent: ListingAuxiliaryIntent, key: string, accept?: Receiver["accept"]) => boolean;
  capture: () => AuxiliaryBinding | null;
  current: (binding: AuxiliaryBinding | null) => boolean;
  deliver: (candidate: ListingAuxiliaryCandidate, binding: AuxiliaryBinding | null, application?: AuxiliaryApplication) => boolean;
  register: (key: string, receiver: Receiver) => () => void;
};
const Context = createContext<ListingAuxiliaryBridge | null>(null);
export const useListingAuxiliary = () => useContext(Context);
export function ListingAuxiliaryProvider({ children }: { children: ReactNode }) {
  const main = useListingConfiguredGeneration(), selectionKey = canonical([main?.enabled ?? true, main?.sourceSelection ?? null]), selection = useRef({ key: selectionKey, epoch: 0 });
  if (selection.current.key !== selectionKey) selection.current = { key: selectionKey, epoch: selection.current.epoch + 1 };
  const [intent, setIntent] = useState<ListingAuxiliaryIntent | null>(null), receivers = useRef(new Map<string, Receiver>()), selected = useRef<AuxiliaryBinding | null>(null);
  const register = useCallback((key: string, receiver: Receiver) => { receivers.current.set(key, receiver); return () => { if (receivers.current.get(key) === receiver) receivers.current.delete(key); }; }, []);
  const current = useCallback((binding: AuxiliaryBinding | null) => {
    if (!binding || selected.current !== binding) return false; const receiver = receivers.current.get(binding.key);
    return !!receiver && binding.selectionKey === canonical(selection.current) && receiver === binding.receiver;
  }, []);
  const bridge: ListingAuxiliaryBridge = { intent, register, current,
    request: (value, key, accept) => { const receiver = receivers.current.get(key); if (!receiver) return false;
      // Capture before preview and fee, never recapture at apply after an edit.
      selected.current = { key, receiver, intentHash: canonical(value), draftHash: listingAuxiliaryDraftHash(value), selectionKey: canonical(selection.current), accept }; setIntent(value); return true; },
    capture: () => current(selected.current) ? selected.current : null,
    deliver: (candidate, binding, application) => { if (!binding || candidate.draftHash !== binding.draftHash || !current(binding)) return false;
      (binding.accept ?? binding.receiver.accept)(candidate, application); return true; },
  };
  return <Context.Provider value={bridge}>{children}</Context.Provider>;
}
export function useListingAuxiliaryReceiver(key: string, fingerprint: string, accept: Receiver["accept"]) {
  const register = useListingAuxiliary()?.register, latest = useRef(accept); latest.current = accept;
  const [stable] = useState(() => (candidate: ListingAuxiliaryCandidate, application?: AuxiliaryApplication) => latest.current(candidate, application));
  useLayoutEffect(() => register?.(key, { fingerprint, accept: stable }), [register, key, fingerprint, stable]);
}
