# 领星官方 MCP 接入依据

本项目仅通过领星官方 Streamable HTTP MCP 读取业务数据，并将每次业务写入置于“读取预览、人工编辑、确认、追加新批次”的流程之后。根据领星官方说明，MCP 请求需要服务器 URL 与 `X-Mcp-Key` 两个独立配置；请求地址和密钥均与当前领星账户权限绑定。[1]

| 项目 | 官方说明 | 本项目治理实现 |
| --- | --- | --- |
| 传输协议 | Streamable HTTP | JSON-RPC 会话初始化与官方端点调用 |
| 调用频率 | 每个 Tool 的 QPS 为 1 | Tool Gateway `perSecond: 1`、并发 1 |
| 店铺范围 | `get_my_sids` 返回可用于其他接口的店铺 sid | 除店铺目录外，业务读取强制 `sid`、`sids`、`profile_id` 或 `profile_ids` |
| 产品表现 | 支持按 ASIN、父 ASIN、MSKU、SKU、国家、店铺、日期及维度筛选 | 映射产品总览草稿与周度父 ASIN 写入 |
| FBA库存 | 支持按 SKU、品名、SPU、FNSKU、仓库、店铺和配送方式筛选 | 映射子 ASIN 库存草稿；缺子 ASIN 或父 ASIN 映射时要求人工核对 |
| 广告数据 | 提供广告活动和广告关键词报表读取 | 映射仅追加的活动/关键词历史报表；不注册预算、竞价、投放状态修改工具 |

领星产品表现将 ASIN、父 ASIN、MSKU 维度的销量、库存、流量、广告与利润指标整合，并支持日、周、月查看；本项目保持现有产品总览的父 ASIN、周度展示结构，不将外部读取直接覆盖历史导入。[2]

## References

[1]: https://www.lingxing.com/help/article/mcp "领星MCP官方说明"
[2]: https://www.lingxing.com/help/article/chanpinbiaoxian "如何全面了解产品的销售情况？"
