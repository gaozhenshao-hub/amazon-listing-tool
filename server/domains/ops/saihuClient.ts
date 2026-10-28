import {createHmac,randomInt} from 'node:crypto';
import {safeHttpRequest,type SafeHttpRequestOptions,type SafeHttpResponse} from '../../infrastructure/http/safeHttpClient';

export function requestSaihuHttp(url:URL,options:Pick<SafeHttpRequestOptions,'method'|'headers'|'body'|'signal'>={}):Promise<SafeHttpResponse> {
  assertSaihuOrigin(url.origin);
  if(url.username||url.password)throw new Error('赛狐接口地址不允许包含身份信息');
  return safeHttpRequest(url.toString(),{...options,timeoutMs:60000,maxRedirects:0,maxResponseBytes:8*1024*1024,allowedHosts:['openapi.sellfox.com'],allowPrivateNetwork:false,auditContext:{toolSlug:'saihu-sync',operation:'read'}});
}

export const SAIHU_ORIGIN='https://openapi.sellfox.com';
export function assertSaihuOrigin(value:string) {
  const u=new URL(value || SAIHU_ORIGIN);
  if(u.origin!==SAIHU_ORIGIN || u.username || u.password || u.search || u.hash || u.pathname!=='/') throw new Error('仅支持赛狐官方接口地址 https://openapi.sellfox.com/');
  return SAIHU_ORIGIN;
}
export function signSaihu(secret:string,params:Record<string,string>) {
  return createHmac('sha256',secret).update(Object.keys(params).sort().map(k=>`${k}=${params[k]}`).join('&')).digest('hex');
}
export class SaihuApiError extends Error {
  constructor(public code:number) {super(saihuErrorMessage(code));}
}
export function saihuErrorMessage(code:number) {
  const messages:Record<number,string>={
    40001:'赛狐授权已失效，请重新测试连接',40004:'App ID 不正确或账号未开通 API',
    40005:'服务器 IP 不在赛狐白名单中，请添加 47.105.52.123 后重试',
    40011:'赛狐签名验证失败，请检查 App ID 与 App Secret 是否匹配',
    40019:'赛狐请求频率受限，请稍后重试',40021:'当前 API 账号没有店铺读取权限',
    40022:'赛狐账号状态异常，请检查账号设置',40025:'赛狐 API 账号已失效',
  };
  return messages[code] || `赛狐请求未通过（错误码 ${code}），请检查 API 账号及密钥`;
}
async function request(url:URL,init:Pick<SafeHttpRequestOptions,'method'|'headers'|'body'>={}) {
  let response:SafeHttpResponse;
  try {response=await requestSaihuHttp(url,{...init,signal:AbortSignal.timeout(20000)});} catch {throw new Error('无法连接赛狐，请稍后重试');}
  let body:any;
  try {body=await response.json();} catch {throw new Error('赛狐返回了无法识别的响应，请稍后重试');}
  if(body?.code!==0) throw new SaihuApiError(Number.isFinite(Number(body?.code))?Number(body.code):-1);
  if(!response.ok) throw new Error(`赛狐 HTTP 请求失败（${response.status}）`);
  return body.data;
}
export async function fetchSaihuToken(appId:string,secret:string) {
  const url=new URL('/api/oauth/v2/token.json',SAIHU_ORIGIN);
  url.search=new URLSearchParams({client_id:appId,client_secret:secret,grant_type:'client_credentials'}).toString();
  const data=await request(url);
  if(typeof data?.access_token!=='string' || !data.access_token || !Number.isFinite(Number(data.expires_in)) || Number(data.expires_in)<=0) throw new Error('赛狐未返回有效授权，请检查账号配置');
  return {token:data.access_token as string,expiresAt:Date.now()+Number(data.expires_in)};
}
export async function fetchSaihuShopSummary(appId:string,secret:string,token:string) {
  const path='/api/shop/pageList.json';
  const params={access_token:token,client_id:appId,method:'post',nonce:String(randomInt(1,2147483647)),timestamp:String(Date.now()),url:path};
  const url=new URL(path,SAIHU_ORIGIN);
  url.search=new URLSearchParams({access_token:token,client_id:appId,nonce:params.nonce,timestamp:params.timestamp,sign:signSaihu(secret,params)}).toString();
  const data=await request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pageNo:'1',pageSize:'5'})});
  if(!Array.isArray(data?.rows) || !Number.isInteger(Number(data.totalSize)) || Number(data.totalSize)<0) throw new Error('赛狐店铺列表格式异常，未将本次测试标记为成功');
  return {shopCount:Number(data.totalSize),shops:data.rows.map((r:any)=>({id:String(r.id||''),name:String(r.name||''),region:String(r.region||'')}))};
}
