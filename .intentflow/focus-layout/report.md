# focus-layout 关账报告

## 1. 项目概览
opendsh 聚焦模式（openWith=focus）的三区隔离布局：把 DSH 的会话选择区、消息对话区、输入区从完整界面中拆出，分别承载到 VS Code 中，主视野留给代码；利用 @dsh-focus/focus-plugin 的三值聚焦 URL（`?focus=sidebar` / `?focus=conversation.session` / `?focus=conversation.composer`）实现界面隔离。

## 2. 计划 vs 实际
- ✅ **URL 契约升级**：`buildFocusUrls` 输出三值 `{sessions, conversation, composer}`，对齐插件强化后的契约
- 🔸 **承载面声明**：原计划 WebviewView 三容器（活动栏 / 辅助侧边栏 / 底部面板），实际**改为三个 WebviewPanel**（主编辑区）——WebviewView 内 iframe 加载外部 http 会被 VS Code 透明化（见决策 1）
- ✅ **承载面编排**：focus.js 由双承载面升级为三承载面（VIEW_SPECS 表驱动），最终 WebviewPanel 承载
- ✅ **三区会话互通**：三 panel 同源共享会话（DSH 原生，无需桥接）
- ➕ **webviewHost 分离**（新增）：host 用于服务管理、webviewHost 仅用于 webview 访问 URL
- ➕ **上下分栏布局**（新增）：`setEditorLayout` 上方 70%（会话列表+消息流）+ 下方 30%（输入区横贯底部）

## 3. 关键决策
- **决策 1：WebviewView → WebviewPanel（核心，难逆转）**：需求原定「对话隔离到侧边栏/辅助侧边栏/底部面板」（WebviewView 承载），但实测 WebviewView 内 iframe 加载 `http://127.0.0.1:3081` 永久透明（html 注入正常、iframe 空白），WebviewPanel（tab）正常。逐一排除 CSP 写法、sandbox、localhost service-worker 拦截、混合内容、缓存后，确认为 VS Code 1.133 的 WebviewView 环境限制（[issue #277136](https://github.com/microsoft/vscode/issues/277136) 同类「WebviewView 空白、WebviewPanel 存活」）。放弃侧边栏承载，改 WebviewPanel + 上下分栏，用「下方编辑器组横贯底部」模拟底部面板观感。
- **决策 2：删除健康探测**：webview 壳的 no-cors fetch 探测被证明是过度设计——服务就绪已由 manager 的 `waitForPort` 保证，dsh 页面自身有 loading。探测一路引出内联脚本被 base CSP 禁、外部脚本、query 匹配等连锁问题。最终壳极简为「iframe 直连 + cache-buster」。
- **决策 3：host/webviewHost 分离**：排查中发现 `opendsh.host` 同时耦合「服务绑定地址」和「webview 访问地址」，改别名会连累服务管理。拆成两个设置，webviewHost 默认同 host。
- **决策 4：上下分栏布局**：输入区无法进真正的底部面板区（WebviewPanel 只能编辑器区、WebviewView 面板区 iframe 白屏），改用 `setEditorLayout` 上下分栏（70/30），输入区占下方组横贯底部。

## 4. 经验记录
- **有效做法**：
  - VIEW_SPECS 描述表驱动承载面（新增承载面 = 表加一行），在 WebviewView→WebviewPanel 切换时只改表结构和 create 逻辑，未伤及编排骨架
  - 用 Edge headless 做本地 CSP 交集实验，先验证「内联脚本被 base CSP 禁」再动手，避免盲改
  - 直接抓 VS Code 源码（pre/index.html、service-worker.js）定位机制，比文档/搜索更可靠
- **踩坑**：
  - VS Code 声明 schema 细节：辅助侧边栏属性名是 `secondarySidebar` 而非 `auxiliarybar`；`viewsContainers` 容器 id 不允许点号；`contributes.views` 的 icon 是必填；WebviewView 需 `type: "webview"`（缺省 tree 导致 resolve 不调用）
  - 内联脚本被 VS Code base CSP（nonce 机制）与 meta CSP 交集禁掉——webview 里脚本必须走外部文件
  - **诊断代码陷阱**：0.0.18 诊断用 `z-index:9999` 的 div 永远盖住 iframe，得出「iframe 没加载」的错误结论；改用 body 背景色（在 iframe 下方）才拿到真实结果
  - 反复「打包→安装→重载→测」循环极慢，应优先用本地可复现实验（Edge headless）验证假设
- **工具反馈**：
  - web_search 对 VS Code 源码级、行为级问题帮助有限，关键结论多来自直接抓 raw 源码 + GitHub issue API
  - 缺一个「webview 内 iframe 加载状态」的可靠观测手段（devtools frame 选择易错、诊断 div 易误判）

## 5. 后续待办
- **立即跟进**：
  - 用户验证 0.0.21 上下分栏布局效果（输入区是否在下方 30% 横贯）
  - 三 panel 端到端验证：会话列表切会话 → 消息流同步 → 输入区发消息（聚焦模式闭环）
  - 确认 `engines.vscode` 是否可回退（secondarySidebar 声明已删，`^1.106.0` 可能可降到更低）
- **长期备忘**：见 `.intentflow/focus-layout/later-on.md`（注意：L01 输入区标签页备选、L02 容器展开策略、L04 secondarySidebar 降级已因方向改为 WebviewPanel 而过时，仅 L05 list occupant 聚焦联动、L06 会话联动仍有效）

## 6. 开发工作流反馈
- **结构性问题**：本次 80% 的轮次花在「WebviewView 承载外部 http」这个**平台能力边界**上，而 design 阶段未识别该风险。建议：design 阶段对「承载面 + 外部资源」类需求，先做最小可运行 spike（一个最小 WebviewView 加载 localhost iframe）验证平台能力，再展开完整设计。
- **requirement 阶段的盲点**：「三区放 VS Code 侧边栏/辅助侧边栏/底部面板」是业务意图，但实现路径依赖 WebviewView 平台能力，requirement 未把「WebviewView 能否加载外部 http」纳入可行性锚定，导致 execute 阶段才暴露。
- **execute 阶段的诊断工具缺失**：VS Code webview 的运行态（iframe 加载、CSP 命中）无便捷观测手段，全靠「打包→装→看」，建议沉淀一个「诊断版 webview 壳」（body 背景色 + iframe 状态）作为调试脚手架。

## 7. 结论
- **当前状态**：需补测（布局与端到端未验证；用户刚打包 0.0.21）
- **建议下一步**：用户装 0.0.21 验证布局 + 端到端收发消息；确认后本次 feature 可收口，遗留的 WebviewView 限制留作独立议题（若 VS Code 修复后想回归侧边栏承载）
