export type StockValue={quantity:number;value:number|null};
export type InventoryAux={id:string;sku:string;name:string;stock:StockValue;shared:boolean;note:string};
export type InventoryAge={days181To270:number|null;days271To365:number|null;days365Plus:number|null;dates:string[]};
export type InventoryRow={
 id:string;parentAsin:string;parentName:string;asin:string;msku:string;localSku:string;commodityId:string;name:string;
 ownerIds:number[];operator:string;unpaired:boolean;allocation:string;lastShipment:string|null;
 plan:number;domestic:StockValue;purchase:StockValue;shipping:StockValue;fba:StockValue;total:StockValue;
 aux:InventoryAux[];notes:string[];age?:InventoryAge;
};
export type InventorySnapshot={version:1;currency:'CNY';capturedAt:number;startedAt:number;rows:InventoryRow[];warnings:string[];sourceCounts:Record<string,number>};
export const stockKeys=['domestic','purchase','shipping','fba','total'] as const;
export const stockLabels={domestic:'国内仓',purchase:'采购在途（已下单）',shipping:'FBA在途',fba:'FBA仓',total:'总库存'};
export function sumStock(values:StockValue[]):StockValue{return {quantity:values.reduce((s,v)=>s+v.quantity,0),value:values.some(v=>v.value==null)?null:Math.round(values.reduce((s,v)=>s+v.value!,0)*10000)/10000};}
export function inventoryTotals(rows:InventoryRow[]){
 const stocks=Object.fromEntries(stockKeys.map(k=>[k,sumStock(rows.map(r=>r[k]))])) as Record<typeof stockKeys[number],StockValue>;
 const aux=new Map<string,InventoryAux>();for(const r of rows)for(const a of r.aux)aux.set(a.id,a);
 return {...stocks,plan:rows.reduce((s,r)=>s+r.plan,0),aux:sumStock([...aux.values()].map(a=>a.stock))};
}
export function inventoryView(rows:InventoryRow[],allowed:number[]|null,operator?:number,unpaired=false,search=''){
 const key=search.trim().toLocaleLowerCase();return rows.filter(r=>(allowed===null||r.ownerIds.some(id=>allowed.includes(id)))&&(!operator||r.ownerIds.includes(operator))&&(!unpaired||r.unpaired)&&(!key||[r.parentAsin,r.parentName,r.asin,r.msku,r.localSku,r.name].some(v=>v.toLocaleLowerCase().includes(key))));
}
export function inventoryAgeQuantity(row:InventoryRow,threshold:180|365=180):number|null{
 if(!row.age)return null;const values=threshold===365?[row.age.days365Plus]:[row.age.days181To270,row.age.days271To365,row.age.days365Plus];
 return values.some(v=>v==null)?null:values.reduce<number>((s,v)=>s+v!,0);
}
export function hasInventory(row:InventoryRow){return row.total.quantity>0||row.plan>0||row.aux.some(a=>a.stock.quantity>0);}
export type InventoryGroup={id:string;parentAsin:string;name:string;operator:string;rows:InventoryRow[];aged:number|null};
/** Group before pagination so a parent is never split across pages. Unpaired SKUs stay separate. */
export function inventoryGroups(rows:InventoryRow[],threshold:180|365=180):InventoryGroup[]{
 const groups=new Map<string,InventoryGroup>();
 for(const r of rows){const parent=r.parentAsin||r.asin,id=parent?`parent:${parent}`:`local:${r.commodityId||r.id}`;let g=groups.get(id);
  if(!g){g={id,parentAsin:parent,name:r.parentName||r.name,operator:'',rows:[],aged:0};groups.set(id,g);}g.rows.push(r);
 }
 for(const g of groups.values()){g.rows.sort((a,b)=>a.asin.localeCompare(b.asin)||a.msku.localeCompare(b.msku)||a.id.localeCompare(b.id));g.operator=[...new Set(g.rows.flatMap(r=>r.operator.split('/')).filter(Boolean))].join('/');const ages=g.rows.map(r=>inventoryAgeQuantity(r,threshold));g.aged=ages.some(n=>n==null)?null:ages.reduce<number>((s,n)=>s+n!,0);}
 return [...groups.values()];
}
export function agedInventoryGroups(rows:InventoryRow[],threshold:180|365=180){return inventoryGroups(rows,threshold).filter(g=>g.aged!=null&&g.aged>0).sort((a,b)=>b.aged!-a.aged!||a.id.localeCompare(b.id));}
