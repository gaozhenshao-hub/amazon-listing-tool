import { beforeEach,describe,it,expect,vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
const f=vi.hoisted(()=>({config:null as any,check:null as any,user:{id:2,role:"admin",status:"active",defaultWorkspaceId:1},token:vi.fn(),summary:vi.fn(),writes:0}));
const dialect=new MySqlDialect();
const execute=async(query:any)=>{const {sql,params}=dialect.sqlToQuery(query);
 if(sql.includes("FROM users"))return [[f.user]];
 if(sql.includes("FROM ops_saihu_api_configs"))return [params[0]===1&&f.config?[f.config]:[]];
 if(sql.startsWith("SELECT connection_version"))return [f.check?[f.check]:[]];
 if(sql.startsWith("UPDATE ops_saihu_api_configs SET app_id")){f.config={...f.config,app_id:params[0],secret_cipher:params[1],api_base_url:params[2],token_cipher:null};f.writes++;return [{affectedRows:1}];}
 if(sql.startsWith("INSERT INTO ops_saihu_api_configs")){f.config={workspace_id:params[0],app_id:params[1],secret_cipher:params[2],api_base_url:params[3],updated_by:params[4]};f.writes++;return [{affectedRows:1}];}
 if(sql.startsWith("UPDATE ops_saihu_api_configs SET token_cipher")){f.config.token_cipher=params[0];f.writes++;return [{affectedRows:1}];}
 if(sql.startsWith("DELETE FROM system_api_connection_checks")){f.check=null;return [{affectedRows:1}];}
 if(sql.startsWith("INSERT INTO system_api_connection_checks")){f.check={connection_version:params[1],status:params[2],checked_at:params[3],shop_count:params[4],message:params[5]};return [{affectedRows:1}];}
 throw new Error(sql);
};
vi.mock("../../repositories/dbClient",()=>({requireDb:async()=>({execute,transaction:async(fn:any)=>fn({execute})})}));
vi.mock("../ai_os/services/toolGateway/governanceCore",()=>({encryptToolSecretValue:(value:string)=>({encrypted:value}),decryptToolSecretValue:(value:any)=>value.encrypted}));
vi.mock("../ops/saihuClient",()=>({SAIHU_ORIGIN:"https://openapi.sellfox.com",fetchSaihuToken:f.token,fetchSaihuShopSummary:f.summary,SaihuApiError:class extends Error{}}));
import { readWorkspaceSaihu,saveWorkspaceSaihu,testWorkspaceSaihu } from "./workspaceSaihu";
const actor={workspaceId:1,userId:2};
beforeEach(()=>{vi.clearAllMocks();f.config={workspace_id:1,app_id:"application-one",api_base_url:"https://openapi.sellfox.com",secret_cipher:JSON.stringify({encrypted:"saved-secret-value"}),updated_by:2,token_cipher:"cached-token"};f.check=null;f.user={id:2,role:"admin",status:"active",defaultWorkspaceId:1};f.writes=0;f.token.mockResolvedValue({token:"real-remote-token",expiresAt:Date.now()+60000});f.summary.mockResolvedValue({shopCount:3});});
describe("工作空间赛狐实际接口配置",()=>{
 it("只返回配置状态，密钥和令牌不进入界面响应",async()=>{const result=await readWorkspaceSaihu(actor),json=JSON.stringify(result);expect(result).toMatchObject({configured:true,hasSecret:true,appId:"application-one"});expect(json).not.toContain("saved-secret-value");expect(json).not.toContain("cached-token");expect(result.check).toBeNull();});
 it("不会把其他工作区的配置显示为自己的",async()=>{expect((await readWorkspaceSaihu({...actor,workspaceId:8})).configured).toBe(false);});
 it("更新配置必须由当前工作区的活跃管理员执行",async()=>{const result=await readWorkspaceSaihu(actor);for(const user of [{...f.user,role:"operator"},{...f.user,status:"disabled"},{...f.user,defaultWorkspaceId:8}]){f.user=user;await expect(saveWorkspaceSaihu(actor,{expectedVersion:result.version,appId:"application-one",secret:"new"})).rejects.toThrow("管理员");}expect(f.writes).toBe(0);});
 it("更换应用ID需新密钥，旧版本不能覆盖新配置",async()=>{const result=await readWorkspaceSaihu(actor);await expect(saveWorkspaceSaihu(actor,{expectedVersion:result.version,appId:"new-id"})).rejects.toThrow("对应的应用密钥");await saveWorkspaceSaihu(actor,{expectedVersion:result.version,appId:"new-id",secret:"new-secret"});await expect(saveWorkspaceSaihu(actor,{expectedVersion:result.version,appId:"old-id",secret:"old-secret"})).rejects.toThrow("已更新");expect(f.writes).toBe(1);});
 it("未修改的保存保留原有密钥和缓存令牌",async()=>{const result=await readWorkspaceSaihu(actor);await saveWorkspaceSaihu(actor,{expectedVersion:result.version,appId:"application-one"});expect(f.writes).toBe(0);expect(f.config.token_cipher).toBe("cached-token");});
 it("取得授权并实际读取店铺成功才显示已连接",async()=>{const result=await readWorkspaceSaihu(actor),tested=await testWorkspaceSaihu(actor,result.version);expect(f.summary).toHaveBeenCalledWith("application-one","saved-secret-value","real-remote-token");expect(tested.check).toMatchObject({status:"connected",shopCount:3});expect(JSON.stringify(tested)).not.toContain("real-remote-token");});
 it("授权成功而读取店铺失败仍显示连接失败，错误不泄露凭证",async()=>{f.summary.mockRejectedValue(new Error("secret=saved-secret-value"));const result=await readWorkspaceSaihu(actor),tested=await testWorkspaceSaihu(actor,result.version);expect(tested.check?.status).toBe("failed");expect(JSON.stringify(tested)).not.toContain("saved-secret-value");expect(f.config.token_cipher).toBe("cached-token");});
 it("测试过程中配置变化不覆盖新配置或写入成功状态",async()=>{f.summary.mockImplementation(async()=>{f.config.app_id="changed-during-test";return {shopCount:2};});const result=await readWorkspaceSaihu(actor);await expect(testWorkspaceSaihu(actor,result.version)).rejects.toThrow("已更新");expect(f.config.app_id).toBe("changed-during-test");expect(f.check).toBeNull();});
 it("已停用用户在远程测试之前被拒绝",async()=>{const result=await readWorkspaceSaihu(actor);f.user.status="disabled";await expect(testWorkspaceSaihu(actor,result.version)).rejects.toThrow("管理员");expect(f.token).not.toHaveBeenCalled();});
});
