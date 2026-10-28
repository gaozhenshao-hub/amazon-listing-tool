# 阿里云独立部署包

本目录用于将当前应用部署到**阿里云青岛 ECS**。Dockerfile 位于 `deploy/aliyun/`；发布工作流在 Node 22 / Linux 上构建 Web、Worker、Scheduler 和媒体运行依赖，产出带 SHA-256 的镜像归档。

青岛现有三个 systemd 服务使用发布工作流同时生成的 `runtime.tar.gz`，其中仅包含 `package.json`、`node_modules`、`dist`、`drizzle`、`scripts` 和 `config`。先核对 `commit.txt` 和 `runtime.sha256`，解压到新的版本目录，再连接现有生产配置与私有文件目录。该归档没有 `.env`、数据库或上传文件，也不包含系统软件；原生部署的宿主机须具备 Node 22、ffmpeg、ffprobe、Chromium。不要将归档直接解压覆盖运行中的 `/opt/amazon-listing-tool` 后继续混用新旧进程。

> **已有青岛生产实例不得按全新安装重建。** 本次以朋友 `55f7a9e` 为应用基线；保留青岛现有数据库、账号、私有 OSS、生产密钥和文件原件。先记录正在运行的版本、进程及队列，再备份并核对目标库所缺的增量结构，最后分开切换 Web、Worker、Scheduler。下方 Compose 的 MySQL 8.4 及初始化命令只适用于隔离新安装；已有 systemd 部署继续使用其现有进程管理，不因源码替换自动转成 Docker MySQL。

> 发布工作流只构建和验证镜像，不连接生产，也不执行数据库迁移。`/healthz` 只证明进程存活；生产切换还要通过 `/readyz` 的数据库就绪检查、登录和关键页面检查。不能用 SPA 返回的 `/health` 页面作为成功依据。

> 本包默认使用**ECS内的Docker MySQL 8.4**、私有 OSS Bucket、邮箱密码认证和现有 OpenAI 兼容模型网关。MySQL不会开放3306端口；应用、Worker和Scheduler只通过内部Docker网络访问它。上线前不要删除现有 Manus 版本；先以测试域名完成验证，再切换正式入口。

## 资源前置条件

| 资源        | 必要设置                                                              |
| ----------- | --------------------------------------------------------------------- |
| ECS         | 青岛地域，4核8GB、100GB ESSD PL1、Ubuntu 24.04，安装 Docker Engine 与 Compose Plugin |
| MySQL 8.4   | 与应用同机Docker卷持久化；不开放3306；每日加密逻辑备份至私有OSS与云盘快照 |
| OSS         | 青岛私有 Bucket，RAM 最小权限子账号，仅授予指定 Bucket 的读写权限     |
| 网络        | 安全组仅开放 80/443；22 端口限制为管理员 IP；RDS 不开放公网           |
| 域名        | 先准备测试子域名；中国大陆正式域名上线前完成备案与 HTTPS 证书申请     |

## 首次部署顺序

1. 在 ECS 获取仓库，并将本目录的 `environment.template.txt` 复制为 `.env`。**不得**将 `.env` 提交到 Git。
2. 填写本机MySQL、OSS、备份加密密钥和模型网关变量。`DATABASE_URL`必须连接到`mysql:3306`；`AUTH_MODE=local` 与 `VITE_AUTH_MODE=local` 会保留现有邮箱密码登录并隐藏 Manus 登录入口。
3. 构建并启动MySQL及三个应用进程，再执行数据库迁移：
   ```bash
   docker compose -f deploy/aliyun/compose.yaml --env-file deploy/aliyun/.env up -d --build mysql
   docker compose -f deploy/aliyun/compose.yaml --env-file deploy/aliyun/.env run --rm -e ALLOW_PRODUCTION_MIGRATIONS=true web node scripts/run-database-migrations.mjs --plan
   docker compose -f deploy/aliyun/compose.yaml --env-file deploy/aliyun/.env run --rm -e ALLOW_PRODUCTION_MIGRATIONS=true web node scripts/run-database-migrations.mjs
   ```

`ALLOW_PRODUCTION_MIGRATIONS=true`只在上述一次性迁移容器中传入，不能写入`.env`或常驻`web`、`ai-worker`和`scheduler`服务。
4. 启动应用、Worker和Scheduler：
   ```bash
   docker compose -f deploy/aliyun/compose.yaml --env-file deploy/aliyun/.env up -d --build
   docker compose -f deploy/aliyun/compose.yaml --env-file deploy/aliyun/.env ps
   ```
