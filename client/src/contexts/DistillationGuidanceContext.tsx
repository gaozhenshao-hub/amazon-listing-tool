import { createContext, useContext } from "react";
import type { DistillationBinding } from "@/components/workflow/DistillationGuidancePicker";

const DistillationGuidanceContext = createContext<DistillationBinding | null>(null);

export function DistillationGuidanceProvider({ value, children }: { value: DistillationBinding; children: React.ReactNode }) {
  return <DistillationGuidanceContext.Provider value={value}>{children}</DistillationGuidanceContext.Provider>;
}

export function useDistillationGuidance() {
  return useContext(DistillationGuidanceContext);
}
