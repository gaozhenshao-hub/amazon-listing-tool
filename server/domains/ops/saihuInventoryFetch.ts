import type mysql from 'mysql2/promise';
import {inventoryClient} from './saihuInventoryClient';
export async function fetchInventorySources(db:mysql.Connection,workspace:number,signal:AbortSignal,onProgress=(s:string)=>{}){
 const c=await inventoryClient(db,workspace,signal),data:Record<string,any[]>={};
 const requests:[string,string,Record<string,unknown>][]=[
  ['warehouses','/api/warehouseManage/warehouseList.json',{}],
  ['warehouse','/api/warehouseManage/warehouseItemList.json',{isHidden:'false'}],
  ['fba','/api/inventoryManage/fba/pageList.json',{currency:'CNY',hideZero:'false',hideDeletedPrd:'false',needMergeShare:'true',history:'false'}],
  ['commodities','/api/commodity/pageList.json',{isAllGroup:1}],
  ['aux','/api/commodity/aux/pageList.json',{}],
  ['auxParents','/api/commodity/pageList.json',{isAllGroup:1,relAuxFlag:1}],
  ['listings','/api/order/api/product/v2/pageList.json',{marketplaceIdList:['ATVPDKIKX0DER','A2EUQ1WTGCTBG2','A1AM78C64UM0Y8']}],
  ['shipping','/api/fba/shippingOrder/pageList/v2.json',{status:'3'}],
 ];
 for(const [key,path,body] of requests){onProgress(key);data[key]=await c.pages(path,body);onProgress(`${key}: ${data[key].length}`);}
 data.shippingItems=[];
 for(let i=0;i<data.shipping.length;i+=20){
  const sns=data.shipping.slice(i,i+20).map(r=>r.shipSn);
  const items=await c.read('/api/fba/shippingOrder/itemsBatch.json',{shipSnList:sns});
  if(!Array.isArray(items)||sns.some(sn=>!items.some(r=>r.shipSn===sn)))throw new Error('发货商品明细缺失，无法核实共享库存归属');
  data.shippingItems.push(...items);if(i%200===0)onProgress(`shippingItems: ${i}/${data.shipping.length}`);
 }
 data.details=[];
 for(const r of data.auxParents){const detail=await c.read('/api/commodity/v2/getCommodityDetail.json',{id:String(r.id)});if(String(detail?.id)!==String(r.id))throw new Error('辅料关联数据不完整');data.details.push(detail);}
 onProgress('complete');return {data,audit:c.audit};
}
