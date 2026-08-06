import { router } from "../../_core/trpc";
import { protectedProcedure } from "./procedure";
import {
  adChatInput,
  adDateRangeInput,
  channelStrategyInput,
  dspStrategyInput,
} from "./schema";
import { adsAnalysisService as service } from "./service";

export const adsAnalysisRouter = router({
  getDspReport: protectedProcedure.input(adDateRangeInput).query(({ input }) => service.getDspReport(input)),
  aiDspStrategy: protectedProcedure.input(dspStrategyInput).mutation(({ input }) => service.aiDspStrategy(input)),
  adChatBot: protectedProcedure.input(adChatInput).mutation(({ input }) => service.adChatBot(input)),
  getCrossChannelData: protectedProcedure.input(adDateRangeInput).query(({ input }) => service.getCrossChannelData(input)),
  aiChannelStrategy: protectedProcedure.input(channelStrategyInput).mutation(({ input }) => service.aiChannelStrategy(input)),
});
