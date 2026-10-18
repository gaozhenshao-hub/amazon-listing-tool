import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { ListingConfiguredOperation } from "@shared/listingConfiguredWorkflow";

export type ListingConfiguredIntent = { operation: ListingConfiguredOperation; analysisIds: number[]; coreRevisionIds: number[]; emphasis: string | null };
type Receiver = { fingerprint: string; accept: (outputs: Record<string, unknown>) => void };
type Context = {
  enabled: boolean; setEnabled: (value: boolean) => void;
  intent: ListingConfiguredIntent | null;
  request: (intent: ListingConfiguredIntent) => void;
  sourceSelection: { analysisIds: number[] | null; coreRevisionIds: number[] };
  setSourceSelection: (value: { analysisIds: number[] | null; coreRevisionIds: number[] }) => void;
  register: (key: string, receiver: Receiver) => () => void;
  capture: () => Map<string, Receiver>;
  deliver: (outputs: Record<string, unknown>, captured: Map<string, Receiver> | null) => boolean;
};
const ListingConfiguredContext = createContext<Context | null>(null);
export const useListingConfiguredGeneration = () => useContext(ListingConfiguredContext);
export function ListingConfiguredGenerationProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(false), [intent, setIntent] = useState<ListingConfiguredIntent | null>(null);
  const [sourceSelection, setSourceSelection] = useState<Context["sourceSelection"]>({ analysisIds: null, coreRevisionIds: [] });
  const receivers = useRef(new Map<string, Receiver>());
  const register = useCallback((key: string, value: Receiver) => { receivers.current.set(key, value); return () => { if (receivers.current.get(key) === value) receivers.current.delete(key); }; }, []);
  const api: Context = { enabled, setEnabled, intent, request: setIntent, sourceSelection, setSourceSelection, register,
    capture: () => new Map(receivers.current),
    deliver: (outputs, captured) => {
      let delivered = false;
      for (const [key, receiver] of receivers.current) {
        if (!Object.hasOwn(outputs, key.split(":")[0])) continue;
        const previous = captured?.get(key);
        // A restored receipt never implicitly applies into this tab's unsent draft.
        if (!previous || previous.fingerprint !== receiver.fingerprint || previous.accept !== receiver.accept) continue;
        receiver.accept(outputs); delivered = true;
      }
      return delivered;
    },
  };
  return <ListingConfiguredContext.Provider value={api}>{children}</ListingConfiguredContext.Provider>;
}
export function useListingConfiguredReceiver(key: string, fingerprint: string, accept: (outputs: Record<string, unknown>) => void) {
  const context = useListingConfiguredGeneration(), latest = useRef(accept); latest.current = accept;
  const [stable] = useState(() => (outputs: Record<string, unknown>) => latest.current(outputs));
  const register = context?.register;
  useEffect(() => register?.(key, { fingerprint, accept: stable }), [register, key, fingerprint, stable]);
}
