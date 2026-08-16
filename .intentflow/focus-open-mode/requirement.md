# 需求文档：聚焦打开模式（Focus Open Mode）

## 项目意图
让 DSH 对话不挡代码视野——`opendsh.openWith` 新增第 4 种打开方式 `focus`，打开 DSH 时把界面拆成两个独立承载区：AI 对话消息收进 VS Code 侧栏，输入区留在主编辑区，主视野留给代码。

## 功能清单
1. **[openWith 新增 focus 打开方式]**：`opendsh.openWith` 枚举加入 `"focus"`，设为 focus 后点“打开 DSH”进入聚焦模式。
2. **[两个独立界面]**：聚焦模式同时打开两个 webview 承载面——AI 对话消息页 + 输入区页。
3. **[对话消息进 VS Code 侧栏]**：AI 对话消息页放到 VS Code 的 Side View Container（侧栏区），只在需要时展开，默认不占主视野。
4. **[输入区留主编辑区]**：输入区页放到主编辑区 webview，仅输入框（composer），不含聊天记录。
5. **[隐藏 DSH 大侧栏]**：聚焦模式下两个界面都不渲染 DSH 主界面自带的 280px 侧栏（sidebar），只渲染目标窗口。
6. **[聚焦插件]**：给 DSH web 前端挂一个聚焦插件，自绘聚焦布局并按 URL 决定渲染哪个窗口，隐藏 sidebar。

## 核心功能

### 核心功能1：focus 打开方式
- **能力**：系统能够 以 `opendsh.openWith="focus"` 触发 聚焦模式 打开 DSH，且 隐藏 DSH 主界面侧栏。
- **业务价值**：一次点击进入“主视野看代码、对话收侧栏”的工作模式，不用手工搬标签或关侧栏。

### 核心功能2：双界面拆分
- **能力**：系统能够 将同一个 DSH 会话 的 对话消息流 与 输入区 分别渲染到 VS Code 侧栏 和 主编辑区 webview。
- **业务价值**：AI 对话不再占用主编辑区视野，代码最多地露出；要打字交互时在主区输入框操作。

### 核心功能3：聚焦插件（DSH 前端侧）
- **能力**：系统能够 让 DSH web 前端 按 URL 只渲染 指定窗口（消息流 / 输入区）并 隐藏 sidebar，且 不由它决定窗口归属（归属由 opendsh 用 URL 指定）。
- **业务价值**：复用 DSH 原生渲染与插槽机制，不给 DSH 内核打重补丁，升级可随 patch 维护。

## 业务规则

### focus 打开触发的双界面
- **场景**：`opendsh.openWith === "focus"` 且执行 `opendsh.open`。
- **行为**：opendsh 复用现有端口去重/起停逻辑，等待端口就绪后开两个承载面——一个 Side View 承载对话消息页（URL 控制），一个主导航 webview 承载输入区页（URL 控制）。
- **异常处理**：端口被其他程序占用或启动失败时，与现有 tab 模式一致——报错并停止，不开两个承载面。

### 对话消息页与输入区页共享会话
- **场景**：聚焦模式打开后用户在输入区发消息、在侧栏看回复。
- **行为**：两个页面指向同一个 DSH 服务（同一端口），操作的是同一个 DSH 会话（同一 workspace/session）。
- **异常处理**：若聚焦实现意外出现“两个页面各说各话”的双会话（覆盖到 DSH 已提供的同步之外的场景，如不同 URL 被 DSH 当成了不同的会话入口），需在设计阶段校正到同一会话，不能出现两套对话。

### multipleTabs 与 focus 的互斥
- **场景**：用户同时配置 `multipleTabs=true` 与 `openWith=focus`。
- **行为**：focus 模式为固定双界面，忽略 multipleTabs 的影响（multipleTabs 仅对 tab 模式生效）。
- **异常处理**：配置冲突时以 focus 双界面为准，重复点击 open 仍受现有 debounce 节流保护。

### title/status 入口进入 focus
- **场景**：通过标题栏 D 按钮或状态栏按钮触发 open。
- **行为**：与现有 `opendsh.open` 同一入口，是否走聚焦由 `openWith` 设置决定；不进新命令。
- **异常处理**：无额外入口，避免命令/入口爆炸。

## 预设测试

> 从用户视角可执行的测试步骤，验证功能是否符合预期。

### 前置条件
- VS Code 安装 opendsh，已安装全局 `@deepseek-ai/dsh`，打开一个真实工程目录作为 workspace。
- 无 `.dsh/*.patch.yml` 冲突（或已配置聚焦插件 patch overlay）。
- 设置 `opendsh.openWith = "focus"`。

### 测试步骤

1. **[打开聚焦模式]**：点标题栏“打开 DSH”按钮
   **预期结果**：VS Code 右侧出现“DSH 对话”侧栏（Side View），只显示 AI 对话消息流，不显示 DSH 280px 大侧栏；主编辑区出现一个 webview 只含输入框，不含聊天记录。

2. **[主视野是代码]**：在聚焦模式下编辑代码文件
   **预期结果**：编辑器内容占据主视野，AI 对话不覆盖编辑区；侧栏对话默认收起或不抢焦点。

3. **[输入区发消息]**：在主编辑区输入框打字回车
   **预期结果**：消息发送成功；侧栏对话消息页出现新的用户消息与后续 AI 回复。

4. **[回复刷新]**：在侧栏观察回复
   **预期结果**：AI 回复在侧栏消息页实时追加，与主区输入框所在会话一致（同一会话，非两套）。

5. **[切换打开方式回归]**：改回 `opendsh.openWith = "tab"` 再打开
   **预期结果**：回到原有单例 tab 单页行为，侧栏对话不再出现。

### 异常场景

