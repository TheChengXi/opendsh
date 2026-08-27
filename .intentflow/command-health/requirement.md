# 需求文档：command-health

## 项目意图
修复 open/stop 命令机制的健康问题：核心是 `opendsh.launch.mode` 与 `opendsh.experimental.windowsHidePatch` 两个嵌套设置键在 `readSettings` 中用扁平键读取、恒为 undefined（五模式实际不生效）；同步清理 3 处文档残留（package.json openWith 残留活动栏面板描述、README 安装段 0.0.3 版本号、README simpleBrowser 历史叙述）。

## 功能清单
1. **嵌套设置键正确读取**：readSettings 用点式键读 `launch.mode` / `experimental.windowsHidePatch`，五模式与实验补丁开关真正生效
2. **测试与真实 VS Code 键语义对齐**：测试 harness 的配置读取模拟真实 `getConfiguration().get(key)` 点式解析，防此类 bug 再次漏网
3. **文档残留清理**：package.json openWith description、README 版本号与 openWith 历史叙述去旧化

## 核心功能

### 核心功能1：launch.mode 五模式设置真正生效
- **能力**：系统能够从 `opendsh.launch.mode`（嵌套键）读到用户选择的启动模式，并按其分发 integrated/window/hidden/window-keepalive/hidden-keepalive
- **业务价值**：用户设置的启动方式实际生效，而非静默回退 integrated

### 核心功能2：实验补丁开关真正生效
- **能力**：系统能够从 `opendsh.experimental.windowsHidePatch`（嵌套键）读到开关状态，仅在 hidden-keepalive 且开启时执行补丁
- **业务价值**：实验补丁可在真实环境中按用户配置触发

### 核心功能3：文档残留清理
- **能力**：package.json 与 README（中英两版）中的所有设置/命令描述与当前实现一致
- **业务价值**：用户不会被"活动栏面板"等已删除功能误导；安装指引版本号与发布版本一致

## 业务规则

### 嵌套键读取规则
- **场景**：readSettings 读取 opendsh 配置段
- **行为**：`launch.mode` 用 `cfg.get('launch.mode')` 读取；`experimental.windowsHidePatch` 用 `cfg.get('experimental.windowsHidePatch')` 读取；其余单段键（host/port/dshPath/patchFile/openWith/multipleTabs）保持 `cfg.get(key)` 不变
- **异常处理**：读取结果为非法枚举值/非 true 时仍按现有 resolveConfig 规则回退（integrated / false）

### 测试键语义规则
- **场景**：manager 单元测试构造 settings
- **行为**：测试 harness 的 cfgGet 需模拟 VS Code 点式键解析（`get('launch.mode')` 命中 `opendsh.launch.mode`），测试数据用真实键名（`launch.mode` / `experimental.windowsHidePatch`）
- **异常处理**：未知键返回 undefined（与 VS Code 一致）

### 文档同步规则
- **场景**：任何设置/功能描述出现在 package.json 或 README
- **行为**：描述只包含当前真实存在的机制（无面板、无状态记忆）；版本号与 package.json 一致（0.1.0）
- **异常处理**：无——文档不承载逻辑

## 预设测试

> 从用户视角可执行的测试步骤，验证功能是否符合预期。

### 前置条件
- 仓库克隆，`npm ci` 或已有 node_modules（本项目零第三方依赖，直接可测）
- 执行 `node --test --test-isolation=none`（沙箱环境要求，默认隔离模式 spawn 子进程会被拒）
- 全部现有测试先通过（当前 95 个全绿）

### 测试步骤

1. **[设置读取]**：打开设置面板，设置 `opendsh.launch.mode = "window-keepalive"`，点击打开
   **预期结果**：启动后桌面出现独立控制台窗口，VS Code 关闭后进程继续存活（五模式真实生效，而非回退 integrated）

