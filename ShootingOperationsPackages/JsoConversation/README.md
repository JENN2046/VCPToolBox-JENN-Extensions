# JSO conversation plugin

本地配置驱动候选已经接线：VCPChat 原生输入捕获 → 主进程 IPC → ToolBox 原有认证后的本机 HTTP 入口 → 原生 stdio 插件 → JSO HTTP/SQLite → 原有 VChart。普通明确指令直办；提案在普通消息展示后一次自然确认。保留原文绑定、持久 opID、CAS、同 ID 异内容拒绝、取消和原 ID 回执恢复。没有专用 JSO 登录条、Owner 窗口或新身份注册服务。

ToolBox 必须有最小宿主修改：server.js 路由注册、Plugin.js 每调用 stdio 上下文和新 nativeConversationTransport.js。宿主保留既有凭据，子进程只拿短期本机调用 capability；没有改变外部插件环境过滤、vcp_chat.c2 或 external-direct/hybrid 准入策略。测试用临时 core 插件注册，不能据此声称外部管理目录已获准生产启用。

可信终端是假设：既有 JSO 认证会话、可信主进程及本机输入采集共同关联原文；role:user、human=true、窗口焦点或 schema 本身不证明本人或自然语言语义。模型仅可读取/预览，不能自行授权写入。现有凭据从明确的环境变量引用传入宿主，不创建或迁移真实凭据。

配置默认只读；完整本地链要求显式 native-direct-and-confirm、资源/分钟范围、私有 journal 路径、已有 assistant subject 与默认资源，以及客户端通用 binding。进程异常遗留 journal 锁会拒绝继续写入，需操作者核查无活动进程后恢复；不自动破锁。未知提交仅查原 opID，不重复提交。

最终派发前按当前资源/分钟配置重验持久提案及prepared操作；超限需重新提案，不修改已展示命令。unknown/dispatching仍只查原ID回执。配置层只接收资源可证明且在范围内的reschedule回执，其余回执失败关闭。

先前人工rev8/11验收属于修复前提交；本轮合成回归不构成新版人工或模型验收。

跨进程 journal 锁只保护同步状态转换，网络等待期间释放，继续时持锁重读。既有 journal 保存提案版本和 authorizing 操作认领，避免进程间旧快照覆盖与重复派发；没有新增存储服务。派发前可记录取消；dispatching/unknown 及已提交操作只查询原回执，不声称取消，也不重新派发。authorizing 进程丢失后同样先核对原回执，不盲目重试。进程遗留锁仍不自动删除。

跨进程回归：`JSO_TOOLBOX_SOURCE=/path/to/VCPToolBox node ShootingOperationsPackages/JsoConversation/stdio.test.cjs`。使用真实宿主 authority 模块、临时 journal 和合成上游，不读取运行凭据或业务库。
