import type mysql from 'mysql2/promise';
import {resolveImportedProductOwner} from './importedProductOwners';
import {splitExternalOperatorNames} from './operatorNameResolution';
import type {InventoryRow} from '../../../shared/inventorySnapshot';
export async function inventoryMembers(db:mysql.Connection,workspace:number){const [rows]:any=await db.query("SELECT DISTINCT u.id,u.name,u.email,u.role FROM users u JOIN workspace_memberships m ON m.userId=u.id AND m.workspaceId=? AND m.status='active' WHERE u.status='active' ORDER BY u.name,u.id",[workspace]);return rows;}
export async function enrichInventoryOwners(db:mysql.Connection,workspace:number,rows:InventoryRow[]){
 const users=await inventoryMembers(db,workspace);
 const [profiles]:any=await db.query('SELECT parent_asin AS parentAsin,chinese_name AS chineseName,title FROM product_profiles WHERE workspaceId=? ORDER BY updatedAt DESC,id DESC',[workspace]);
 const parentNames=new Map<string,string>();for(const p of profiles)if(p.parentAsin&&!parentNames.has(p.parentAsin)&&(p.chineseName||p.title))parentNames.set(p.parentAsin,p.chineseName||p.title);
 const [mappings]:any=await db.query('SELECT external_name AS externalName,system_user_name AS systemUserName,source_type AS sourceType FROM operator_name_mappings WHERE workspaceId=? AND is_confirmed=1',[workspace]);
 const [rules]:any=await db.query('SELECT parent_asin AS parentAsin,store_name AS storeName,country,assignee_name AS assigneeName,is_active AS isActive FROM ops_inventory_owner_assignments WHERE workspaceId=? AND is_active=1',[workspace]);
 const [daily]:any=await db.query("SELECT * FROM (SELECT asin,parent_asin AS parentAsin,product_name AS title,operator,store_name AS storeName,site,ROW_NUMBER() OVER(PARTITION BY asin ORDER BY CASE WHEN site IN ('US','美国','美国站') THEN 0 ELSE 1 END,import_id DESC,report_date DESC,id DESC) rn FROM saihu_product_weekly WHERE workspaceId=? AND asin IS NOT NULL AND report_level<>'parent') t WHERE rn=1",[workspace]);
 const byAsin=new Map<string,any>(daily.map((r:any)=>[r.asin,r]));const lookup=new Map<string,string>();
 for(const source of ['all','saihu'])for(const m of mappings)if(m.sourceType===source&&m.systemUserName)lookup.set(m.externalName,m.systemUserName);
 for(const u of users)if(u.name)lookup.set(u.name,u.name);
 for(const r of rows){if(!r.asin)continue;const old=byAsin.get(r.asin);const source={...old,parentAsin:r.parentAsin||old?.parentAsin||r.asin,marketplace:'US',operator:r.operator||old?.operator||''};
  const owner=resolveImportedProductOwner(source,lookup,rules);const names=splitExternalOperatorNames(owner.operator);
  r.ownerIds=users.filter((u:any)=>names.includes(u.name)).map((u:any)=>Number(u.id));r.operator=names.join('/');r.parentAsin=source.parentAsin;r.parentName=parentNames.get(source.parentAsin)||byAsin.get(source.parentAsin)?.title||old?.title||r.parentName||r.name;
 }
 return users;
}
