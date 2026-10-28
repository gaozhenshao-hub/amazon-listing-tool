import {afterEach,describe,expect,it,vi} from 'vitest';
vi.mock('../ai_os/services/toolGateway/governanceCore',()=>({decryptToolSecretValue:()=> 'test-token',encryptToolSecretValue:()=>({})}));
const fetcher=vi.hoisted(()=>vi.fn());
vi.mock('./saihuClient',()=>({requestSaihuHttp:fetcher,assertSaihuOrigin:()=>{},fetchSaihuToken:vi.fn(),signSaihu:()=> 'test-sign',SaihuApiError:class extends Error{}}));
import {inventoryClient} from './saihuInventoryClient';
const db=()=>({query:vi.fn().mockResolvedValue([[{secret_cipher:'{}',token_cipher:'{}',token_expires_at:Date.now()+86400000,app_id:'test',api_base_url:'https://openapi.sellfox.com'}]])}) as any;
afterEach(()=>{vi.useRealTimers();fetcher.mockReset();});
describe('inventory response recovery',()=>{
 it('retries a truncated response and records only the valid response',async()=>{
  vi.useFakeTimers();fetcher.mockResolvedValueOnce(new Response('',{status:502})).mockResolvedValueOnce(new Response(JSON.stringify({code:0,data:{rows:[{id:1}]}})));
  const client=await inventoryClient(db(),1,new AbortController().signal),request=client.read('/test',{});await vi.runAllTimersAsync();expect(await request).toEqual({rows:[{id:1}]});expect(fetcher).toHaveBeenCalledTimes(2);expect(client.audit).toHaveLength(1);
 });
 it('stops after four incomplete responses without accepting partial data',async()=>{
  vi.useFakeTimers();fetcher.mockImplementation(()=>Promise.resolve(new Response('{')));
  const client=await inventoryClient(db(),1,new AbortController().signal),check=expect(client.read('/test',{})).rejects.toThrow('原库存未覆盖');await vi.runAllTimersAsync();await check;expect(fetcher).toHaveBeenCalledTimes(4);expect(client.audit).toHaveLength(0);
 });
});
