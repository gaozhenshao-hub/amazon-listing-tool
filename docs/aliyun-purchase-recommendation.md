# 阿里云独立部署采购建议

**适用应用：** 亚马逊全链路智能工具。应用包含 React/Vite 前端、Express/tRPC Web 服务、AI Worker、Scheduler、MySQL 业务数据、图片与文件处理，以及皇帝 Skill/Agent 模型调用。

## 推荐结论

建议购买 **“生产稳妥版”**，不要从轻量应用服务器或 2 核 4GB 规格起步。当前项目完整前端构建已出现内存终止记录，且生产中还需要同时运行 Web、AI Worker 和 Scheduler；因此应把构建和运行的内存余量视为硬约束。

| 资源 | 推荐采购规格 | 选择原因 |
|---|---|---|
| ECS | **通用型非突发性能实例，8 vCPU / 16GB RAM**，Ubuntu 24.04 或 22.04 x86_64，200GB ESSD PL1 | 可同时运行 Node Web、AI Worker、Scheduler，并为 Vite 构建、临时文件和故障排查留出余量 |
| 公网带宽 | 独立公网 IP，**5Mbps BGP 起步** | 应用静态资源由应用服务器提供，图片与导出文件迁移到 OSS 后带宽压力显著下降；后续可按访问量升配 |
| RDS | **RDS MySQL 8.0 高可用版，4 vCPU / 8GB，100GB ESSD**，与 ECS 同地域、同 VPC | 业务包含用户、工作区、AI Job、图片工作流和审计数据；高可用版避免单机数据库成为单点 |
| OSS | **标准存储、私有 Bucket、同地域**；开通版本控制和生命周期规则 | 图片、上传表格、导出文件不再占用 ECS 磁盘；私有 Bucket 通过短期预签名 URL 受控访问 |
| 域名/HTTPS | 已有域名或新域名 + Nginx + Let's Encrypt | 为独立登录回调、浏览器安全 Cookie 和稳定访问提供 HTTPS |
| 监控与备份 | RDS 自动备份保留 14 天；OSS 版本控制；ECS 快照每周一次 | 先建立可恢复能力，再执行数据和域名切换 |

## 不建议的起步方案

| 方案 | 不建议原因 |
|---|---|
| 轻量应用服务器 / 2核4GB | 无法稳定承担当前项目的前端构建、Web、AI Worker 与 Scheduler 的叠加负载 |
| ECS 自建 MySQL | 虽可省初期费用，但会把数据库备份、主从、故障恢复和升级风险放在同一台应用机上 |
| 公共读 OSS Bucket | 图片工作流、知识库和用户上传文件可能被公开枚举或分享；应保持私有并由应用签发短期 URL |
| 把 RDS 暴露公网 | 数据库只应在 VPC 内向 ECS 安全组开放，不分配公网地址 |

## 地域选择

服务器、RDS 和 OSS 必须选择**同一地域**。如果团队主要在中国大陆操作，且现有模型网关从大陆 ECS 可正常连通，优先选择杭州或上海；若现有模型网关/海外服务从大陆访问不稳定，优先选择中国香港地域并使用香港域名/网络方案。最终地域必须先用目标环境对当前模型网关进行一次只读连通性测试后确定。

若选择中国大陆地域并以独立域名对公众提供网站服务，需要在上线前处理相应备案要求；中国香港地域通常不适用该流程，但需综合团队访问时延和模型网关连通性决定。

## 采购和配置顺序

1. 先购买 ECS、RDS 和 OSS，三者必须位于同一地域与同一 VPC。
2. ECS 仅开放 80、443；SSH 22 仅对管理员固定 IP 或堡垒机开放。
3. 创建 RDS 私网账号；不要创建公网白名单或公网连接地址。
4. 创建 OSS 私有 Bucket，配置专用 RAM 子账号或 RAM Role 的最小读写权限，启用版本控制。
5. 创建测试子域名，先部署独立测试环境并做登录、数据库、OSS 上传下载、模型调用、AI Job 和图片工作流 Smoke Test。
6. 完成全量数据库备份、对象清单和回滚演练后，再切换正式域名。

## 现有模型 API 的迁移说明

只读审计显示，当前皇帝中台已有活动的自定义 OpenAI 兼容模型提供商配置，默认模型也属于该网关。独立部署时会保留 Skill、Agent、模型选择和故障回退逻辑；仅将模型网关地址及密钥迁入阿里云服务器的项目级环境/数据库配置。明文 API 密钥不会写入代码、Git、文档或客户端。

## 官方依据

- 阿里云 RDS 产品页说明：高可用版和集群版提供多可用区容灾，支持弹性规格和自动运维能力。[1]
- 阿里云 OSS 文档说明：私有对象默认仅拥有者可访问，可通过预签名 URL 在有效期内授权下载或预览。[2]
- 阿里云 ECS 实例族文档提供按实例族和工作负载选择规格的入口；实际价格随地域、实例族、计费方式和促销变化，应以采购控制台报价为准。[3]

## 参考资料

[1]: https://cn.aliyun.com/product/rds
[2]: https://help.aliyun.com/zh/oss/user-guide/how-to-obtain-the-url-of-a-single-object-or-the-urls-of-multiple-objects
[3]: https://www.alibabacloud.com/help/en/ecs/user-guide/overview-of-instance-families

## 调研记录（2026-08-19）

- 阿里云 RDS 产品页说明，高可用版和集群版使用多可用区容灾架构，且支持弹性规格与自动运维功能：<https://cn.aliyun.com/product/rds>。
- 阿里云 OSS 预签名 URL 文档说明，私有对象默认仅文件拥有者可访问，可在有效期内授权指定对象下载或预览：<https://help.aliyun.com/zh/oss/user-guide/how-to-obtain-the-url-of-a-single-object-or-the-urls-of-multiple-objects>。
- 阿里云安全组文档说明，安全组用于控制 ECS 入方向与出方向流量，且提供 Web、远程访问、数据库访问与内网互通配置案例：<https://help.aliyun.com/zh/ecs/user-guide/security-groups-for-different-use-cases>。
- 采购价格会随地域、实例族、计费方式和活动变动；本方案仅给出容量规格，结算金额必须以杭州地域采购控制台最终报价为准。
