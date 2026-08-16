# 需求文档：活动栏快捷启动面板（launcher-panel）

## 项目意图
把 DSH 的打开方式从「设置项切换」改为「活动栏面板快捷按钮」，点击即启动；并移除「聚焦模式（focus）」这个整体打开方式，只保留 `?focus=` 单区契约供内容区按钮复用。

## 功能清单
1. **活动栏 DSH 图标按钮**：注册在 activity bar，点击展开一个侧边栏面板（WebviewView，本地 HTML）。
2. **内容区快捷按钮（3 个）**：会话列表 / 消息流 / 输入区，点哪个开哪个单区承载面板。
3. **打开方式快捷按钮（3 个）**：内置标签页 / Simple Browser / 系统浏览器，点哪个立即用哪个打开完整 DSH UI。
4. **打开方式状态切换**：面板按钮单选高亮，状态经 globalState 跨会话记忆，settings.openWith 仅作初始默认值。
5. **移除聚焦模式**：删 `openWith=focus` 入口与上下分栏三 panel 编排，保留 `?focus=` URL 契约。

## 核心功能

### 核心功能1：活动栏快捷启动面板
- **能力**：系统能够在 activity bar 注册一个 DSH 图标按钮，点击展开一个侧边栏面板，面板承载 3 个内容区按钮 + 3 个打开方式按钮（纯本地 HTML 按钮列表，不加载外部 http）。
- **业务价值**：所有打开入口集中到一个活动栏面板，一键直达，不依赖设置项。

### 核心功能2：打开方式快捷切换
- **能力**：系统能够点击任一打开方式按钮后立即用该方式打开完整 DSH UI（tab 单例 / Simple Browser 新标签页 / 系统浏览器），并把该方式记为「当前打开方式」——单选高亮 + globalState 跨会话记忆。
- **业务价值**：三种打开方式随手切换并即时生效，不必去 settings 改 `openWith`。

### 核心功能3：内容区单区快捷打开
- **能力**：系统能够点击内容区按钮（会话列表/消息流/输入区）后打开对应的单区 WebviewPanel，复用 `?focus=sidebar / ?focus=conversation.session / ?focus=conversation.composer` 契约，单个区承载、非上下分栏。
- **业务价值**：直接跳到会话列表或输入区，无需手动切界面。

## 业务规则

### 打开方式状态（globalState 记忆）
- **场景**：点击任一打开方式按钮。
- **行为**：该按钮高亮（三选一），写 globalState 记录当前打开方式，并立即按该方式打开完整 DSH UI。
- **异常处理**：globalState 无值（首次使用）时回退 settings.openWith 作为默认值。

### 内容区按钮（单区承载）
- **场景**：点击任一内容区按钮。
- **行为**：确保 dsh 服务就绪（未启动则先启动并等待端口，复用 manager 现有 spawn/等待编排），然后打开对应单区 WebviewPanel；同区 panel 已存活则复用（reveal），不重复新建。
- **异常处理**：panel 创建抛错回退 openExternal（与现有 tab 分支一致）。

### 打开方式按钮（完整 UI 打开）
- **场景**：点击任一打开方式按钮。
- **行为**：确保 dsh 服务就绪后，按所选方式打开完整 DSH UI（不带 `?focus=`）；tab 走单例标签页、simpleBrowser 每次新标签页、systemBrowser 直开系统浏览器。
- **异常处理**：simpleBrowser 抛错回退 openExternal；服务启动失败弹错不打开（现有行为）。

### 移除聚焦模式
- **场景**：`opendsh.openWith` 枚举去掉 `focus`。
- **行为**：聚焦模式不再作为打开方式；已有 `openWith: focus` 的用户配置失效，回退默认 `tab`。
- **异常处理**：无（非法枚举值一律回退 tab，沿用 resolveConfig 现有回退规则）。

## 预设测试

