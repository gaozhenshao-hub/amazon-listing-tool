import { retiredFeatureError } from "@shared/_core/errors";
import * as shared from "../routerContext";

const { protectedProcedure } = shared;

type LegacySyncResult = {
  synced: number;
  skipped: number;
  updated: number;
  total: number;
};

export const opsSyncProcedures = {
  /** Compatibility endpoint. Product data now enters through the audited import pipeline. */
  syncFromLingxing: protectedProcedure.mutation((): LegacySyncResult => {
    throw retiredFeatureError(
      "运营产品领星直连同步",
      "dataImport.uploadAndParse",
      {
        replacementProcedure: "dataImport.uploadAndParse",
        migrationReason: "领星直连已移除，避免用空响应伪造同步成功",
      },
    );
  }),
};
