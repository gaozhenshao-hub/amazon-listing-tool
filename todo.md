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

## 风格结构化参数新增「风格特点」字段（2026-07-09）

- [x] imageTagConstants.ts：StyleParams 接口新增 styleFeature 字段，13 个预设风格补充默认值
- [x] KBTagManagement.tsx：预览卡片、新增表单、编辑表单三处同步添加「风格特点」输入项
- [x] 测试通过（kbTags + kbImageOptimization，57 个用例）

## 图片集详情页新布局（2026-07-09）

- [x] 副图缩略图条只保留主图和套图（过滤掉 A+ 和品牌故事图片）
- [x] A+ 内容区：主图下方逐张竖向展开，左侧大图，右侧实时标签+编辑
- [x] 品牌故事区：A+ 下方，横向滚动展示图片，标签在下方显示
