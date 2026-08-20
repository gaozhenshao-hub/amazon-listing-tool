# 青岛低成本独立部署验收（2026-08-20）

## 运行结果

应用已在阿里云华北1（青岛）的4核8GB ECS运行，采用本机Node 22、本机MySQL 8和systemd守护的Web、AI Worker与Scheduler，不购买ACR企业版。Nginx将`kuahaixing.com`的HTTP重定向至HTTPS，并仅代理本机`127.0.0.1:3000`；应用端口不会直接暴露公网。

| 验收项 | 结果 | 说明 |
|---|---|---|
| 历史数据迁移 | 通过 | Manus托管TiDB以TLS Dumpling一致性只读快照导出，233张表恢复并提升至独立生产库；只读基线为13名用户、30个项目、24个图片工作流会话与43条含历史URI的项目文件，抽样URI返回HTTP 200；Manus源库未写入或删除。 |
| 本地密码登录 | 通过 | 本地JWT在独立模式签发`appId=local`；`VITE_AUTH_MODE=local`构建后不再出现Manus登录入口。 |
| 外部模型 | 通过 | Teamorouter OpenAI兼容接口以无业务数据请求返回HTTP 200。 |
| 私有OSS | 通过 | ECS服务端使用青岛内网Endpoint，浏览器使用公网预签名Endpoint；隔离对象上传、下载与删除均通过。 |
| 加密备份恢复 | 通过 | MySQL逻辑备份经AES-256-CBC、PBKDF2加密上传OSS，再恢复到隔离库；233张表核验后隔离库已删除。 |
| 后台服务 | 通过 | Web、Worker、Scheduler均为active；Worker死信观测查询已兼容MySQL保留字`procedure`。 |
| Forge专属能力边界 | 通过 | 在独立认证模式且未配置托管提供方时，图片生成、语音转写、地图、外部数据检索和Heartbeat均返回`INDEPENDENT_CAPABILITY_UNAVAILABLE`；视频知识库与站外分析会在创建记录前拒绝请求，避免伪成功。 |

## 运维边界

Manus托管站点和源数据继续保留，作为独立环境迁移后的回滚入口。独立环境的运行密钥仅保存在ECS权限600的配置文件中；备份加密密钥和OSS密钥均不进入Git或前端构建产物。

图片生成、语音转写、地图、数据API和Heartbeat当前尚未接入独立替代服务，但已经逐项显式禁用：不会向不存在的托管服务发起请求，也不会创建伪成功记录。所有者通知在`AUTH_MODE=local`且未配置提供方时已降级为未投递状态，运行告警仍会持久化但不会再因Forge配置缺失循环抛错。如需重新启用这些能力，应先接入相应的独立提供方并替换本轮能力边界；迁移的数据、登录、模型、对象存储、后台Worker、Scheduler与HTTPS入口均已完成实际验收。
