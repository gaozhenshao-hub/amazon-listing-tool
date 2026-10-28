import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "../../_core/context";
import { getDb, type DbExecutor } from "../../repositories/dbClient";
import { assertResourceAction } from "../../services/securityGovernance";
import { NorthAmericaBoardInputSchema, NorthAmericaNoteInputSchema, type NorthAmericaBoardInput } from "../../../shared/northAmericaBoard";
import type { z } from "zod";
import { positiveId, query, type Session } from "./monthlyBoardReadCore";
import { filterNorthAmericaBoardAccess, readNorthAmericaFinancialSources, readNorthAmericaOwnership } from "./northAmericaBoardSources";
import { filterNorthAmericaEdition, legacyNorthAmericaHistory, northAmericaHistory, readLegacyNorthAmericaEdition, readNorthAmericaEdition, writeNorthBoardSql } from "./northAmericaBoardArchive";

type Database = { transaction<T>(body:(tx:DbExecutor)=>Promise<T>):Promise<T> };
export function createNorthAmericaBoardRepository(dependencies:{ database?:()=>Promise<Database|null>; permission?:typeof assertResourceAction }={}) {
  const database=dependencies.database??getDb, permission=dependencies.permission??assertResourceAction;
  async function read(ctx:TrpcContext, raw:NorthAmericaBoardInput) {
    try {
      if (!ctx.user) throw new TRPCError({code:"UNAUTHORIZED",message:"NA_BOARD_LOGIN_REQUIRED"});
      const input=NorthAmericaBoardInputSchema.parse(raw), workspaceId=ctx.workspaceId??ctx.user.defaultWorkspaceId;
      if (!positiveId(workspaceId)||workspaceId!==input.expectedWorkspaceId||!positiveId(ctx.user.id)) throw new TRPCError({code:"FORBIDDEN",message:"NA_BOARD_SCOPE_CHANGED"});
      const db=await database(); if (!db) throw new Error("database unavailable");
      return await db.transaction(async tx=>{
        const actors=await query(tx,"SELECT id,role,status,defaultWorkspaceId FROM users WHERE id=? FOR SHARE",[ctx.user!.id]), actor=actors[0];
        if (actors.length!==1||actor.id!==ctx.user!.id||actor.role!==ctx.user!.role||actor.status!=="active"||actor.defaultWorkspaceId!==workspaceId) throw new TRPCError({code:"FORBIDDEN",message:"NA_BOARD_ACTOR_CHANGED"});
        await permission({actor:{id:actor.id as number,role:actor.role as string,defaultWorkspaceId:workspaceId},resource:"ops_data",action:"read",workspaceId,authorizationRead:{executor:tx,strict:true,lock:true}});
        const session:Session={tx,identity:{userId:actor.id as number,workspaceId},manager:["admin","super_admin","ops_manager"].includes(actor.role as string)};
        const sources=await readNorthAmericaFinancialSources(session), ownership=await readNorthAmericaOwnership(session,sources.rows);
        const history=await northAmericaHistory(session),legacyHistory=await legacyNorthAmericaHistory(session);
        const live=filterNorthAmericaBoardAccess(session,ownership,sources.rows,input.operatorId);
        if(input.legacyEditionId) return {identity:session.identity,...live,payload:null,edition:null,notes:[],history,legacyHistory,legacy:await readLegacyNorthAmericaEdition(session,input.legacyEditionId,ownership,input.operatorId)};
        const selectedMonth=input.month??live.payload?.month,edition=selectedMonth?await readNorthAmericaEdition(session,selectedMonth):null;
        if(input.month&&!edition)throw new Error("NA_ARCHIVE_MISSING");
        const payload=input.month&&edition?filterNorthAmericaEdition(edition.payload,session,ownership,input.operatorId):live.payload;
        const keys=new Set(payload?.products.map(product=>JSON.stringify([product.storeName,product.asin]))??[]);
        const notes=edition?await query(tx,"SELECT store_name AS storeName,parent_asin AS parentAsin,note,version FROM ops_north_america_notes WHERE workspace_id=? AND edition_id=?",[workspaceId,edition.id]):[];
        return {identity:session.identity,...live,payload,edition:edition?{id:edition.id,archived:edition.archived}:null,history,legacyHistory,legacy:null,
          notes:notes.filter(note=>keys.has(JSON.stringify([note.storeName,note.parentAsin]))).map(note=>({storeName:String(note.storeName),parentAsin:String(note.parentAsin),note:String(note.note),version:Number(note.version)}))};
      });
    } catch (error) {
      if (error instanceof TRPCError&&["UNAUTHORIZED","FORBIDDEN"].includes(error.code)) throw new TRPCError({code:error.code,message:"NA_BOARD_ACCESS_DENIED"});
      if (error instanceof Error&&error.message==="NA_BOARD_OPERATOR_DENIED") throw new TRPCError({code:"FORBIDDEN",message:error.message});
      throw new TRPCError({code:"PRECONDITION_FAILED",message:"NA_BOARD_SOURCE_NOT_VERIFIED"});
    }
  }
  async function saveNote(ctx:TrpcContext, raw:z.infer<typeof NorthAmericaNoteInputSchema>) {
    try {
      const input=NorthAmericaNoteInputSchema.parse(raw), workspaceId=ctx.workspaceId??ctx.user?.defaultWorkspaceId;
      if(!ctx.user||!positiveId(workspaceId)||workspaceId!==input.expectedWorkspaceId)throw new TRPCError({code:"FORBIDDEN",message:"NA_BOARD_ACCESS_DENIED"});
      const db=await database();if(!db)throw new Error();
      return await db.transaction(async tx=>{
        const actors=await query(tx,"SELECT id,role,status,defaultWorkspaceId FROM users WHERE id=? FOR SHARE",[ctx.user!.id]),actor=actors[0];
        if(actors.length!==1||actor.id!==ctx.user!.id||actor.role!==ctx.user!.role||actor.status!=="active"||actor.defaultWorkspaceId!==workspaceId)throw new TRPCError({code:"FORBIDDEN",message:"NA_BOARD_ACCESS_DENIED"});
        await permission({actor:{id:actor.id as number,role:actor.role as string,defaultWorkspaceId:workspaceId},resource:"ops_data",action:"update",workspaceId,authorizationRead:{executor:tx,strict:true,lock:true}});
        const session:Session={tx,identity:{workspaceId,userId:actor.id as number},manager:["admin","super_admin","ops_manager"].includes(actor.role as string)};
        const locks=await query(tx,"SELECT id FROM workspaces WHERE id=? FOR UPDATE",[workspaceId]);if(locks.length!==1)throw new Error();
        const editions=await query(tx,"SELECT month FROM ops_north_america_editions WHERE workspace_id=? AND id=? AND archived_at IS NULL LIMIT 2 FOR UPDATE",[workspaceId,input.editionId]);
        if(editions.length!==1)throw new TRPCError({code:"CONFLICT",message:"NA_BOARD_ARCHIVE_READONLY"});
        const edition=await readNorthAmericaEdition(session,String(editions[0].month));
        if(!edition?.payload.products.some(product=>product.asin===input.parentAsin&&product.storeName===input.storeName))throw new TRPCError({code:"FORBIDDEN",message:"NA_BOARD_ACCESS_DENIED"});
        const sources=await readNorthAmericaFinancialSources(session), ownership=await readNorthAmericaOwnership(session,sources.rows);
        if(!session.manager&&!ownership.owners.some(owner=>owner.storeName===input.storeName&&owner.parentAsin===input.parentAsin&&owner.ownerIds.includes(session.identity.userId)))throw new TRPCError({code:"FORBIDDEN",message:"NA_BOARD_ACCESS_DENIED"});
        const notes=await query(tx,"SELECT version FROM ops_north_america_notes WHERE workspace_id=? AND edition_id=? AND store_name=? AND parent_asin=? FOR UPDATE",[workspaceId,input.editionId,input.storeName,input.parentAsin]);
        if(notes.length>1||Number(notes[0]?.version??0)!==input.expectedVersion)throw new TRPCError({code:"CONFLICT",message:"NA_BOARD_NOTE_CHANGED"});
        const version=input.expectedVersion+1;
        await writeNorthBoardSql(session,`INSERT INTO ops_north_america_notes(workspace_id,edition_id,store_name,parent_asin,note,version,updated_by) VALUES (?,?,?,?,?,?,?) AS incoming
          ON DUPLICATE KEY UPDATE note=incoming.note,version=incoming.version,updated_by=incoming.updated_by,updated_at=CURRENT_TIMESTAMP(3)`,[workspaceId,input.editionId,input.storeName,input.parentAsin,input.note,version,session.identity.userId]);
        return {saved:true as const,version};
      });
    } catch(error) {
      if(error instanceof TRPCError&&["FORBIDDEN","CONFLICT"].includes(error.code))throw new TRPCError({code:error.code,message:error.code==="FORBIDDEN"?"NA_BOARD_ACCESS_DENIED":"NA_BOARD_NOTE_CHANGED_OR_ARCHIVED"});
      throw new TRPCError({code:"PRECONDITION_FAILED",message:"NA_BOARD_NOTE_NOT_CONFIRMED"});
    }
  }
  return {read,saveNote};
}
export const northAmericaBoardRepository=createNorthAmericaBoardRepository();
