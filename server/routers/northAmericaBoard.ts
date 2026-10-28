import { router, protectedProcedure } from "../_core/trpc";
import { NorthAmericaBoardInputSchema, NorthAmericaNoteInputSchema } from "../../shared/northAmericaBoard";
import { northAmericaBoardRepository } from "../domains/ops/northAmericaBoardRepository";
export const northAmericaBoardRouter=router({
  trends:protectedProcedure.input(NorthAmericaBoardInputSchema).query(async ({ctx,input})=>{
    const result=await northAmericaBoardRepository.read(ctx,input);
    // Overview cards need only chart values, not every child, source reference,
    // ranking and snapshot note returned by the full financial board.
    return {identity:result.identity,payload:result.payload ? {
      country:result.payload.country,currency:result.payload.currency,
      products:result.payload.products.map(product=>({asin:product.asin,storeName:product.storeName,
        months:Object.fromEntries(Object.entries(product.months).map(([month,value])=>[month,{metrics:{financialProfit:value.metrics.financialProfit}}]))})),
    } : null};
  }),
  get:protectedProcedure.input(NorthAmericaBoardInputSchema).query(({ctx,input})=>northAmericaBoardRepository.read(ctx,input)),
  saveNote:protectedProcedure.input(NorthAmericaNoteInputSchema).mutation(({ctx,input})=>northAmericaBoardRepository.saveNote(ctx,input)),
});
