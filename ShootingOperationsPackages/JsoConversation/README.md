# JSO conversation plugin

本地配置驱动候选已经接线：VCPChat 原生输入捕获 → 主进程 IPC → ToolBox 原有认证后的本机 HTTP 入口 → 原生 stdio 插件 → JSO HTTP/SQLite → 原有 VChart。普通明确指令直办；提案在普通消息展示后一次自然确认。保留原文绑定、持久 opID、CAS、同 ID 异内容拒绝、取消和原 ID 回执恢复。没有专用 JSO 登录条、Owner 窗口或新身份注册服务。

ToolBox 必须有最小宿主修改：server.js 路由注册、Plugin.js 每调用 stdio 上下文和新 nativeConversationTransport.js。宿主保留既有凭据，子进程只拿短期本机调用 capability；没有改变外部插件环境过滤、vcp_chat.c2 或 external-direct/hybrid 准入策略。测试用临时 core 插件注册，不能据此声称外部管理目录已获准生产启用。

可信终端是假设：既有 JSO 认证会话、可信主进程及本机输入采集共同关联原文；role:user、human=true、窗口焦点或 schema 本身不证明本人或自然语言语义。模型仅可读取/预览，不能自行授权写入。现有凭据从明确的环境变量引用传入宿主，不创建或迁移真实凭据。

配置默认只读；完整本地链要求显式 native-direct-and-confirm、资源/分钟范围、私有 journal 路径、已有 assistant subject 与默认资源，以及客户端通用 binding。进程异常遗留 journal 锁会拒绝继续写入，需操作者核查无活动进程后恢复；不自动破锁。未知提交仅查原 opID，不重复提交。

最终派发前按当前资源/分钟配置重验持久提案及prepared操作；超限需重新提案，不修改已展示命令。unknown/dispatching仍只查原ID回执。配置层分别验证 reschedule 与完整采用的 proposalDecision 回执；后者必须带原 decisionId、明确的全部 resourceScope 和 decisionCommandDigest，缺失即拒绝。

R2 候选的普通消息提案使用单个顶层 `vcp-tool-proposal` 块：
`{"tool":"JennShootingOperations","payload":{"action":"adopt_proposal","planningWindowStart":"<RFC3339>","planningWindowEnd":"<RFC3339>"}}`。
宿主提供资源并新建生成与决定 ID。`JSO_NATIVE_REQUEST_IDS` 必须由操作者配置为已核实的 synthetic/non-customer 订单 ID；未配置则禁止采用。生成器复用现有完整算法，若返回白名单外项目则拒绝整个方案，不能裁剪后冒充完整采用。需要更窄候选选择时须先扩展业务生成契约，不使用部分采用绕过。

展示包含全部订单、资源及北京时间起止，后续原生输入才可确认。派发前重新生成并核对 preview proof 与全部项目，再检查当前白名单和五分钟期限。凭据代理、Owner 委托与 JSO 必须一起支持新动作；模型/stdin 采用仍拒绝。未知结果仅按原 decisionId 查回执，核对方案 ID、决定摘要、完整选择与采用项目，不重发。

旧 journal 未标 action 的操作仍按改期解释。不得用旧版会话写入器处理新采用 journal；回退时关闭写入、保留兼容的只读核对组件，不覆盖 journal 或业务库。新增跨仓库检查为 JSO 的 `node --test tests/support/r2-native-adoption.integration.mjs`，须显式设置 `JSO_EXTENSIONS_ROOT` 和 `JSO_TOOLBOX_ROOT`。不更改冻结 paired profile、已接受版本 pin 或生产准入。

先前人工rev8/11验收属于修复前提交；本轮合成回归不构成新版人工或模型验收。

跨进程 journal 锁只保护同步状态转换，网络等待期间释放，继续时持锁重读。既有 journal 保存提案版本和 authorizing 操作认领，避免进程间旧快照覆盖与重复派发；没有新增存储服务。派发前可记录取消；dispatching/unknown 及已提交操作只查询原回执，不声称取消，也不重新派发。authorizing 进程丢失后同样先核对原回执，不盲目重试。进程遗留锁仍不自动删除。

跨进程回归：`JSO_TOOLBOX_SOURCE=/path/to/VCPToolBox node ShootingOperationsPackages/JsoConversation/stdio.test.cjs`。使用真实宿主 authority 模块、临时 journal 和合成上游，不读取运行凭据或业务库。

WebSocket适配的宿主context可提供64位十六进制namespace，仅用于把journal限制到该本人及客户端profile；普通模型参数不能设定宿主context。recover会对未知操作按原ID查回执，并对每资源最近一条已提交操作从当前已保存状态重投图表，以覆盖提交成功但网络回包丢失；不重新授权/提交业务。旧连接的输入或展示资格不随journal恢复。

新建图表模板显示北京时间起止时间、排程版本和投影版本，仍是“显式刷新快照”。ReplaceData 只更新数据，不替换既有图表 runtime；此前用旧模板创建的图表需要另行按既有图表操作重新创建，本补丁不自动迁移个人图表。
