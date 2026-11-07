import { runEmperorSkill } from '../ai_os/services/skillRunner';

/** Retry the configured model for transient/invalid output; do not fall through to an unrelated unconfigured provider. */
export async function runCompetitorSkill<T>(request:Parameters<typeof runEmperorSkill<T>>[0], beforeRetry?: (error: unknown, attempt: number, request: Parameters<typeof runEmperorSkill<T>>[0]) => void, options: { validationFailed?:()=>boolean } = {}) {
 for(let attempt=0;attempt<3;attempt++){
  request.signal?.throwIfAborted();
  try{return await runEmperorSkill<T>({...request,maxModelAttempts:1,fallbackModels:[]});}
  catch(error){
   const cause=error && typeof error==='object' && 'cause' in error ? (error as {cause?:unknown}).cause : null;
   const chain:unknown[]=[error,cause];for(let depth=0;depth<6;depth++){const current=chain[chain.length-1];if(!current || typeof current!=="object" || !("cause" in current) || !current.cause || chain.includes(current.cause))break;chain.push(current.cause);}
   const detail=chain.find(value=>value && typeof value==='object' && 'retryable' in value && typeof value.retryable==='boolean') as {code?:unknown;retryable?:boolean}|undefined;
   const code=typeof detail?.code==='string'?detail.code:'UNKNOWN';
   console.warn(`[竞品分析] ${request.skillSlug} 模型调用失败 (${code})，第 ${attempt+1} 次`);
   if((!detail?.retryable && !options.validationFailed?.()) || attempt===2)throw error;
   beforeRetry?.(error, attempt + 1, request);
   await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));
  }
 }
 throw new Error('竞品分析未完成');
}
