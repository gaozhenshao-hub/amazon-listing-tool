-- 领星历史周度数据由旧版单用户导入产生，且当前用户已属于工作空间1。
-- 仅回填空工作空间记录；不修改负责人、经营数据、来源行或其他用户数据。
UPDATE `lingxing_product_weekly` AS weekly
INNER JOIN `users` AS user_record ON user_record.`id` = weekly.`user_id`
SET weekly.`workspaceId` = user_record.`defaultWorkspaceId`
WHERE weekly.`workspaceId` IS NULL
  AND user_record.`defaultWorkspaceId` IS NOT NULL;

-- 产品主档采用同样的兼容归属策略，使负责人主档回退与库存快照同属一个工作空间事实域。
UPDATE `product_profiles` AS profile
INNER JOIN `users` AS user_record ON user_record.`id` = profile.`user_id`
SET profile.`workspaceId` = user_record.`defaultWorkspaceId`
WHERE profile.`workspaceId` IS NULL
  AND user_record.`defaultWorkspaceId` IS NOT NULL;
