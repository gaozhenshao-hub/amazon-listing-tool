import { createContext, useContext, type ReactNode } from "react";
const marketplace = { code: "US", name: "美国站 · USD（合并加拿大、墨西哥）", region: "NA", sids: [] as string[], storeNames: [] as string[] };
const value = { marketplace: "US", setMarketplace: (_value: string) => {}, marketplaces: [marketplace], isLoading: false, currentMarketplace: marketplace };
const MarketplaceContext = createContext(value);
export function MarketplaceProvider({ children }: { children: ReactNode }) {
  return <MarketplaceContext.Provider value={value}>{children}</MarketplaceContext.Provider>;
}
export function useMarketplace() { return useContext(MarketplaceContext); }
