# Amazon Listing Tool - TODO

## 部署任务

- [x] 初始化 Manus webdev 项目（web-db-user 架构）
- [x] 从 GitHub 仓库同步业务代码到 Manus 项目目录
- [x] 安装依赖（pnpm install）
- [x] 配置环境变量（COMPANY_NAME、ERP_TYPE、INSTANCE_ID 等）
- [x] 执行数据库迁移（73 个 SQL 文件，174 张表）
- [x] 修复 offsite 相关表字段命名（驼峰 → 下划线）
- [x] 修复 ad_report_uploads、ad_campaign_reports 等广告报告表
- [x] 创建 kb_intel_sources、kb_intel_items 等知识库情报表
- [x] 创建 product_todos 表，补充 product_profiles.chinese_name 字段
- [x] 修复测试数据时效性问题（devAnalysisOptimization.test.ts）
- [x] 全量测试通过（157 文件 / 3495 用例全部通过）
- [x] 生产构建成功（pnpm run build）
- [x] 保存 Checkpoint 并发布上线

## 待优化项

- [ ] 前端 bundle 体积过大（index.js 9.8MB），建议拆分动态导入
- [ ] 部分 offsite 表仍有冗余旧字段，可在后续版本清理

## 独立账号密码登录（2026-07-08）

- [x] users 表新增 password_hash、must_change_password 字段
- [x] 后端：账号密码登录接口（bcrypt 验证）
- [x] 后端：修改密码接口
- [x] 前端：密码登录页面（与 Manus OAuth 并存）
- [x] 前端：首次登录强制修改密码弹窗
- [x] 预设管理员账号 kangboning（首次登录需改密码）
- [x] 测试通过，保存 Checkpoint 并发布

## GitHub 代码同步（2026-07-09）

- [x] 拉取 GitHub 最新代码（9 个新提交）
- [x] 同步图片知识库相关文件（imageTagConstants.ts、kbDb.ts、kbImages.ts、kbTags.ts、AmazonStyleGallery.tsx、KBImages.tsx、KBTagManagement.tsx、useKBTagOptions.ts）
- [x] 数据库和环境配置保持不变
- [x] 全量测试通过（160 文件 / 3565 用例）
- [x] 保存 Checkpoint 并发布
