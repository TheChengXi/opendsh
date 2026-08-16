# 结构设计：活动栏快捷启动面板（launcher-panel）

## 0. 与需求文档的偏差（设计阶段新发现）

- **偏差**：面板 HTML 需要 JS（按钮点击发 postMessage、接收扩展回传更新高亮），而 VS Code webview 的 base CSP 禁内联脚本。
  — **影响**：面板脚本必须是外部文件 `media/panel.js`，经 `asWebviewUri` 引用；不能像 webview.js 那样整页内联。
- **偏差**：需求文档写「删 focus 运行代码只留文档」，但内容区按钮必须复用 `?focus=` 单区能力。
  — **影响**：`src/focus.js` 不是删除而是**改造**——删掉「聚焦模式编排」（上下分栏 applyLayout + 一次开三 panel 的 open），保留/新增「单区打开」（openArea）。需求阶段已口头确认此推论，这里落为正式改动边界。
- **偏差**：需求文档说「删 openWith=focus 入口」，落到代码是 4 处而非 1 处。
  — **影响**：`detect.js`（openWith 合法值）、`manager.js`（focus 分支）、`package.json`（enum）、`focus.js`（编排）四处都要动，缺一处会残留半死代码。

## 1. 模块清单

- **src/panel.js**：上层（交互）— 职责：活动栏 WebviewView provider，生成本地 HTML 按钮列表、处理 postMessage 分发到 manager 动作、回传高亮状态 — 依赖：`vscode`（外部）、`manager`（中间层）。
- **src/manager.js**：中间层（编排）— 职责：生命周期编排（spawn/等待/打开/停止）+ 打开方式状态（globalState）+ 打开分叉（tab/simpleBrowser/systemBrowser）+ 单区打开委托 — 依赖：`detect`/`process`/`webview`/`focus`（下层）、`vscode`。
- **src/focus.js**：中间层（承载打开，被 manager 委托）— 职责：单区 WebviewPanel 的创建/复用/清理（openArea）— 依赖：`detect`/`webview`（下层）、`vscode`。
- **src/detect.js**：下层（纯函数）— 职责：配置解析（openWith 合法值收敛为 tab/simpleBrowser/systemBrowser）+ URL 组装（buildUrl / buildFocusUrls 保留）— 依赖：`fs`/`path`。
- **src/webview.js**：下层（纯函数）— 职责：webview iframe 壳 html 生成（tab 与单区 panel 共用）— 依赖：无。
- **src/process.js**：下层（系统边界）— 职责：spawn/WMI/端口探测/进程终止 — 依赖：node 内置。
- **extension.js**：装配入口 — 职责：装配各模块、注册命令/状态栏/URI/autoStart/活动栏面板 — 依赖：以上全部。

## 2. 最小依赖链

```
[面板按钮(打开方式)] → panel.js → manager.openWith(mode)
                              → setOpenWith(globalState) + open()
                              → detect.resolveConfig + process.spawnDsh + webview.buildWebviewHtml
[面板按钮(内容区)]  → panel.js → manager.openArea(key)
                              → focus.openArea(key, config)
                              → detect.buildFocusUrls + webview.buildWebviewHtml
[现有入口 open]     → extension(命令/状态栏/URI/autoStart) → manager.open()
                              → 内部读 getOpenWith()（globalState 优先）
```

**跨层体检**：panel → manager（上层→中间层 ✅）；manager → focus/detect/process/webview（中间层→下层 ✅）；focus → detect/webview（中间层→下层 ✅）；detect/process/webview 不依赖任何上层（✅）。无反向依赖、无跨层依赖。新增 panel.js 只依赖 manager，不直接碰 detect/process，避免上层绕过编排层。

## 3. 测试策略

- **src/panel.js**：
  - `buildPanelHtml(mode)` 纯函数——肉眼/字符串断言（按钮数量、当前 mode 高亮标记、脚本引用 asWebviewUri）。
  - 消息分发——运行时行为验证，fake `vscode`（registerWebviewViewProvider 捕获 resolve 回调 + onDidReceiveMessage 捕获）+ fake `manager`（记录 openWith/openArea 调用）。
  - 依赖注入点：`createPanel({ vscode, manager })`，内部不 require vscode/manager。
- **src/focus.js**（openArea）：
  - fake `vscode`（createWebviewPanel 记录、onDidDispose）+ 真 detect/webview；验证单区创建/复用/关闭后重建/不重复创建。
  - 依赖注入点：`createFocus({ detect, webview, vscode })`（沿用现有）。
- **src/manager.js**：
  - fake vscode（getConfiguration + globalState）+ fake focus/process/detect；验证 getOpenWith 优先级（globalState > settings）、openWith 分叉、openArea 委托。
  - 依赖注入点：`createManager({ detect, process, webview, focus, vscode })`（沿用现有）。
