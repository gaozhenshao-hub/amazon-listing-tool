import { failUnavailableDataSource } from "@shared/_core/errors";
import type { AdChannelName, AdRecord } from "./types";

function unavailableRows(): { data: AdRecord[]; _meta?: unknown } {
  return failUnavailableDataSource("广告数据连接器", { domain: "ads" });
}

export const adsRepository = {
  getDspOrders() {
    return unavailableRows();
  },

  getCampaignContext(_campaignId: string) {
    return unavailableRows();
  },

  getChannelRows(_channel: AdChannelName, _startDate: string, _endDate: string) {
    return unavailableRows();
  },
};

export type AdsRepository = typeof adsRepository;
