import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { projectRouter } from "./routers/project";
import { analysisRouter } from "./routers/analysis";
import { listingRouter } from "./routers/listing";
import { imageAnalysisRouter } from "./routers/imageAnalysis";
import { projectFileRouter } from "./routers/projectFile";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  project: projectRouter,
  analysis: analysisRouter,
  listing: listingRouter,
  imageAnalysis: imageAnalysisRouter,
  projectFile: projectFileRouter,
});

export type AppRouter = typeof appRouter;