2. **[实验开关读取]**：设置 `opendsh.experimental.windowsHidePatch = true` 且 `launch.mode = "hidden-keepalive"`，点击打开
   **预期结果**：集成终端出现补丁命令执行（或日志显示已打过/跳过），服务静默启动

3. **[单元测试]**：`node --test --test-isolation=none`
   **预期结果**：全部测试通过；新增用例验证 `settings: { 'launch.mode': 'window-keepalive' }` 走 spawnStandalone 分支、`{ 'experimental.windowsHidePatch': true }` 触发补丁分支

4. **[文档核对]**：grep `活动栏面板|0.0.3|单标签页改造前` 于 README.md / package.json
   **预期结果**：无匹配（残留清理干净）

### 异常场景

- **[非法枚举值]**：`launch.mode = "bogus"` → 回退 integrated（沿用现有 resolveConfig 规则）
- **[键不存在]**：测试读不存在的键 → 返回 undefined，不抛异常

## 边界收束

**此时必做**：
- readSettings 嵌套键修正（否则五模式功能名存实亡）
- 测试 harness 键语义对齐（否则修正无法被测试锁定，回归即复发）
- B/C/D 三处文档残留清理（同属命令机制健康）

**此时不做**：
- 命令 ID 改名（如 open→start、stop 补按键/深链入口）— 无用户诉求，且已有三入口 + 命令面板覆盖 open/stop
- URI 增加 stop 深链 — 无使用场景，stop 由命令面板/按钮触发即可
- 迁移兼容旧版本设置键（launchMode 扁平键）— 单用户工具，无历史配置包袱（此前已按此原则删旧键不迁移）
- README 其他非命令机制内容重写 — 超出本次健康检测范围

## 实现对齐

- **[嵌套键读取]**：[manager.js readSettings 将 `cfg.get('launchMode')` 改为 `cfg.get('launch.mode')`、`cfg.get('windowsHidePatch')` 改为 `cfg.get('experimental.windowsHidePatch')`，其余键不动]
- **[测试语义对齐]**：[test/manager.test.js makeHarness 的 cfgGet 改为按真实键名解析（支持点式 key 命中 settings 对象），既有扁平键用例改用真实键名，新增嵌套键用例]
- **[文档清理]**：[package.json openWith description 删除"活动栏面板在运行时切换并记住它"→"纯 settings 决定，无面板/无状态记忆"；README 安装段 `TheChengXi.opendsh-0.0.3` → `TheChengXi.opendsh-0.1.0`；README 中英两版 simpleBrowser 描述删除"单标签页改造前的默认方式"历史叙述]
- **推导出的约束**：
  - `getConfiguration('opendsh').get(key)` 中 key 是相对 section 的点式路径：嵌套键必须带点，扁平键保持单段（已确认 VS Code 语义，见 https://code.visualstudio.com/api/references/activation-events 与 contributes.commands 说明：contributes.commands 声明的命令无需显式 onCommand 激活事件）
  - 命令声明/注册/激活链路本身健康，不在本次改动范围（检测结论：opensh.open/opendsh.stop 声明、注册、隐式激活、三入口均闭合）
- **design 决策**：
  - 测试 harness 的点式键模拟方式：cfgGet 支持 `'a.b'` 直接命中 `settings['a.b']`（最简单，测试数据直接写真实键名） vs 级联对象（settings 嵌套对象再按段取值）→ 交 design 选择，倾向前者（改动最小、fail 面最小）

## 附带检测结论（留档，不实施）

命令机制其余环节经检测均为健康：
- 声明（contributes.commands / menus.editor/title）✓
- 激活（1.74+ 对已声明命令隐式激活，engines ^1.106.0）✓
- 注册（opendsh.open→manager.open / opendsh.stop→manager.stop）与声明 ID 一一对应 ✓
- 入口（标题栏按钮 / 状态栏按钮 / 深链 /open）全部指向 open；stop 走命令面板 ✓
- stop 三路径（terminal / child / pid 残留 + 端口&HTTP 验证防误杀）✓