import {sumStock,type InventoryRow,type InventorySnapshot,type InventoryAux,type StockValue,inventoryAgeQuantity} from '../../../shared/inventorySnapshot';
type Sources=Record<string,any[]>;
const NA=new Set(['ATVPDKIKX0DER','A2EUQ1WTGCTBG2','A1AM78C64UM0Y8']);
const str=(v:any)=>v==null?'':String(v).trim();
const zero=():StockValue=>({quantity:0,value:0});
function qty(r:any,k:string){const v=r[k];if(v==null||v===''||!Number.isFinite(Number(v))||Number(v)<0)throw new Error(`库存数量缺失或异常：${k}`);return Number(v);}
function value(r:any,k:string,q:number){if(!q)return 0;return r[k]!=null&&r[k]!==''&&Number.isFinite(Number(r[k]))&&Number(r[k])>=0?Number(r[k]):null;}
const ageNumber=(v:any):number|null=>v==null||v===''||!Number.isFinite(Number(v))||Number(v)<0?null:Number(v);
const round=(v:number)=>Math.round(v*10000)/10000;
/** All stock comes from inventory endpoints; listings and shipments only resolve identity. */
export function mapInventory(d:Sources,startedAt:number,capturedAt=Date.now()):InventorySnapshot{
 for(const key of ['warehouses','warehouse','fba','commodities','aux','listings','shipping','shippingItems','details'])if(!Array.isArray(d[key]))throw new Error('库存来源不完整');
 const warnings:string[]=[],rows=new Map<string,InventoryRow>(),candidates=new Map<string,Map<string,InventoryRow>>();
 const commodities=new Map(d.commodities.map(r=>[str(r.id),r]));
 const auxIds=new Set(d.aux.map(r=>str(r.id)));
 const get=(cid:string,asin:string,msku:string,source:any={})=>{
  const id=JSON.stringify([cid,asin,msku]);let r=rows.get(id);if(r)return r;
  const commodity=commodities.get(cid);r={id,commodityId:cid,localSku:str(source.commoditySku||commodity?.sku),asin,msku,parentAsin:str(source.parentAsin),parentName:'',name:str(source.commodityName||commodity?.name||asin||'未命名本地库存'),ownerIds:[],operator:(source.devList||[]).map((v:any)=>v.devName).filter(Boolean).join('/'),unpaired:!asin,allocation:'仅包含该 MSKU 的 FBA 库存',lastShipment:null,plan:0,domestic:zero(),purchase:zero(),shipping:zero(),fba:zero(),total:zero(),aux:[],notes:[],age:{days181To270:0,days271To365:0,days365Plus:0,dates:[]}};
  r.parentName=r.name;rows.set(id,r);if(cid&&asin&&msku){if(!candidates.has(cid))candidates.set(cid,new Map());candidates.get(cid)!.set(id,r);}return r;
 };
 // US metadata takes priority over shared-market copies.
 for(const s of [...d.listings].sort((a,b)=>Number(b.marketplaceId==='ATVPDKIKX0DER')-Number(a.marketplaceId==='ATVPDKIKX0DER'))){if(!NA.has(str(s.marketplaceId)))continue;if(s.asin&&s.sku)get(str(s.commodityId),str(s.asin),str(s.sku),s);}
 const fbaSeen=new Map<string,string>();
 for(const f of d.fba){
  if(!NA.has(str(f.marketplaceId))){if(Number(f.totalInventory)>0)warnings.push(`排除非北美 FBA 库存：${str(f.asin)} / ${str(f.marketplaceId)}`);continue;}
  if(str(f.currency)!=='CNY')throw new Error('FBA 库存币种不一致，未更新');
  const signature=JSON.stringify([f.asin,f.sku,f.commodityId,...['totalInventory','inTransit','purchaseCosts','invAge181To270Days','invAge271To365Days','invAge365PlusDays'].map(k=>Number(f[k]))]);
  const key=str(f.shareKey)||str(f.id);if(!key)throw new Error('FBA 库存缺少去重标识');
  if(fbaSeen.has(key)){if(fbaSeen.get(key)!==signature)throw new Error('共享 FBA 库存数量不一致，未更新');continue;}fbaSeen.set(key,signature);
  const total=qty(f,'totalInventory'),transit=qty(f,'inTransit');
  if(transit!==qty(f,'inboundShipped')+qty(f,'inboundReceiving')||total!==['available','reservedTransfer','reservedProcessing','reservedCustomerorders','unfulfillable','research','inTransit'].reduce((s,k)=>s+qty(f,k),0))throw new Error('FBA 库存分项与合计不一致，未更新');
  const age={days181To270:ageNumber(f.invAge181To270Days),days271To365:ageNumber(f.invAge271To365Days),days365Plus:ageNumber(f.invAge365PlusDays)};
  if(!total&&!Object.values(age).some(n=>n!=null&&n>0))continue;
  if(!f.asin||!f.sku)throw new Error('非零 FBA 库存缺少 ASIN 或 MSKU');
  const r=get(str(f.commodityId),str(f.asin),str(f.sku),f),v=value(f,'purchaseCosts',total),tv=v==null?null:total?round(v*transit/total):0;
  for(const key of ['days181To270','days271To365','days365Plus'] as const)r.age![key]=r.age![key]==null||age[key]==null?null:r.age![key]!+age[key]!;
  if(f.snapshotDate&&!r.age!.dates.includes(str(f.snapshotDate)))r.age!.dates.push(str(f.snapshotDate));
  if(Object.values(age).some(v=>v==null))r.notes.push('赛狐库龄分段缺失，超龄数量待核对，不按零计入排序');
  const aged=Object.values(age).reduce<number>((sum,n)=>sum+(n||0),0);if(aged>total-transit)r.notes.push('库龄快照数量超过当前 FBA 仓数量，两者更新时间不同；保留原始库龄数量，请核对更新时间');
  r.shipping=sumStock([r.shipping,{quantity:transit,value:transit?tv:0}]);r.fba=sumStock([r.fba,{quantity:total-transit,value:total===transit?0:v==null?null:round(v-tv!)}]);
  if(v==null)r.notes.push('赛狐未返回 FBA 采购货值，待核对');
  r.notes.push('FBA 在途仅含已发出及接收中；待发货计划不重复计入。FBA 货值按接口采购货值及对应数量分配。');
 }
 const shipments=new Map(d.shipping.map(s=>[str(s.shipSn),s])),latest=new Map<string,Map<string,string>>();
 for(const batch of d.shippingItems){const s=shipments.get(str(batch.shipSn));if(!s||Number(s.status)!==3||Number(s.restoreStock)===1)continue;const time=str(s.realShipTime||s.shipTime);if(!time)continue;
  for(const item of batch.items||[]){if(Number(item.shipCount)<=0)continue;const cid=str(item.commodityId),key=JSON.stringify([cid,str(item.asin),str(item.sellerSku)]);if(!candidates.get(cid)?.has(key))continue;if(!latest.has(cid))latest.set(cid,new Map());const m=latest.get(cid)!;if(!m.get(key)||m.get(key)!<time)m.set(key,time);}
 }
 const warehouseType=new Map(d.warehouses.map(w=>[str(w.id),Number(w.type)])),balances=new Map<string,{domestic:StockValue;purchase:StockValue;plan:number;sku:string}>(),warehouseSeen=new Set<string>();
 for(const w of d.warehouse){
  const type=warehouseType.get(str(w.warehouseId));if(type===2)continue;if(type!==0&&type!==1){if(Number(w.stockAllNum)||Number(w.stockWait))throw new Error('存在非国内仓本地库存，需要核对仓库口径');continue;}
  const wid=str(w.id);if(!wid||warehouseSeen.has(wid))throw new Error('国内库存记录重复或缺少标识');warehouseSeen.add(wid);
  const cid=str(w.commodityId);if(!cid)throw new Error('国内库存缺少本地商品标识');const q=qty(w,'stockAllNum'),p=qty(w,'stockWait'),plan=qty(w,'stockPlan');
  if(q!==['stockAvailable','stockDefective','stockOccupy'].reduce((s,k)=>s+qty(w,k),0))throw new Error('国内库存分项与合计不一致');
  const b=balances.get(cid)||{domestic:zero(),purchase:zero(),plan:0,sku:str(w.commoditySku)};
  b.domestic=sumStock([b.domestic,{quantity:q,value:value(w,'totalPurchase',q)}]);b.purchase=sumStock([b.purchase,{quantity:p,value:value(w,'onWayPurchase',p)}]);b.plan+=plan;balances.set(cid,b);
 }
 const auxStocks=new Map<string,InventoryAux>(),auxUsed=new Set<string>();
 for(const a of d.aux){const id=str(a.id),b=balances.get(id);auxStocks.set(id,{id,sku:str(a.sku),name:str(a.name),stock:b?sumStock([b.domestic,b.purchase]):zero(),shared:true,note:'国内仓与已下单采购在途合计；同一辅料跨产品共享，底部去重合计。'});}
 for(const [cid,b] of balances){
  if(auxIds.has(cid))continue;if(!b.domestic.quantity&&!b.purchase.quantity&&!b.plan)continue;
  const choices=[...(candidates.get(cid)?.values()||[])];let selected:InventoryRow|undefined;
  if(choices.length===1){selected=choices[0];selected.allocation='本地 SKU 仅对应一个 MSKU';}
  else if(choices.length>1){const shipped=choices.filter(r=>latest.get(cid)?.has(r.id));const newest=shipped.map(r=>latest.get(cid)!.get(r.id)!).sort().at(-1);const match=shipped.filter(r=>latest.get(cid)!.get(r.id)===newest);if(match.length===1){selected=match[0];selected.allocation='本地 SKU 对应多个 MSKU，分配给最近实际发货的 MSKU';selected.lastShipment=newest!;}}
  if(!selected){selected=get(cid,'','');selected.localSku=b.sku;selected.allocation=choices.length?'多个 MSKU 无法唯一确定最近发货归属，库存独立保留':'本地 SKU 未配对亚马逊 MSKU';selected.notes.push(selected.allocation);warnings.push(`${selected.localSku}：${selected.allocation}`);}
  selected.domestic=b.domestic;selected.purchase=b.purchase;selected.plan=b.plan;
  if(b.domestic.value==null||b.purchase.value==null)selected.notes.push('赛狐未返回完整采购货值，待核对；不使用已付款金额代替');
 }
 for(const detail of d.details){const cid=str(detail.id);for(const r of candidates.get(cid)?.values()||[]){for(const a of detail.commodityAux||[]){const id=str(a.auxId),stock=auxStocks.get(id);if(!stock)throw new Error('关联辅料缺少库存来源');if(!r.aux.some(v=>v.id===id))r.aux.push(stock);auxUsed.add(id);}}}
 for(const [id,a] of auxStocks){if(auxUsed.has(id)||!a.stock.quantity)continue;const r=get(id,'','');r.name=a.name;r.parentName=a.name;r.localSku=a.sku;r.aux=[a];r.allocation='未关联产品的辅料库存（不计入商品库存合计）';}
 for(const r of rows.values())r.total=sumStock([r.domestic,r.purchase,r.shipping,r.fba]);
 const active=[...rows.values()].filter(r=>r.total.quantity||r.plan||r.aux.some(a=>a.stock.quantity)||(inventoryAgeQuantity(r)||0)>0);
 if(!active.length)throw new Error('库存全部为空，未覆盖上次结果，请核对赛狐数据');
 return {version:1,currency:'CNY',startedAt,capturedAt,rows:active,warnings:[...new Set(warnings)],sourceCounts:Object.fromEntries(Object.entries(d).map(([k,v])=>[k,v.length]))};
}
