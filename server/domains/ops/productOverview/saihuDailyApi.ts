import {saihuDailyFields} from './saihuDailyFields';
import {productReportingWeek} from '../../../../shared/productReportingWeek';
const percent=new Set('grossMargin cancelOrderPct refundRate returnRate fbaReturnRate fbmReturnRate exchangeRate buyboxRate cvr orderCvr reviewRate organicCvr organicOrderPct adClickRate adCvr cpcAdCvr vcpmAdCvr acos spAcos sbCollectionAcos sbStoreAcos sbVideoAcos sdAcos acoas asoas adOrderPct'.split(' '));
export const dailyActivityFields=['saleNum','orderNum','salePrice','profitPrice','adTotalCost','adOrderNum','adTotalSale','refundNum','returnSaleNum','sessions','adClicks','adTotalImpression'];
export function dailyApiIdentity(r:any){return JSON.stringify([r.asinList,r.shopInfos?.map((s:any)=>[s.shopId,s.marketplaceName])]);}
export function hasDailyActivity(r:any){return dailyActivityFields.some(k=>Number(r.fieldsMap?.[k]?.currValue||0)!==0);}
export function mapSaihuDailyApi(r:any,day:string,columns:Record<string,any>){
 if(r.currency!=='USD'||r.asinList?.length!==1||r.shopInfos?.length!==1||r.parentAsinList?.length>1)throw new Error('商品ASIN或店铺归属不明确，本次未写入');
 const asin=r.asinList[0],parent=r.parentAsinList?.[0]||asin,s=r.shopInfos[0];
 if(!/^[A-Z0-9]{10}$/.test(asin)||!/^[A-Z0-9]{10}$/.test(parent)||!s.shopName||!s.marketplaceName)throw new Error('商品标识不完整，本次未写入');
 const join=(v:any)=>Array.isArray(v)?v.join(','):v||null;
 const out:any={reportDate:day,reportLevel:'asin',...productReportingWeek(day),currency:'USD',asin,parentAsin:parent,title:r.title||null,imageUrl:r.mainImage||null,storeName:s.shopName,site:s.marketplaceName,sku:join(r.skuList),msku:join(r.mskuList),productName:join(r.commodityNameList),operator:join(r.devNameList),developer:join(r.operatorNameList),brand:join(r.brandNameList),category:join(r.categoryNameList)};
 for(const [field,key,type] of saihuDailyFields){
  if(!columns[key])continue;
  const v=r.fieldsMap?.[field]?.currValue;if(v==null||v===''){out[key]=null;continue;}
  let n=Number(v);if(!Number.isFinite(n))throw new Error(`赛狐字段 ${field} 格式异常`);
  if(percent.has(key))n/=100;
  if(type==='int'&&!Number.isInteger(n))throw new Error(`赛狐字段 ${field} 不是整数`);
  out[key]=type==='int'?n:n.toFixed(columns[key].scale??4);
 }
 for(const key of ['salesQty','orderQty','salesAmount','grossProfit','adSpend'])if(out[key]==null)throw new Error(`赛狐缺少必需字段 ${key}`);
 for(const [key,value] of Object.entries(out))if(typeof value==='string'&&columns[key]?.length&&value.length>columns[key].length)throw new Error(`赛狐字段 ${key} 过长`);
 return out;
}