- **[端口被占用]**：某程序占用 opendsh 端口时打开 → 弹窗提示端口被占，不停留半开状态，不开双界面。
- **[启动失败/超时]**：dsh 启动失败 → 与现有逻辑一致，报 stderr 摘要，不误开承载面。
- **[focus 装配缺失]**：聚焦插件未挂载时设置 focus 打开 → 应给可理解的降级或报错（如提示聚焦插件未安装/未挂载，或回退单页），不静默失败。

## 边界收束

**此时必做**：
- openWith 增 `focus` 枚举（缺少则无法触发聚焦模式）。
- 双界面拆分（对话消息页 + 输入区页）——这是聚焦模式本体。
- 隐藏 DSH 大侧栏——否则对话收侧栏后仍有 280px 空列挡视野。
- 双页面共享同一会话（否则出现两套对话，需求不成立）。

**此时不做**：
- 独立新命令 `opendsh.openFocus` — 延后；若评估发现 openWith 触发与“常驻侧栏容器生命周期”冲突时再评估独立入口。
- focus 下 multipleTabs 的精细化语义 — 延后；focus 固定双界面，multipleTabs 仅 tab 生效即可。
- 引入社区库（dsh-side-chat / dsh-split-panes）做它侧边的额外能力 — 延后；本次聚焦模式独立实现，若后续要“选中文本侧边讨论/分屏”再评估复用这些库。

## 实现对齐

锚定实现路径前已读 `.intentflow/_packages/opendsh.yml` 作为现状基线（openWith 三态 set、manager 分叉打开、webview 单例），并探查 DSH 前端源码（`@deepseek-ai/dsh-client-ui-*` 编译产物）。

- **[openWith 增 focus]**：在 `package.json#contributes.configuration.properties.opendsh.openWith` 的 `enum` 加入 `"focus"`，并更新 `detect.js#resolveConfig`（当前非法值回退 `tab`）让 focus 合法；说明文案同步更新 README。测试点在 detect.test.js 覆盖 focus 枚举合法性。
- **[open 分叉到 focus]**：在 `manager.js` 的 `open()` / `openWebview()` 内 `openWith === 'focus'` 分支：复用现有 spawn/起停/端口去重，到 openWebview 时不建 DSH 单例 tab，而是打开 Side View 容器（对话页）与当前列 webview（输入区页）。测试点在 manager.test.js 增加 focus 分支断言。
- **[对话消息页进 VS Code 侧栏]**：opendsh 注册一个 `contributes.views` / `viewsContainers.activitybar`（或 sidebar）的 Side View，webview 内 iframe 指到聚焦插件按“消息流”URL（如 `http://host:port/?focus=conversation`）。DSH 前端插槽已验证：`conversation.session` → `conversation.view` → `conversation.chat.node` 承载消息流，可被聚焦插件单独渲染、隐藏 sidebar/composer。
- **[输入区页留主编辑区 webview]**：opendsh 用现有 `createWebviewPanel`（新建、非单例复用，focus 模式每次 open 重建或复用均可）承载输入区页，iframe 指到聚焦插件按“输入区”URL（如 `http://host:port/?focus=composer`）。DSH 前端插槽已验证：`conversation.composer` 是 `renderSlotChain("conversation.composer", ...)` 的独立子插槽，可仅渲染输入区（InputBar）而不渲染聊天记录。
- **[隐藏 DSH 大侧栏]**：聚焦插件 shadow `root` 插槽（priority 低于 AppFrame 的 0，如 -1），自绘聚焦布局，只渲染目标窗口，不渲染 `sidebar` 三栏 grid；DSH 原生无 URL/配置可藏 sidebar，需靠此插件层实现。
- **[聚焦插件装配]**：独立 DSH client 插件（npm 包或本地 link 包），经 patch（用户 profile 的 `cordis.patch.yml` 或 `--patch` overlay）挂载一行；opendsh 启动的 dsh 需确保该插件行生效。基线对齐 `@deepseek-ai/dsh@0.1.0-rc.6`（与社区 dsh-side-chat 同基线）。不动 dsh 主体源码、不重构建内核。

**推导出的约束**（agent 基于环境探查 + 用户实证推导，需用户确认）：
1. DSH web 前端是单一 SPA，无现成“只渲染某窗口 + 隐藏侧栏”开关 → 聚焦能力必须由聚焦插件（shadow root + URL 自读）补上，无法只靠 opendsh 配置。基于此，聚焦模式的前置是聚焦插件存在且挂载，对吗？
2. 输入区（`conversation.composer`）与消息流（`conversation.session/view`）在插槽层可分离渲染；两个独立前端实例浏览不同的聚焦 URL 时，DSH 自带的跨实例会话同步会保证两者读写同一会话（用户已实证：日常开两个页面时输入框消息实时同步）。**聚焦插件无需自研跨实例桥接。** 但需在实现阶段确认 DSH 的同步对“侧栏只渲染消息流、主区只渲染输入区”这种非对称拆分同样成立。
3. openWith 枚举与回退逻辑（detect.js）当前对非法值回退 tab；加入 focus 后需合法化。

**design 决策**（方案比较类，交由 design 阶段选择）：
1. 聚焦插件按 URL 控制窗口的参数命名与解析方式：`?focus=conversation|composer` 或按 id 等。
2. 对话消息页 Side View 的容器类型：自定义 `viewsContainers.activitybar`（像 vsix 侧栏）还是借现有次级侧栏区。
3. focus 模式下发消息、输入区用 DSH 原生 composer 组件 vs opendsh 侧更轻量输入框。
4. （单 iframe vs 双 iframe 已不再构成冲突）——双独立 iframe + DSH 自带同步即可，除非实现阶段发现 DSH 同步在非对称拆分下失效，才需回退到单 iframe 内含分区渲染。
