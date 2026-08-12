# Step4 Artifact 与会话快照差异调查

调查对象为“空气套件”项目的图片工作流 Step4 会话 `780001`。数据库会话在 2026-08-12 06:11:54 已保存第 3 张辅图的知识库参考图和当前方案文本；但当前正式 Artifact `art_fc93b1ce382e48e426448faad70519da`（v17）仍是 03:49:51 的旧快照。

当前 Artifact 存储地址：

`https://d2xsxph8kpxj0f.cloudfront.net/310419663030562636/a79tkwusxJ5HWpLxCXSSXN/ai-artifacts/global/image/image.workflow.step.4/ea4a3670983a38db435ccfd90bb7a7f5963774252005ab3960441c513ca73be1.json`

旧 Artifact 的 `referenceImagesSummary` 明确写有“未获得带有效备注的用户实拍参考图”，第 3 张辅图 `kbReferenceImages` 为空；而数据库会话的同位置已保存知识库参考图 `360018` 及备注“参考角度和图表设计”。这证实锁定态页面被旧 Artifact 水合覆盖。

修复策略：Step4 确认时必须同步注册当前完整快照为正式 Artifact；展示层以会话已确认快照为文本权威，仅用 Artifact 回填会话缺失的图片资产。
