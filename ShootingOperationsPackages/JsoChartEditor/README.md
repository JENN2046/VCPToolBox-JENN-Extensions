# JSO 图表拖拽保存（HTTP 本地可审候选）

JSO 是唯一业务事实源。图表坐标转换成已有场次 ID、资源 ID 和 UTC 时间，先调用现有 day-adjustment/preview；用户核对受影响场次后，点击一次“保存”调用现有 apply。拖动、取消和失败预览都不写事实。已开拍场次只允许拖结束边缘调整预计结束，不重写实际开拍或完成记录。当前界面限制场次原日期内（包括未来日期），步长 5 分钟；未来计划按目标日期日历预览该日后续影响。正在拍摄的预计结束仍仅限当天。跨天移动使用管理页拍摄改期。需要配套 JSO future-chart-drag 候选；旧服务端会拒绝未来拖动，不能视为已上线。

保存由现有 Chat main-process 原生输入捕获绑定到当前窗口、预览与版本。renderer 事件不携带凭据；单独脚本 click 不能保存。复用 JSO 管理员身份、业务校验、摘要、版本检查、幂等操作与回执，无新 Agent 写工具或新审批流程。

本机插件统一负责启动读取/建图、打开后的约 5 秒补读、preview/apply 后回读与回执恢复，全部使用现有 HTTP bridge。无需前轮 Chat 68bb5bc 的定时器、WS 刷新或 stdio 快照。JSO `/manage` 管理页也每约 5 秒认证读取；这是轮询，不是业务推送。断线后在下一次定时读取恢复，重新打开立即读取，不保证 5 秒硬上限。未保存预览/表单保留，版本变化后需重新核对。范围仅为 `jso-local-candidate` 的可编辑排班图与 `/manage`，普通看板和旧 stdio 只读表格不在范围。

## 包装与配置（尚未安装到日常环境）

历史 HTTP 补读配对基线为合并版 Chat `5af217ad99091e673060c2540ebf8db5bda69223`、Extensions `e9f046ccbd806e9c5f96915fc4cb151430e5baf6` 与 JSO `70c2d828dfced0278029562c94f14dd1cddc98b0`；其中 `dbb6c147b62670fde8ccb93d75de3f8ff51518d5` 仅是管理页自动补读候选，不具备未来日期拖动能力，也不是本轮未来拖动的服务端发布目标。ToolBox 核心固定 `8f489ff09808e26b8469d97b893e1cec6226845c`。不依赖三个仓库前一版自动刷新提交。复用合并版已有 ChartService、图表事件和 nativePort，无宿主核心改动；不承诺更旧日常客户端直接兼容。

未来日期拖动必需的服务端候选是 [JSO #77](https://github.com/JENN2046/jenn-shooting-operations/pull/77)，完整 HEAD 为 [`d08dfd5cbea82e8f18ca675c7f433edbf0741bd7`](https://github.com/JENN2046/jenn-shooting-operations/commit/d08dfd5cbea82e8f18ca675c7f433edbf0741bd7)。这是尚未合并、尚未发布的候选，不是已上线版本；旧服务端（包括上述仅补读候选）仍会以 `DYNAMIC_TODAY_ONLY` 拒绝未来日期预览，单独升级插件提示不能启用能力。

服务端仅需 `Plugin/JsoChartBridge/{plugin-manifest.json,service.cjs}` 和 `ShootingOperationsPackages/JsoChartEditor/bridge.cjs` 三个运行文件，保留相对路径。通过现有插件配置加载：

- `JSO_LOCAL_AGENT_ENDPOINT`：既有 JSO `/api/v2/agent/tools` 地址，仅 HTTPS 或本机回环 HTTP。
- `JSO_RESOURCE_IDS`：既有授权资源 ID，以逗号分隔。

现有 ToolBox 一般 API Bearer 认证保护 `/api/plugins/JsoChartBridge`；每次请求另外核验 JSO 管理员身份及资源权限。不会把资源权限扩大到匿名用户。

本地插件需打包后放入独立客户端的既有 `VCPDistributedServer/Plugin/JsoChartEditor`。产物只有 wrapper/manifest 与 `bundle/{main.cjs,client.cjs,bridge.cjs,runtime.mjs}` 六个运行文件；测试、README 和打包脚本无需装入运行目录。仅创建一个不存在的目标目录，避免覆盖已有插件：

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

源代码回归入口为 `node --test ShootingOperationsPackages/JsoChartEditor/*.test.cjs`，DOM 测试需既有 jsdom 测试依赖；`JSO_CHART_TEST_CHAT_ROOT` 可指定上述 Chat 源码根目录。本地保存并发测试使用该源码的 nativePort。首次安装或热重载插件后重新打开/重载图表页面，不承诺给未重载的旧 runtime 热挂载。

本次交付的固定 SHA、18 个真实隔离 Electron 场景、测试/复审记录和 PR 草稿在配套交付目录。测试驱动输入不是真人验收，未覆盖模型、生产、完整日常客户端、完整 ToolBox server 或实际 TLS 部署。最小发布顺序：先核准并合并上述 JSO #77 候选，记录真实合并 SHA/tree，按该发布身份冻结镜像并走既有 R5 流程部署、核验服务端未来日期能力；再更新本机插件提示并重开图表。若合并 SHA 与候选 HEAD 不同，不得将候选镜像、标签或旧 CI 改标为合并版本；须按真实合并 SHA 重建/绑定并完成必要验证。既有 ToolBox bridge 与 Chat 配置可复用；首次安装才按上文加载 bridge，不因本次升级重配凭据。既有授权值仅通过环境变量引用；本候选不授权日常安装、推送、创建 PR 或部署。