5. 将 `nginx.conf` 安装至 `/etc/nginx/conf.d/amz-fullchain.conf`，使用测试域名反向代理到 `127.0.0.1:3000`；完成 HTTP 健康检查后再申请 HTTPS 证书。

## 新版本文件存储与站点地址

- 容器内 `HOST=0.0.0.0`，Compose 仅把 Web 端口映射到宿主机 `127.0.0.1:3000`。已有 systemd 直接运行 Node 时继续使用 `HOST=127.0.0.1`。
- `APP_PUBLIC_URL` 和 `MEETING_AUDIO_PUBLIC_ORIGIN` 均填写青岛站自己的 HTTPS 域名。会议录音转写会使用后者生成短期访问地址，不得沿用朋友的站点域名。
- Compose 为三个进程共享 `app-data:/app/data`，保存 `LOCAL_STORAGE_DIR`、`DESIGN_STUDIO_STORAGE_ROOT`、`MEETING_AUDIO_STORAGE_ROOT`。已有 systemd 部署应配置对应的独立绝对路径，目录归实际运行账号所有、权限 `0700`；备份时连同这些目录一起保存。
- 保留青岛的 `STORAGE_PROVIDER=oss`、原 Bucket 和 Endpoint。新增本地素材／录音目录不代表迁移历史 OSS。切换前核对新版本涉及 OSS 视频分析的兼容性，不用改成全局 local 来绕过。
- 发布镜像带有 Linux 版 `sharp`、`ffmpeg`、`ffprobe` 和 Chromium。不能将 Mac 的 `node_modules` 上传到 Linux 作为运行依赖。

## 每日备份与受控恢复

在ECS上以root或部署用户的crontab创建每日任务；任务只启动一次性备份容器，不把密钥写入crontab。建议每日低峰执行一次，并将ECS云盘快照设为独立的第二恢复层。

```bash
15 03 * * * cd /opt/amazon-listing-tool && docker compose -f deploy/aliyun/compose.yaml --env-file deploy/aliyun/.env --profile tools run --rm db-backup >> /var/log/amz-fullchain-db-backup.log 2>&1
```

备份会先执行一致性逻辑导出，再以独立的`BACKUP_ENCRYPTION_KEY`加密、上传私有OSS、读取对象确认上传成功，并按`BACKUP_RETENTION_DAYS`清理过期对象。恢复是破坏性操作：先停止`web`、`ai-worker`和`scheduler`，再显式提供对象键和确认标志。恢复容器只在私有Docker网络使用MySQL root维护凭据执行建库和导入；不映射3306端口。恢复后应核对目标结构，并执行 `/healthz`、`/readyz` 和关键业务验收。数据库备份不包含 `app-data` 中的本地文件，需单独备份和恢复。

`S3_ENDPOINT`用于应用、Worker、Scheduler和备份容器的服务端对象操作，必须填青岛**内网**Endpoint；`S3_PUBLIC_ENDPOINT`仅用于生成交给浏览器的预签名上传、下载URL，必须填青岛**公网**Endpoint。这样既保证浏览器可访问，又让所有ECS侧OSS访问走同地域内网。

```bash
docker compose -f deploy/aliyun/compose.yaml --env-file deploy/aliyun/.env stop web ai-worker scheduler
docker compose -f deploy/aliyun/compose.yaml --env-file deploy/aliyun/.env --profile tools run --rm db-backup /scripts/restore-mysql.sh backups/mysql/<file>.sql.gz.enc --confirm-restore
```

## 上线前验收

| 检查项           | 预期结果                                                            |
| ---------------- | ------------------------------------------------------------------- |
| `GET /healthz`   | JSON 中 `ok=true`、`draining=false`、`service=web`、`role=web`         |
| `GET /readyz`    | HTTP 200，JSON 中 `ready=true`；数据库及运行配置通过检查              |
| 邮箱密码登录     | 能登录、改密、退出；页面无 Manus OAuth 按钮                         |
| OSS              | 上传对象可成功；数据库仅保存 `storage://oss/...`；下载 URL 有有效期 |
| 模型网关         | 皇帝 Skill 通过外部 OpenAI 兼容网关返回结果；代码和日志不打印密钥   |
| Worker/Scheduler | 三个容器均运行，任务可入队、消费并记录状态                          |
| MySQL/备份       | MySQL无公网端口；手动执行一次备份后，OSS存在加密对象及`.sha256`文件 |
| 回滚             | 在切换 DNS 前，Manus 版本和原数据库保持只读可回退状态               |

## 不可跳过的数据保护

先从当前数据库生成加密备份，并在独立单机MySQL完成恢复演练，再导入真实数据。生产切换前应冻结写入窗口、记录导出时间点，并保留当前 Manus 入口作为短期回滚通道。
