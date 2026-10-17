# JSO 图表拖拽保存（本地候选）

JSO 是唯一业务事实源。图表坐标转换成已有场次 ID、资源 ID 和 UTC 时间，先调用现有 day-adjustment/preview；用户核对受影响场次后，点击一次“保存”调用现有 apply。拖动、取消和失败预览都不写事实。已开拍场次只允许拖结束边缘调整预计结束，不重写实际开拍或完成记录。当前界面限制同一天，步长 5 分钟。

保存由现有 Chat main-process 原生输入捕获绑定到当前窗口、预览与版本。renderer 事件不携带凭据；单独脚本 click 不能保存。复用 JSO 管理员身份、业务校验、摘要、版本检查、幂等操作与回执，无新 Agent 写工具或新审批流程。

此分支是可丢弃 HTTP 单链路原型：本机插件统一负责启动读取/建图、打开后的约 5 秒补读、preview/apply 后回读与回执恢复，全部使用现有 HTTP bridge。无需前轮 Chat 68bb5bc 的定时器、WS 刷新或 stdio 快照。JSO 管理页也每约 5 秒认证读取；这是轮询，不是业务推送。断线后在下一次定时读取恢复，重新打开立即读取，不保证 5 秒硬上限。未保存预览/表单保留，版本变化后需重新核对。

## 包装与配置（尚未安装到日常环境）

本原型基于合并版 Chat 5af217a、Extensions e9f046c 与 JSO 70c2d82；仅加入本目录编辑插件/bridge 和 JSO 管理页自动补读改动，不包含三个仓库前一版自动刷新提交。复用合并版已有 ChartService、图表事件和 nativePort，无宿主核心改动。旧 stdio 只读表格不会因此自动刷新，不在本原型兼容范围内。

服务端使用既有 ToolBox 插件目录中的 `Plugin/JsoChartBridge` 与本目录 `bridge.cjs`，保留相对路径。通过现有插件配置加载：

- `JSO_LOCAL_AGENT_ENDPOINT`：既有 JSO `/api/v2/agent/tools` 地址，仅 HTTPS 或本机回环 HTTP。
- `JSO_RESOURCE_IDS`：既有授权资源 ID，以逗号分隔。

现有 ToolBox 一般 API Bearer 认证保护 `/api/plugins/JsoChartBridge`；每次请求另外核验 JSO 管理员身份及资源权限。不会把资源权限扩大到匿名用户。

本地插件需打包后放入独立客户端的既有 `VCPDistributedServer/Plugin/JsoChartEditor`。仅创建一个不存在的目标目录，避免覆盖已有插件：

```sh
node ShootingOperationsPackages/JsoChartEditor/stage-client.cjs /absolute/new/staging/JsoChartEditor
```

通过现有客户端插件配置设置以下三个非敏感项：

- `JSO_CHART_BRIDGE_URL`：上述 `/api/plugins/JsoChartBridge` 地址。
- `JSO_CHART_TRANSPORT_TOKEN_ENV`：保存既有 ToolBox API token 的环境变量名。
- `JSO_CHART_APPLICATION_AUTHORIZATION_ENV`：保存既有 JSO `Bearer …` 管理员授权值的环境变量名。

不新增、不复制到 renderer、不轮换凭据。插件只有配置有效才启用。仅将两个已知原始 JSO 图表模板升级为编辑界面，不覆盖用户自定义 runtime。未知模板保持原状。

## 结果未知与清理

发送保存前，在客户端 userData 的 `JSOChartEditor/pending.json` 以私有权限记录原操作 ID 和原命令，不含 token。回包丢失后禁止再次提交，通过“核对保存结果”或重开窗口按原 ID 只读核对。没有回执时继续保持待核对，不把超时当成失败或另起写入。

窗口卸载、销毁和插件 cleanup 会撤销本地输入授权/订阅。所有编辑视图关闭后停止周期 HTTP 读取；插件启动只读一次以创建图表目录项，若首次读取失败且尚无图表，允许约 5 秒重试引导，建图后关闭窗口不继续读取。断线后下一轮重试只读，重开窗口立即补读权威数据；旧版本不覆盖新版本，刷新不触发写入。不要人为删除待核对文件来重试保存。

## 隔离复现

本原型完整命令、固定 SHA、测试结果、截图和限制见工作区 `HTTP-PROTOTYPE-REPORT.md` 与 `evidence/http-prototype/`。真实 Electron 输入由测试驱动产生，未进行真人、模型或日常完整客户端验收。日常安装仍需单独授权，不要直接把原型写入日常目录。
