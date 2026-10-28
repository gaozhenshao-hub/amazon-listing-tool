import {readJson} from './competitorPresentation';
export function listingReviewContext(records:any[]){
 const result:{painPoints:any[];itchPoints:any[];delightPoints:any[]}={painPoints:[],itchPoints:[],delightPoints:[]};
 for(const r of records){const raw=readJson(r.rawData)||{};if(r.summaryStatus!=='confirmed'||raw.captureOnly||raw.analysisStale)continue;const report=raw.presentation?.reviewReport;if(!report)continue;
  for(const [target,source] of [['painPoints','negatives'],['itchPoints','unmetNeeds'],['delightPoints','positives']] as const){for(const p of report[source]||[])result[target].push({point:p.text,sourceAsins:[r.asin],reviewIds:p.reviewIds,frequency:'当前评论样本',severity:'未量化',importance:'未量化'});}
 }
 return result;
}
