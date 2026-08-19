# 阿里云独立部署包

本目录用于将当前应用部署到**阿里云杭州ECS**。它不会参与 Manus WebDev 的构建：Dockerfile 位于 `deploy/aliyun/`，不会替换项目根目录的托管构建配置。

> 本包默认使用独立 MySQL 8、私有 OSS Bucket、邮箱密码认证和现有 OpenAI 兼容模型网关。上线前不要删除现有 Manus 版本；先以测试域名完成验证，再切换正式入口。

## 资源前置条件

| 资源        | 必要设置                                                              |
| ----------- | --------------------------------------------------------------------- |
| ECS         | 杭州地域，8核16GB，Ubuntu 24.04，安装 Docker Engine 与 Compose Plugin |
| RDS MySQL 8 | 同 VPC 私网访问，4核8GB起，启用自动备份与高权限专用应用账号           |
| OSS         | 杭州私有 Bucket，RAM 最小权限子账号，仅授予指定 Bucket 的读写权限     |
| 网络        | 安全组仅开放 80/443；22 端口限制为管理员 IP；RDS 不开放公网           |
| 域名        | 先准备测试子域名；中国大陆正式域名上线前完成备案与 HTTPS 证书申请     |

## 首次部署顺序

1. 在 ECS 获取仓库，并将本目录的 `environment.template.txt` 复制为 `.env`。**不得**将 `.env` 提交到 Git。
2. 填写 RDS、OSS 和模型网关变量。`AUTH_MODE=local` 与 `VITE_AUTH_MODE=local` 会保留现有邮箱密码登录并隐藏 Manus 登录入口。
3. 先执行数据库迁移：
   ```bash
   docker compose -f deploy/aliyun/compose.yaml --env-file deploy/aliyun/.env run --rm web node scripts/run-database-migrations.mjs --plan
   docker compose -f deploy/aliyun/compose.yaml --env-file deploy/aliyun/.env run --rm web node scripts/run-database-migrations.mjs
   ```
4. 启动三个进程：
   ```bash
   docker compose -f deploy/aliyun/compose.yaml --env-file deploy/aliyun/.env up -d --build
   docker compose -f deploy/aliyun/compose.yaml --env-file deploy/aliyun/.env ps
   ```
5. 将 `nginx.conf` 安装至 `/etc/nginx/conf.d/amz-fullchain.conf`，使用测试域名反向代理到 `127.0.0.1:3000`；完成 HTTP 健康检查后再申请 HTTPS 证书。

## 上线前验收

| 检查项           | 预期结果                                                            |
| ---------------- | ------------------------------------------------------------------- |
| `GET /health`    | 返回 2xx                                                            |
| 邮箱密码登录     | 能登录、改密、退出；页面无 Manus OAuth 按钮                         |
| OSS              | 上传对象可成功；数据库仅保存 `storage://oss/...`；下载 URL 有有效期 |
| 模型网关         | 皇帝 Skill 通过外部 OpenAI 兼容网关返回结果；代码和日志不打印密钥   |
| Worker/Scheduler | 三个容器均运行，任务可入队、消费并记录状态                          |
| 回滚             | 在切换 DNS 前，Manus 版本和原数据库保持只读可回退状态               |

## 不可跳过的数据保护

先从当前数据库生成加密备份并在独立 RDS 完成恢复演练，再导入真实数据。生产切换前应冻结写入窗口、记录导出时间点，并保留当前 Manus 入口作为短期回滚通道。
