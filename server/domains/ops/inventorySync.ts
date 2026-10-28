import type mysql from 'mysql2/promise';
import {gzipSync} from 'node:zlib';
import {fetchInventorySources} from './saihuInventoryFetch';
import {mapInventory} from './inventoryMapping';
import {enrichInventoryOwners} from './inventoryMetadata';
export async function syncInventory(db:mysql.Connection,run:any,signal:AbortSignal){
 const startedAt=Date.now(),{data,audit}=await fetchInventorySources(db,run.workspace_id,signal);
 signal.throwIfAborted();const snapshot=mapInventory(data,startedAt);await enrichInventoryOwners(db,run.workspace_id,snapshot.rows);
 const raw=JSON.stringify({encoding:'gzip-base64',data:gzipSync(JSON.stringify(audit)).toString('base64')});
 await db.beginTransaction();try{
  signal.throwIfAborted();
  await db.query('INSERT INTO ops_inventory_snapshots (workspace_id,run_id,captured_at,payload) VALUES (?,?,?,?)',[run.workspace_id,run.id,snapshot.capturedAt,JSON.stringify(snapshot)]);
  await db.query("UPDATE ops_saihu_sync_runs SET status='success',finished_at=?,row_count=?,message=?,raw_payload=? WHERE id=? AND workspace_id=?",[Date.now(),snapshot.rows.length,`已更新 ${snapshot.rows.length} 条库存，CNY；${snapshot.warnings.length} 项待核对`,raw,run.id,run.workspace_id]);await db.commit();
 }catch(e){await db.rollback();throw e;}
}
