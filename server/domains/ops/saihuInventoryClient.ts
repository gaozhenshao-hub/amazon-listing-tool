import type mysql from 'mysql2/promise';
import {randomInt} from 'node:crypto';
import {decryptToolSecretValue,encryptToolSecretValue} from '../ai_os/services/toolGateway/governanceCore';
import {assertSaihuOrigin,fetchSaihuToken,signSaihu,SaihuApiError,requestSaihuHttp} from './saihuClient';
const parse=(v:any)=>typeof v==='string'?JSON.parse(v):v;
export async function inventoryClient(db:mysql.Connection,workspace:number,signal:AbortSignal){
 const [configs]:any=await db.query('SELECT * FROM ops_saihu_api_configs WHERE workspace_id=?',[workspace]);
 const c=configs[0];if(!c?.secret_cipher)throw new Error('请先配置赛狐 API');assertSaihuOrigin(c.api_base_url);
 const secret=decryptToolSecretValue(parse(c.secret_cipher));
 let token=c.token_cipher&&Number(c.token_expires_at)>Date.now()+60000?decryptToolSecretValue(parse(c.token_cipher)):'';
 async function refresh(){signal.throwIfAborted();const t=await fetchSaihuToken(c.app_id,secret);token=t.token;await db.query('UPDATE ops_saihu_api_configs SET token_cipher=?,token_expires_at=? WHERE workspace_id=? AND secret_cipher=?',[JSON.stringify(encryptToolSecretValue(token)),t.expiresAt,workspace,c.secret_cipher]);}
 if(!token)await refresh();
 const audit:any[]=[];
 async function read(path:string,body:Record<string,unknown>){
  for(let attempt=0;attempt<4;attempt++){
   await new Promise(r=>setTimeout(r,1300+attempt*2000));signal.throwIfAborted();
   const p={access_token:token,client_id:String(c.app_id),method:'post',nonce:String(randomInt(1,2147483647)),timestamp:String(Date.now()),url:path};
   const u=new URL(path,'https://openapi.sellfox.com');u.search=new URLSearchParams({access_token:token,client_id:p.client_id,nonce:p.nonce,timestamp:p.timestamp,sign:signSaihu(secret,p)}).toString();
   let response:Awaited<ReturnType<typeof requestSaihuHttp>>;try{response=await requestSaihuHttp(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.any([signal,AbortSignal.timeout(60000)])});}catch{signal.throwIfAborted();if(attempt<3)continue;throw new Error('库存读取连接超时，原库存未覆盖');}
   let result:any;
   try{result=await response.json();if(!result||typeof result!=='object'||typeof result.code!=='number')throw new Error('invalid response');}
   catch{signal.throwIfAborted();if(attempt<3)continue;throw new Error('赛狐库存接口返回空白或不完整数据，已重试，原库存未覆盖，请稍后刷新');}
   if(result.code===40001&&attempt<3){await refresh();continue;}
   if((result.code===40019||response.status>=500)&&attempt<3)continue;
   if(result.code!==0)throw new SaihuApiError(Number(result.code));
   if(!response.ok)throw new Error('库存接口响应异常');
   audit.push({path,request:body,response:result,at:Date.now()});return result.data;
  }throw new Error('库存接口限流，请稍后重试');
 }
 async function pages(path:string,body:Record<string,unknown>={}){
  const rows:any[]=[];let total=-1;
  for(let pageNo=1;pageNo<=1000;pageNo++){
   const d=await read(path,{...body,pageNo:String(pageNo),pageSize:'100'});
   if(!Array.isArray(d?.rows)||!Number.isInteger(Number(d.totalSize))||Number(d.totalSize)<0||Number(d.pageNo)!==pageNo)throw new Error('库存分页格式异常，原库存未覆盖');
   if(total<0)total=Number(d.totalSize);else if(total!==Number(d.totalSize))throw new Error('库存读取期间总条数变化，请重新刷新');
   rows.push(...d.rows);if(rows.length===total)return rows;
   if(!d.rows.length||rows.length>total)throw new Error('库存分页不完整，原库存未覆盖');
  }throw new Error('库存页数超出限制，原库存未覆盖');
 }
 return {read,pages,audit};
}
