# JSO 图表拖拽保存（本地候选）

JSO 是唯一业务事实源。图表坐标转换成已有场次 ID、资源 ID 和 UTC 时间，先调用现有 day-adjustment/preview；用户核对受影响场次后，点击一次“保存”调用现有 apply。拖动、取消和失败预览都不写事实。已开拍场次只允许拖结束边缘调整预计结束，不重写实际开拍或完成记录。当前界面限制同一天，步长 5 分钟。

保存由现有 Chat main-process 原生输入捕获绑定到当前窗口、预览与版本。renderer 事件不携带凭据；单独脚本 click 不能保存。复用 JSO 管理员身份、业务校验、摘要、版本检查、幂等操作与回执，无新 Agent 写工具或新审批流程。

双向显示使用前一版已有的认证 WS 读取通道，每约 5 秒取快照；JSO 管理页也每约 5 秒认证读取。WS 是传输，当前不是业务推送。可见页面、网络正常时通常下一轮显示；断线或慢请求不保证 5 秒上限。后台网页暂停轮询，重新可见补读。未保存预览/表单保留，版本变化后需重新核对。

## 包装与配置（尚未安装到日常环境）

需采用已验证的 Chat 自动刷新候选、Extensions 自动刷新候选，以及 JSO 管理页自动补读改动。宿主 Chat/ToolBox 核心无需为编辑功能再修改。

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

窗口卸载、销毁和插件 cleanup 会撤销本地输入授权/订阅。断线、重开窗口补读权威数据；旧版本不覆盖新版本，刷新不触发写入。不要人为删除待核对文件来重试保存。

## 隔离复现

本次完整命令、固定 SHA、测试结果、截图和限制见工作区 `DRAG-SAVE-REPORT.md` 与 `evidence/drag-save/`。真实 Electron 输入由测试驱动产生，未进行真人、模型或日常完整客户端验收。日常安装仍需单独授权，不要直接把候选写入日常目录。