- **src/detect.js**：纯函数直接断言（openWith 合法值不含 focus、buildFocusUrls 三值不变）。
- **验证命令**：`node --test` — 预期：全绿（含新 panel.test.js）。
- **Mock 边界**：只 mock 系统边界（vscode、process 的 spawn/端口），不 mock 内部协作者（detect/webview 用真实现）。

## 4. 决策记录

- **决策**：保留 `src/focus.js` 文件名，职责收敛为「单区承载打开」，删 applyLayout + open（一次开三），新增 openArea(urlKey, config)。
- **理由**：`?focus=` 契约仍叫 focus，文件名与契约语义一致；改名牵动 extension/manager/test 引用与 git 历史，收益低。单区能力是内容区按钮的底层，必须活着。对比方案：新建 area.js + 删 focus.js——等价但多一次文件搬移，无收益。
- **影响**：focus.js 不再是「编排器」而是「单区打开器」；VIEW_SPECS 删除 column 字段（不再分栏），panel 统一 ViewColumn.One；manager 的 focus 分支删除，改由 panel 按钮触发 openArea。

- **决策**：活动栏面板用 `registerWebviewViewProvider`（WebviewView）承载本地 HTML 按钮列表，不加载 http；按钮→扩展经 postMessage。
- **理由**：此前踩坑——WebviewView 的 iframe 加载外部 http 会被 VS Code 透明化（白屏），但面板自身只渲染本地按钮、不嵌 http，故 WebviewView 可用；而内容区/完整 UI 仍用 WebviewPanel（加载 http 正常）。WebviewView 是常驻侧边栏的唯一标准容器。
- **影响**：面板 HTML 的脚本必须外部文件（base CSP 禁内联）；面板与扩展的交互全走 postMessage 消息协议。

- **决策**：打开方式状态归 manager——`getOpenWith()`（globalState 优先，settings.openWith 作默认）、`setOpenWith(mode)`（写 globalState）、`open()` 内部用 getOpenWith()；panel 只读状态做高亮。
- **理由**：打开方式是业务状态，归编排层 manager 内聚；settings.openWith 保留作首次默认值（用户确认）。panel 不持有状态，避免状态散两处。
- **影响**：globalState key = `opendsh.openWith`；settings.openWith enum 去掉 focus；现有 open 入口（命令/状态栏/URI/autoStart）自动吃到 globalState。

- **决策**：内容区按钮 → `manager.openArea(key)` → `focus.openArea`，按 viewId 单例复用 panel（复用/关闭后重建/清引用），不新建重复。
- **理由**：与现有 focus 的 panels Map 复用机制一致；单区 panel 点两次应聚焦而非新建。
- **影响**：单区 panel 无上下分栏；三个区各自独立 panel，互不联动。

- **决策**：面板消息协议分两类——`{type:'openArea', key}`、`{type:'openWith', mode}`；扩展处理 openWith 后 postMessage 回 webview `{type:'highlight', mode}` 更新高亮。
- **理由**：按钮→动作映射清晰；高亮更新走增量消息（外部脚本改 class），比整页重设 html 无闪烁。
- **影响**：`media/panel.js` 需实现发送（按钮 click → postMessage）与接收（highlight → 更新高亮）两向逻辑。

## 5. 改动点清单（已有项目）

**新增文件**：
- `src/panel.js` — 活动栏面板 provider（buildPanelHtml + register + 消息分发）。
- `media/panel.js` — 面板前端脚本（按钮 click → postMessage；接收 highlight → 更新高亮）。
- `test/panel.test.js` — panel 模块单测。

**修改文件**：
- `src/focus.js` — 删 applyLayout/open（一次开三），VIEW_SPECS 去 column，新增 openArea；导出调整。
- `src/manager.js` — 删 openWebview 的 focus 分支；新增 getOpenWith/setOpenWith/openWith/openArea；open 读 getOpenWith。
- `src/detect.js` — resolveConfig 的 openWith 合法值去掉 focus（buildFocusUrls 保留不动）。
- `extension.js` — 装配 panel（依赖 manager）、注册活动栏视图 provider；focus 注入保留（单区打开器）。
- `package.json` — openWith enum 去 focus；新增 viewsContainers(activitybar) + views(type:webview) 声明面板视图与图标。
- `test/focus.test.js` — 改测 openArea（单区创建/复用/重建），删 applyLayout 断言。
- `test/manager.test.js` — 更新（focus 分支删除、getOpenWith/setOpenWith/openArea 委托）。
- `test/detect.test.js` — 更新（openWith 不含 focus）。

**不动的文件**：`src/webview.js`、`src/process.js`、`test/webview.test.js`、`test/process.test.js`、`media/dsh-activity.svg`（复用为活动栏图标）。