### 前置条件
- VS Code 已安装 opendsh 扩展（新版本）。
- dsh 服务可启动（或已在 127.0.0.1:3081 运行）。
- DSH 侧聚焦插件已装（`?focus=` 契约生效）。

### 测试步骤

1. **打开活动栏面板**：点活动栏 DSH 图标
   **预期结果**：展开侧边栏面板，显示 3 个内容区按钮 + 3 个打开方式按钮，当前打开方式按钮高亮。
2. **内容区：输入区**：点「输入区」按钮
   **预期结果**：主编辑区新建一个 WebviewPanel 标签页，URL 为 `?focus=conversation.composer`，只显示输入区。
3. **内容区复用**：再次点「输入区」按钮
   **预期结果**：聚焦到已打开的输入区 panel，不新建重复标签页。
4. **打开方式：系统浏览器**：点「系统浏览器」按钮
   **预期结果**：系统默认浏览器打开 `http://host:port`，面板上「系统浏览器」按钮高亮。
5. **打开方式记忆**：重载 VS Code 窗口
   **预期结果**：面板上「系统浏览器」仍高亮（globalState 跨会话记住）。
6. **打开方式：Simple Browser**：点「Simple Browser」按钮
   **预期结果**：VS Code 内置 Simple Browser 新标签页打开，高亮切换为该按钮。
7. **默认值回退**：清空 globalState（首次使用）后打开面板
   **预期结果**：高亮 = settings.openWith 的值（默认 tab）。
8. **聚焦模式已移除**：查看 settings 的 `opendsh.openWith` 枚举
   **预期结果**：只剩 tab / simpleBrowser / systemBrowser，无 focus；旧配置 focus 时按 tab 打开。

### 异常场景

- **服务未启动时点任意按钮**：先启动服务再打开（走现有 open 编排），失败弹错不打开。
- **端口被其他程序占用**：弹错「port in use」，不打开。
- **面板 WebviewView 未就绪时连点按钮**：忽略该次点击或排队处理（design 阶段定）。

## 边界收束

**此时必做**：
- 活动栏图标按钮 + 面板承载（WebviewView 本地 HTML）。
- 6 个按钮（3 内容区 + 3 打开方式）+ 点击即执行。
- globalState 记录当前打开方式，settings.openWith 作默认值。
- 删 `openWith=focus` 入口 + focus 上下分栏三 panel 编排，保留 `?focus=` 单区契约。

**此时不做**：
- 面板加「停止 DSH」按钮 —— 用户明确不需要，stop 仍走现有状态栏按钮/命令。
- 聚焦模式整体恢复 —— 已彻底取消。
- 面板按钮的图标定制 / 动画 / 多语言 —— 纯视觉，design 阶段按需。
- `?focus=` 契约本身的调整 —— 沿用现有三值，不变。

## 实现对齐

- **活动栏面板承载**：`contributes.viewsContainers`（activitybar 位置）+ `registerWebviewViewProvider`，WebviewView 渲染本地 HTML 按钮列表；按钮→扩展动作经 postMessage。
- **内容区单区打开**：面板按钮 → 扩展复用 `?focus=` 三值 URL（detect.buildFocusUrls）+ 单 panel 创建（focus.js 改造：删编排留单区）。
- **打开方式切换**：面板按钮 → 读/写 globalState → manager.openWebview 按 tab/simpleBrowser/systemBrowser 分支打开完整 UI。
- **推导出的约束**：WebviewView 加载外部 http 会被 VS Code 透明化（已踩坑），但面板自身只渲染本地 HTML 按钮、不加载 http，故 WebviewView 可用；`opendsh.open` 现有入口（标题栏/状态栏/autoStart）改为读 globalState 而非 settings.openWith。
- **design 决策**：focus.js 是就地改造还是拆新模块；单区 panel 复用 key；globalState key 命名与「globalState 优先、settings 作默认」的合并逻辑；面板 HTML 单文件 vs 内联、按钮布局分组、容器 id/图标命名。
