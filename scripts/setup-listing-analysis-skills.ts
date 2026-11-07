import { assistantConfigurationService } from '../server/domains/ai_os/services/assistantConfigurations';

const workspaceId=Number(process.argv[2]),userId=Number(process.argv[3]);
if(!Number.isSafeInteger(workspaceId)||workspaceId<1||!Number.isSafeInteger(userId)||userId<1)throw new Error('需要指定工作区和管理员');
const options=await assistantConfigurationService.options(workspaceId);
if(!options.writeEnabled)throw new Error('助手配置写入未开启');
const current=await assistantConfigurationService.get(workspaceId,'listing');
const config=current.status==='configured'?current.record.config:{name:'爱分析的小L',description:'竞品研究与 Listing 分析',enabled:true,modelSlug:'',instructions:'',rules:[],skills:[]};
const desired=[{slug:'listing.competitor.content.v2',trigger:'分析竞品 Listing、图片与 A+ 内容',instructions:'逐项翻译，提取有依据的简短精准卖点并分类。'},
 {slug:'listing.competitor.reviews.v1',trigger:'分析竞品评论并归纳评价主题',instructions:'按星级区分好差评，合并同义主题，支持一条评论多个主题，保留原文证据并去重统计。'}];
const skills=config.skills.filter(item=>item.slug!=='listing.competitor.content.v1');
for(const item of desired){const descriptor=options.skills.find(s=>s.slug===item.slug);if(!descriptor)throw new Error(`Skill 尚未发布：${item.slug}`);
 const binding={...item,enabled:true,version:descriptor.version,manifestSha256:descriptor.manifestSha256},index=skills.findIndex(s=>s.slug===item.slug);
 if(index<0)skills.push(binding);else skills[index]=binding;}
const result=await assistantConfigurationService.save(workspaceId,userId,{agentKey:'listing',expectedRevision:current.status==='configured'?current.record.revision:0,config:{...config,skills}});
console.log(JSON.stringify({agent:'listing',revision:result.revision,skills:desired.map(s=>s.slug)}));
process.exit(0);
