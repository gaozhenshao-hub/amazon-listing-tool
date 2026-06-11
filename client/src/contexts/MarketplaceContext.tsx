import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { trpc } from '@/lib/trpc';

interface Marketplace {
  code: string;
  name: string;
  region: string;
  sids: string[];
  storeNames: string[];
}

interface MarketplaceContextType {
  marketplace: string;
  setMarketplace: (mp: string) => void;
  marketplaces: Marketplace[];
  isLoading: boolean;
  currentMarketplace: Marketplace | null;
}

const MarketplaceContext = createContext<MarketplaceContextType>({
  marketplace: 'US',
  setMarketplace: () => {},
  marketplaces: [],
  isLoading: true,
  currentMarketplace: null,
});

export function MarketplaceProvider({ children }: { children: ReactNode }) {
  const [marketplace, setMarketplaceState] = useState<string>('US');
  
  // Fetch available marketplaces
  const { data: marketplaces = [], isLoading: mpLoading } = trpc.operations.getMarketplaces.useQuery();
  
  // Fetch user settings to get default marketplace
  const { data: settings, isLoading: settingsLoading } = trpc.operations.getUserSettings.useQuery();
  
  // Save setting mutation
  const saveSetting = trpc.operations.saveUserSetting.useMutation();
  
  // Initialize from user settings
  useEffect(() => {
    if (settings && settings.default_marketplace) {
      setMarketplaceState(settings.default_marketplace);
    }
  }, [settings]);
  
  const setMarketplace = (mp: string) => {
    setMarketplaceState(mp);
    // Auto-save as default preference
    saveSetting.mutate({ key: 'default_marketplace', value: mp });
  };
  
  const currentMarketplace = marketplaces.find((m: Marketplace) => m.code === marketplace) || null;
  
  return (
    <MarketplaceContext.Provider value={{
      marketplace,
      setMarketplace,
      marketplaces,
      isLoading: mpLoading || settingsLoading,
      currentMarketplace,
    }}>
      {children}
    </MarketplaceContext.Provider>
  );
}

export function useMarketplace() {
  return useContext(MarketplaceContext);
}
