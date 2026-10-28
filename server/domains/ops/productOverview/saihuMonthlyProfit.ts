import type {MonthlyFinancialMetric} from '../../../../shared/monthlyFinancialReadDetails';
type MonthlyProfitRow = Record<MonthlyFinancialMetric, number> & {
 yearMonth:string; parentAsin:string; asin:string; sku:string; title:string;
 storeName:string; site:string; operator:string|null; raw:Record<string,unknown>;
};
function resolveMonthlyParent(value:unknown,asin:string) {
 const parts=[...new Set(String(value??'').toUpperCase().split(/[,，、;；\s]+/).filter(p=>p&&p!=='-'&&p!=='--'))];
 if(parts.some(p=>! /^[A-Z0-9]{10}$/.test(p)))throw new Error('父 ASIN 格式无效');
 const parents=parts.filter(p=>p!==asin);
 if(parents.length>1)throw new Error('多个父 ASIN 无法唯一归属');
 return parents[0]||asin;
}

// Official /api/financial/v2/monthProfit/asin.json. USD, monthly, settlement,
// mergeAsin=false: retain shop scopes, then let the existing UI merge child ASINs.
export function mapSaihuMonthlyProfit(r:Record<string,any>,month:string):MonthlyProfitRow {
 if(!/^20\d{2}(0[1-9]|1[0-2])$/.test(month)||String(r.bizDate)!==month)throw new Error('Unexpected financial month');
 if(r.currency!=='USD')throw new Error('Financial report must be USD');
 const asins=(r.asinList||[]).filter((s:string)=>s&&s!=='-');
 if(asins.length>1||asins.some((s:string)=>! /^[A-Z0-9]{10}$/.test(s)))throw new Error('Ambiguous ASIN');
 if(r.shopInfos?.length!==1||!r.shopInfos[0].shopName||!r.shopInfos[0].marketplaceName)throw new Error('Ambiguous shop scope');
 const n=(k:string)=>{if(typeof r[k]!=='number'||!Number.isFinite(r[k]))throw new Error(`Invalid financial field ${k}`);return r[k] as number;};
 const sum=(keys:string)=>keys.split(' ').reduce((s,k)=>s+n(k),0);
 const round=(v:number)=>Math.round((v+Number.EPSILON)*100)/100;
 const purchase='batchPurchaseCostFba batchPurchaseCostFbm batchPurchaseCostMc batchPurchaseCrpcFeeSell batchPurchaseCrpcFeeUnsell batchPurchaseApcFeeSell batchPurchaseApcFeeUnsell batchPurchaseVrpcFeeSell batchPurchaseVrpcFeeUnsell batchPurchaseDfpcFeeSell batchPurchaseDfpcFeeUnsell receivedDiffPurchase';
 const freight='batchHeadtripCostFba batchHeadtripCostFbm batchHeadtripCostMc batchHeadtripCrpcFeeSell batchHeadtripCrpcFeeUnsell batchHeadtripApcFeeSell batchHeadtripApcFeeUnsell batchHeadtripVrpcFeeSell batchHeadtripVrpcFeeUnsell batchHeadtripDfpcFeeSell batchHeadtripDfpcFeeUnsell receivedDiffHeadtrip';
 const storage='storageFeeReport storageFeeDiff storageLongFeeReport storageLongFeeDiff starStorageFee fbaOverageFee';
 const income='fbaSaleFee fbmSaleFee giftWrapFee codItemCharge regulatoryFee fbaInventoryCompensation amazonShippingReimbursement reimbursement revenue liquidationsBrokerageFee feeAdjustment fbaPerUnitFulfillmentFee fbaWeightRefundFee postageRefund buyerRecharge a2zGuaranteeRecovery adjustmentAmount subscriptionFeeCorrection adjustmentOther taxCollectedAtSource refundCommission guaranteeClaim reimbursedAmount cod netco retrochargeTax otherIncomeFee sellerRewards rentalExtensionFee';
 const orderOther='amazonExclusivesFee amazonLicensingFee digitalServicesFee fbmPostageFee giftWrapChargeBack shippingChargeBack fbaTransportationFee fixedClosingFee variableClosingFee fbaWeightBasedFee codChargeBack orderOtherExpend';
 const serviceOther='subscriptionFee fbaDisposalFee fbaRemovalFee paidServicesFee processingFee storageTransportationFee fbaReturnFee fbaInboundConvenienceFee fbaInboundDefectFee fbaInboundCartonFee labelingFee polyBaggingFee opaqueBaggingFee bubbleWrapFee highVolumelistingFee postageBilling returnPostageFee inventoryPlacementFee compensatedClawback customerReturnHrrUnitFee reCommerceCharge amazonVatServiceFee capacityReservationFee fbaAglFee fbaShipFee';
 const refundOther='refundManagementFee refundDigitalServicesFee shippingChargeRefundSales promotionRefundSales taxRefundSales otherRefundSales';
 const asin=asins[0]||'';
 // Historical variations can have multiple parents. Preserve all evidence in raw;
 // never duplicate a child's financial amount across historical parents.
 const parents=(r.parentAsinList||[]).filter((p:string)=>p&&p!==asin&&p!=='-');
 const parentAsin=parents.length>1?asin:resolveMonthlyParent((r.parentAsinList||[]).join(','),asin);
 const row:MonthlyProfitRow={yearMonth:month.slice(0,4)+'-'+month.slice(4),asin,parentAsin,
 sku:(r.skuList||[]).join(','),title:(r.commodityInfos||[]).map((c:any)=>c.skuName).filter(Boolean).join(','),
 storeName:r.shopInfos[0].shopName,site:r.shopInfos[0].marketplaceName,operator:(r.salesManNameList||[]).join(',')||null,
 raw:{source:'sellfox_monthly_api',currency:'USD',profitCaliberType:'settlement',api:r},
 financialProfit:n('grossProfit'),salesQty:n('salesNum'),salesAmount:n('productSales'),otherIncome:sum(income),discount:-n('promotionValue'),
 purchaseCost:-(sum(purchase)+n('purchasePcFee')),freight:-(sum(freight)+n('headTripPcFee')),
 fbaFee:-sum('fbaNonMultiChannelFee fbaMultiChannelFee fbaFulfillmentRefundSales'),commission:-sum('commission commissionRefundSales'),
 advertising:-n('cpcCost'),promotion:-n('promoteFee'),storage:-sum(storage),
 otherFees:-(sum(orderOther)+sum(serviceOther)+sum(refundOther)+sum('otherExpend orderTax customFee fbmShippingCredits')),
 refundAmount:-sum('fbaRefundSales fbmRefundSales'),refundQty:n('refundNum'),returnQty:n('returnNum'),
 ld:-n('ldPromoteFee'),coupon:-n('couponsPromoteFee'),vine:-n('vineEnrollmentFee')};
 for(const k of Object.keys(row))if(typeof row[k as keyof MonthlyProfitRow]==='number')(row as any)[k]=round((row as any)[k]);
 return row;
}
