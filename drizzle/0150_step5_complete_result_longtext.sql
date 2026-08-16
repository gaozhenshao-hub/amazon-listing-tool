-- Step5 分段生成会产生完整的A+ 1–7、品牌故事和设计建议；结果可超过TEXT的65,535字节上限。
-- 使用LONGTEXT保留可编辑原始结果、重试错误与Agent检查点诊断，不截断人工审核链路。
ALTER TABLE image_workflow_sessions
  MODIFY COLUMN step5AiResult LONGTEXT NULL,
  MODIFY COLUMN step5AiResultCn LONGTEXT NULL,
  MODIFY COLUMN step5UserEdit LONGTEXT NULL,
  MODIFY COLUMN step5RunError LONGTEXT NULL,
  MODIFY COLUMN step5OptimizedResult LONGTEXT NULL,
  MODIFY COLUMN step5OptimizedResultCn LONGTEXT NULL;

ALTER TABLE emperor_agent_checkpoints
  MODIFY COLUMN errorMessage LONGTEXT NULL;
