# 图片工作流运行时错误记录（2026-08-18）

生产空气套件页面在加载 `ImageWorkflowPage` 时出现 `ReferenceError: getStep5FailurePresentation is not defined`。根因是页面已调用该Step5失败定位工具，但未从 `step5RunState` 导入其命名导出。

修复方式为补齐命名导入，不改变页面结构、路由、业务流程或AI调用。修复后，`ImageWorkflowPage.normalization.test.ts` 与 `step5RunState.test.ts` 共9项测试及页面/状态工具的定向ESLint检查通过。仍需在最新生产资源切换后完成空气套件页面加载复核。

开发预览验收已完成：空气套件会话可以正常进入Step5，设计指南、主图、辅图2–7、A+整体策略与各子图内容均可见，页面不再出现 `getStep5FailurePresentation is not defined`。
