# 知识库框架文档关键要点

## 核心价值链路
采集 → AI分析 → 人工确认 → 入库 → 被AI调用 → 持续进化

## 跨模块调用机制 (Section 5)
需要实现5个tRPC搜索接口:
1. searchProducts - 按类目检索产品创意知识库
2. searchListings - 按类目+最低分检索Listing文案
3. searchImages - 四维筛选+位置筛选图片
4. searchSkills - 按分类+关键词检索SOP
5. searchVideos - 按类目+视频类型检索视频

## 调用场景
- Listing工具 → Listing文案库 (Few-shot Prompt)
- 产品开发 → 产品创意库 (创新方法论)
- Listing工具 → 图片知识库 (参考图)
- 运营工具 → 运营SOP库 (广告优化SOP)
- 售后工具 → 运营SOP库 (客服话术)
- Listing工具 → 视频知识库 (脚本模板)

## 图片知识库关键设计
- 以ASIN为单位的图片集 (kb_image_sets + kb_images)
- 四维并列标签: 类目/色系/图片类型/设计风格
- 二级筛选: 主图/副图/A+
- 浏览模式: 瀑布流 + 网格
- 同一ASIN下所有图片整合显示

## SOP知识库
- 支持格式: PDF/Word/Excel/PPT/Markdown/图片/思维导图/URL/手动
- AI摘要+关键要点提取
- 分类: 广告/库存/Listing/财务/选品/物流等

## 用户交互规范
- 采集进度条
- AI分析结构化卡片展示
- 标签下拉选择可修改
- 评分滑块调整
- 确认入库按钮
