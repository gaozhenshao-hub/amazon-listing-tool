export type AdChannelName = "SP" | "SB" | "SD" | "DSP";

export type AdChannelMetric = {
  channel: string;
  cost: number;
  sales: number;
  acos: number;
  roas: number;
  orders: number;
  costShare: number;
};

export type AdConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AdRecord = Record<string, any>;
