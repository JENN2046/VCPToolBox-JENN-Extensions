<!-- JSO_JEV_CAPABILITY_R1_BEGIN -->
- `{拍摄运营}`：Jenn Shooting Operations 的业务语义入口，用于读取当前项目、任务、排期与状态，也可把排期或任务修改意图整理成**不执行写入**的 proposal。
- Agent 不需要记忆真实插件名、HTTP 路径、revision 参数或 scheduler credential。
- 查询、检查、分析类请求只读取当前 JSO truth。
- 带有“安排、移动、调整、删除、创建、修改、更新、提交、保存”等修改意图时，JEV 只路由到 read/propose capability，不得因为自然语言出现修改动作就自动写 production。
- 真正 production 写入由独立 PROD-10 acceptance harness 执行，并继续受 exact Action ID、revision guard、idempotency 与 verification pull 约束。
- 示例：`JEV:「始」请使用 {拍摄运营}，查看【今天有什么要拍的】。「末」`
- 示例：`JEV:「始」请使用 {拍摄运营}，提出【把音箱项目安排到周三下午】的变更提议。「末」`
<!-- JSO_JEV_CAPABILITY_R1_END -->
