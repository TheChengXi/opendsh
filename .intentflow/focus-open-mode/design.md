# 结构设计：聚焦打开模式（Focus Open Mode）

## 0. 与需求文档的偏差（设计阶段新发现）

需求文档将"双页面共享会话"列为 design 决策点；设计阶段深入源码后确认本功能**不需要 DSH 前端聚焦插件之外的任何会话桥接**：

- **偏差1**：需求文档曾把"双页面共享同一 DSH 会话"当作主要技术风险，列为 design 决策（双 iframe vs 单 iframe）。— **影响**：深入 `dsh-client-ui-conversation/lib/client.js`（ConversationRoot）确认 `renderSlot("conversation.session")`（消息流）与 `composerSeat`（输入区，`conversation.composer` 链式插槽）本就是**同级并列座位**；且 DSH 会话是服务端持久化事件日志、前端仅是投影，任何连到同一会话的多个客户端天然同步。故聚焦设计采用**双独立承载面 + DSH 自带同步**，无需自研桥接，也无需回退单 iframe。
- **偏差2**：需求文档把 opendsh 和 DSH 聚焦插件当作统一改动对象。— **影响**：二者是**不同仓库的独立交付物**，耦合点唯一且仅为 **URL 参数契约**（`?focus=conversation` / `?focus=composer`）。本设计文档只负责 opendsh 仓库结构；聚焦插件作为外部协同交付物的接口契约单独记录，不展开其内部结构。
- **偏差3**：需求文档假定聚焦插件"shadow root 自绘布局"。— **影响**：DSH 纯插件加载须构建成 `client.js` 且工程复杂度接近"聚焦插件第一版开发"。确认当前环境（node v25、npm 可用、rc.6 peer 包均在 DSH node_modules）可支撑；但为控制本轮 scope，opendsh 侧只消费 URL 契约，聚焦插件的完整开发/构建排入后续实现阶段（见 design 决策 D3 与 later-on.md）。

## 1. 模块清单

原 opendsh 分层：`extension.js`（上层入口）→ `src/manager.js`（中层编排）→ `src/{detect,process,webview}.js`（下层纯函数/工具）。聚焦模式顺应此分层做增量。

- **[src/focus.js]**：中层（新）— 职责：聚焦双承载面编排——注册并持有 VS Code 侧栏对话视图（webview view）+ 主编辑区输入 webview；根据 config/可用视图组装两个 iframe URL；统一提供 open/stop/dispose 与标签页生命周期管理；承载 createWebviewPanel / registerWebviewViewProvider。— 依赖：`detect`（buildFocusUrls）、`webview`（buildWebviewHtml）、`vscode`；被 `manager` 依赖。
- **[src/manager.js]**：中层（改）— 职责：`open()` 以 openWith=focus 分叉到 `focus.open()`（复用现有 spawn/端口去重/起停流程，仅把"开单页 webview"替换为"开双承载面"）；持有一个 focus 编排器实例；stop/dispose 同步联动 focus 承载面。— 依赖：`detect`、`process`、`webview`、`focus`、`vscode`。
- **[src/detect.js]**：下层（改）— 职责：`resolveConfig` 接受 `focus` 为合法 openWith（非法值仍回退 tab）；新增 `buildFocusUrls` 组装 `{conversation, composer}` 两个 URL（在 base URL 后追加 `/?focus=...`）。— 依赖：无新增。
- **[src/webview.js]**：下层（不改）— `buildWebviewHtml(url)` 已通用（CSP frame-src + iframe），传不同 URL 即可复用，零改动。— 依赖：无。
- **[src/process.js]**：下层（不改）— 端口/进程/WMI 逻辑与聚焦无关，复用。— 依赖：无。
- **[extension.js / package.json]**：上层（改）— 入口逻辑不变；package.json 新增 `contributes.viewsContainers.activitybar`（对话侧栏视图容器）与 `contributes.views`（`opendsh.dsh-chat` 视图）声明，并注入 `context.subscriptions` 生命周期。— 依赖：`focus`（间接经 manager）。

> **DSH 聚焦插件**（不同仓库的外部交付物，不在本模块清单）——接口契约：提供按 `?focus=conversation`（消息流视图，隐藏 sidebar/composer）与 `?focus=composer`（输入区视图，隐藏 sidebar/消息流）渲染的聚焦布局；二者绑定同一会话。opendsh 只消费这两个 URL，不依赖插件内部细节。

## 2. 最小依赖链

聚焦打开从入口到打开的依赖链：

```
extension.js(opendsh.open)
   → manager.open()            [复用 spawn/端口去重/waitForPort]
   → focus.open(config, view)  [openWith=focus 时]
       → detect.buildFocusUrls(host, port) ──→ {conversation, composer} URL
       → webview.buildWebviewHtml(conversationUrl) ──→ 侧栏对话视图 html
       → webview.buildWebviewHtml(composerUrl)   ──→ 主编辑区输入 webview html
       → vscode（view provider 提供 html） / createWebviewPanel
```

