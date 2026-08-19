# 阿里云独立部署包

本目录用于将当前应用部署到**阿里云杭州ECS**。它不会参与 Manus WebDev 的构建：Dockerfile 位于 `deploy/aliyun/`，不会替换项目根目录的托管构建配置。

> 本包默认使用**ECS内的Docker MySQL 8.4**、私有 OSS Bucket、邮箱密码认证和现有 OpenAI 兼容模型网关。MySQL不会开放3306端口；应用、Worker和Scheduler只通过内部Docker网络访问它。上线前不要删除现有 Manus 版本；先以测试域名完成验证，再切换正式入口。

## 资源前置条件

| 资源        | 必要设置                                                              |
| ----------- | --------------------------------------------------------------------- |
| ECS         | 杭州地域，4核8GB、100GB ESSD PL1、Ubuntu 24.04，安装 Docker Engine 与 Compose Plugin |
| MySQL 8.4   | 与应用同机Docker卷持久化；不开放3306；每日加密逻辑备份至私有OSS与云盘快照 |
| OSS         | 杭州私有 Bucket，RAM 最小权限子账号，仅授予指定 Bucket 的读写权限     |
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

## 每日备份与受控恢复

在ECS上以root或部署用户的crontab创建每日任务；任务只启动一次性备份容器，不把密钥写入crontab。建议每日低峰执行一次，并将ECS云盘快照设为独立的第二恢复层。

```bash
15 03 * * * cd /opt/amazon-listing-tool && docker compose -f deploy/aliyun/compose.yaml --env-file deploy/aliyun/.env --profile tools run --rm db-backup >> /var/log/amz-fullchain-db-backup.log 2>&1
```

备份会先执行一致性逻辑导出，再以独立的`BACKUP_ENCRYPTION_KEY`加密、上传私有OSS、读取对象确认上传成功，并按`BACKUP_RETENTION_DAYS`清理过期对象。恢复是破坏性操作：先停止`web`、`ai-worker`和`scheduler`，再显式提供对象键和确认标志。恢复容器只在私有Docker网络使用MySQL root维护凭据执行建库和导入；不映射3306端口。恢复后应重新运行迁移与`/health`验收。

`S3_ENDPOINT`用于应用、Worker、Scheduler和备份容器的服务端对象操作，必须填杭州**内网**Endpoint；`S3_PUBLIC_ENDPOINT`仅用于生成交给浏览器的预签名上传、下载URL，必须填杭州**公网**Endpoint。这样既保证浏览器可访问，又让所有ECS侧OSS访问走同地域内网。

```bash
docker compose -f deploy/aliyun/compose.yaml --env-file deploy/aliyun/.env stop web ai-worker scheduler
docker compose -f deploy/aliyun/compose.yaml --env-file deploy/aliyun/.env --profile tools run --rm db-backup /scripts/restore-mysql.sh backups/mysql/<file>.sql.gz.enc --confirm-restore
```

## 上线前验收

| 检查项           | 预期结果                                                            |
| ---------------- | ------------------------------------------------------------------- |
| `GET /health`    | 返回 2xx                                                            |
| 邮箱密码登录     | 能登录、改密、退出；页面无 Manus OAuth 按钮                         |
| OSS              | 上传对象可成功；数据库仅保存 `storage://oss/...`；下载 URL 有有效期 |
| 模型网关         | 皇帝 Skill 通过外部 OpenAI 兼容网关返回结果；代码和日志不打印密钥   |
| Worker/Scheduler | 三个容器均运行，任务可入队、消费并记录状态                          |
| MySQL/备份       | MySQL无公网端口；手动执行一次备份后，OSS存在加密对象及`.sha256`文件 |
| 回滚             | 在切换 DNS 前，Manus 版本和原数据库保持只读可回退状态               |

## 不可跳过的数据保护

先从当前数据库生成加密备份，并在独立单机MySQL完成恢复演练，再导入真实数据。生产切换前应冻结写入窗口、记录导出时间点，并保留当前 Manus 入口作为短期回滚通道。
