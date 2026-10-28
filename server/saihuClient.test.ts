import {afterEach,describe,expect,it,vi} from 'vitest';
import {signSaihu,assertSaihuOrigin,fetchSaihuToken,fetchSaihuShopSummary} from './domains/ops/saihuClient';
const fetcher=vi.hoisted(()=>vi.fn());
vi.mock('./infrastructure/http/safeHttpClient',()=>({safeHttpRequest:fetcher}));
afterEach(()=>fetcher.mockReset());
describe('赛狐官方 OpenAPI',()=>{
 it('签名与官方固定样例一致',()=>{
  expect(signSaihu('fde212ff-588a-11ef-b1d4-0c42a1eda3d9',{url:'/openapi/api/commodity/pageList.json',method:'post',access_token:'d20d9d20-5db0-429a-8390-3694265e297c',client_id:'1111111',timestamp:'1668153260508',nonce:'888'})).toBe('57bcbd213461d47e99e9b781c11f3fb37937127824272a30b95ddb5cbfea881e');
 });
 it('凭证仅发往官方域名',()=>{
  expect(assertSaihuOrigin('https://openapi.sellfox.com/')).toBe('https://openapi.sellfox.com');
  for(const url of ['https://example.com','http://openapi.sellfox.com','https://openapi.sellfox.com.evil.test','https://user:password@openapi.sellfox.com']) expect(()=>assertSaihuOrigin(url)).toThrow();
 });
 it('正确处理毫秒有效期',async()=>{
  fetcher.mockResolvedValue(new Response(JSON.stringify({code:0,data:{access_token:'test-token',expires_in:86400000}}))); 
  const before=Date.now();const result=await fetchSaihuToken('app','test-secret');
  expect(result.expiresAt).toBeGreaterThanOrEqual(before+86400000);expect(result.expiresAt).toBeLessThan(Date.now()+86400001);
 });
 it('白名单错误准确提示，不泄露返回中的凭证',async()=>{
  fetcher.mockResolvedValue(new Response(JSON.stringify({code:40005,msg:'client_secret=test-secret'}),{status:401}));
  await expect(fetchSaihuToken('app','test-secret')).rejects.toThrow('47.105.52.123');
 });
 it('只读店铺验证使用签名POST且只返回必要字段',async()=>{
  fetcher.mockResolvedValue(new Response(JSON.stringify({code:0,data:{totalSize:7,rows:[{id:'1',name:'店铺',region:'US',other:'unused'}]}})));
  expect(await fetchSaihuShopSummary('app','secret','token')).toEqual({shopCount:7,shops:[{id:'1',name:'店铺',region:'US'}]});
  expect(fetcher.mock.calls[0][1]).toMatchObject({method:'POST',maxRedirects:0,allowedHosts:['openapi.sellfox.com'],allowPrivateNetwork:false,body:JSON.stringify({pageNo:'1',pageSize:'5'})});
 });
});
