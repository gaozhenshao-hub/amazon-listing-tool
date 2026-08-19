# 图片工作流运行时错误记录（2026-08-18）

生产空气套件页面在加载 `ImageWorkflowPage` 时出现 `ReferenceError: getStep5FailurePresentation is not defined`。根因是页面已调用该Step5失败定位工具，但未从 `step5RunState` 导入其命名导出。

修复方式为补齐命名导入，不改变页面结构、路由、业务流程或AI调用。修复后，`ImageWorkflowPage.normalization.test.ts` 与 `step5RunState.test.ts` 共9项测试及页面/状态工具的定向ESLint检查通过。仍需在最新生产资源切换后完成空气套件页面加载复核。

开发预览验收已完成：空气套件会话可以正常进入Step5，设计指南、主图、辅图2–7、A+整体策略与各子图内容均可见，页面不再出现 `getStep5FailurePresentation is not defined`。

生产资源切换复核已完成：直接打开图片工作流页不再出现该ReferenceError，页面可进入安全“开始图片建议工作流”状态。当前生产直达页未水合空气套件会话，因此设计指南与A+整体策略仍需在用户现有空气套件会话上下文中复核。

后续生产会话水合检查发现：页面初始安全空态并不代表最新模块已切换。`imageWorkflow.getSession` 返回空气套件会话后，生产仍加载旧的 `ImageWorkflowPage-DOAcGThx.js`，并再次触发同一 `ReferenceError`。因此当前最新代码已在开发预览验证，但线上仍受旧前端构建资源未切换限制；不得将初始空态视为线上验收通过。
