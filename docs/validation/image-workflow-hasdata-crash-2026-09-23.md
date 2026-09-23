# 图片工作流页面崩溃诊断与修复

**日期：** 2026-09-23  
**用户症状：** 在图片工作流中，页面显示全页错误边界，错误为 `ReferenceError: hasData is not defined`。  
**影响范围：** 图片工作流 Step 4「参考图确认」页面；模型调用、图片任务和已保存数据未被此错误删除或修改。

## 根因

这不是模型服务、服务器内存或图片生成任务崩溃。该错误发生在浏览器前端渲染阶段：`Step4References` 将 `hasData={hasData}` 传入参考图头部组件，却没有在当前组件作用域定义 `hasData`。JavaScript 在渲染时抛出 `ReferenceError`；应用只有全局错误边界，因此整个图片工具页被“An unexpected error occurred”页面替代。

图片流程比普通页面更容易暴露这类问题，是因为它包含多步骤会话水合、后台任务轮询、逐图确认、上传与重排等高频异步状态切换。历史上已经发现并修复过稳定列表键、旧任务状态覆盖、遗漏导入等相邻问题；本次错误是其中一个明确、独立的前端派生状态遗漏，并非说明图片模型无法运行。

## 修复

Step 4 现在从当前已水合的编辑数据派生状态：

```ts
const hasData = Boolean(editData?.imageReferences?.length);
```

该状态与确认状态保持独立：有参考图不等于已经确认。新增回归契约确保变量在传给 `ReferenceImagesHeader` 前定义，并同时验证 `isConfirmed` 的独立传递。

## 验证与发布

定向 Step 4 回归共 **4 个测试文件、9 项测试**全部通过；ESLint、生产构建和 Bundle 预算通过，修改文件没有新增 TypeScript 诊断。完整 TypeScript 检查仍显示项目既有的 152 项历史诊断，未将其误报为本次修复失败或全绿。

青岛完成无迁移原子发布：Web、Worker、Scheduler 均为 `active`，本机 HTTP 为 `200`，入口 SHA-256 与构建包一致。公共域名已引用新的 `ImageWorkflowPage-BPkLyQxE.js`，而截图中的旧资源为 `ImageWorkflowPage-DqvPhBt.js`。本次没有调用模型、没有创建或重试图片任务，也没有改动用户已保存的图片工作流会话。

用户随后提供的第二张截图来自 Manus 托管域名，而不是青岛独立站。该截图中的旧资源 `ImageWorkflowPage-DIbEJlJg.js` 已返回 `404`；托管站点入口已切换到新的 `ImageWorkflowPage-Byp-mLmX.js`。静态检查确认新资源将头部的 `hasData` 参数绑定到编译后的已定义派生变量，而不再引用未声明标识符。因此两处站点都不再提供截图中的崩溃资源。

## 用户侧操作

请重新打开图片工作流，或用浏览器强制刷新一次以加载新资源。旧的哈希资源不会再被最新入口引用；若某个已打开的标签页仍保留旧脚本，关闭该标签页再进入即可。