跨层依赖体检：
- `extension.js` → `manager`（上层→中层）✅
- `manager` → `focus`（中层→中层，focus 是被 manager 直接编排的同层协作者）✅
- `focus` → `detect` / `webview` / `vscode`（中层→下层 + VS Code SDK）✅
- `detect` / `webview` / `process` 互不依赖、不依赖任何上层 ✅
- 无下层依赖上层 ✅
- **既有跨层依赖**：无（原结构已清晰分层）。

## 3. 测试策略

- **[src/detect.js]** — 类型可验证：单测断言 `openWith='focus'` 不再回退 tab；`buildFocusUrls` 输出两个正确 URL。理由：纯函数，无需运行时。`resolveConfig` 保持依赖注入（传 settings 对象）。
- **[src/focus.js]** — 需运行时行为验证：open 能建侧栏视图 + 主区 webview；stop/dispose 清理两个承载面。依赖注入点：`createFocus({ detect, webview, vscode })`，不内部 require（与 createManager 一致）。单测注入 vscode mock（复用 manager.test 的 mock 模式）覆盖 open/stop/dispose 分支。
- **[src/manager.js]** — 需运行时验证：`openWith='focus'` 走 focus.open 而非单页；其余路径回归。依赖注入：`manager` 构造时注入 `focus`（仿现有 deps 注入模式 `createManager({detect, process: proc, webview, focus})`）。
- **验证命令**：`npm test`（node --test，test/ 下 detect/manager/focus 单测）— 预期：全绿；新增 focus.test.js 覆盖。
- **Mock 边界**：仅 mock `vscode`（系统边界）与 `execFile`（IO），不 mock detect/webview/focus 内部协作者。

## 4. 决策记录

- **决策 D1：聚焦双承载面用"独立 focus 模块 + manager 委托"**
  - 理由：放进 manager 会让 344 行 manager 膨胀并混入侧栏 webview 生命周期逻辑；拆出 focus.js 顺应分层，各管一件事。备选（全部塞 manager）被否：违背"每模块只做一件事"。
  - 影响：manager 构造需注入 focus；manager.open 增加一个 focus 分叉分支；focus 模块独立承载双视图生命周期。

- **决策 D2：opendsh 只消费 URL 契约，聚焦插件为外部独立交付物**
  - 理由：DSH client 插件必须构建为 `client.js` 才可加载，且其源码归属应为独立 npm 包（挂进 dsh 的 profile/patch），不属于 opendsh 仓库。opendsh 与它的唯一耦合是 `?focus=` URL。备选（把聚焦插件代码塞进 opendsh）被否：opendsh 无法向 DSH 伺服跨包 client 插件，且仓库职责混杂。
  - 影响：本 design 不展开聚焦插件内部；聚焦插件的开发/构建/挂载作为协同事项记录（later-on.md）。opendsh 的 `buildFocusUrls` 输出对应 URL 契约。

- **决策 D3：主编辑区输入 webview 用 createWebviewPanel，对话侧栏用 viewsContainers.activitybar + registerWebviewViewProvider**
  - 理由：VS Code 标准侧栏承载 webview 的标准 API 即 webview view provider（contributes.viewsContainers + views）；主区独立 webview 用既有 createWebviewPanel 与现有 tab 模式同构。备选（一个 webview 内嵌双 iframe）被否：不符合"对话收 VS Code 侧栏、输入区留主编辑区"的需求定位，且会挤占编辑区。
  - 影响：package.json 需新增 viewsContainers/views 声明；focus.js 需实现侧栏 view provider 的 resolveWebviewView。

- **决策 D4：detect.buildFocusUrls 追 param（非独立 lib）**
  - 理由：与 `buildUrl` 同属 URL 组装纯函数，同模块内聚；不新开文件避免过度拆。
  - 影响：detect.js 增加一个纯函数 + resolveConfig 的 openWith 白名单加 focus。

## 5. 改动点清单

**改动文件（opendsh 仓库）**
- `package.json` — `opendsh.openWith` enum 加 `"focus"`；新增 `contributes.viewsContainers.activitybar`（`opendsh` 容器）与 `contributes.views`（`opendsh.dsh-chat` 视图）。
- `src/detect.js` — `resolveConfig` openWith 白名单加 `focus`（非法值仍回退 tab）；新增 `buildFocusUrls(host, port)` 返回 `{ conversation, composer }`；更新顶部 @intent 与边界注释。
- `src/manager.js` — 构造注入 `focus`；`open()`/`openWebview` 在 `openWith==='focus'` 时调用 `focus.open(config)`（复用既有 spawn/起停路径）；`stop`/`dispose` 联动 focus 承载面；更新 @intent。
- `src/focus.js`（新）— 聚焦编排：`createFocus({detect, webview, vscode})`，暴露 `open(config)`、`stop()`、`dispose()`、`getState()`；内部注册侧栏对话视图 provider + 主编辑区输入 webview，持双 URL 与生命周期引用。
- `extension.js` — 创建 manager 时注入 focus 实例；无需改命令注册（仍走 opendsh.open）。
- `README.md` — openWith 列出 focus 第 4 选与用法。

**新增文件：`src/focus.js`、`test/focus.test.js`**
- `test/detect.test.js` — 加 focus 合法性与 buildFocusUrls 断言。
- `test/manager.test.js` — 加 focus 分叉断言。

**不改**：`src/webview.js`、`src/process.js`。
