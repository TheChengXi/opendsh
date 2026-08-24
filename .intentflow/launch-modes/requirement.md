# 需求文档：启动模式单枚举重构（launch-modes 修订）

## 项目意图

把 DSH 的启动方式收敛为**单个枚举 `opendsh.launch.mode`**：枚举 5 个明确的启动模式——「输出载体（内置终端 / 桌面窗口 / 静默）× 存活（随关闭 / 独立）」的有效组合；并把「改源码补丁抑制闪窗」这一高风险实验能力剥离为**独立开关**，仅在需要时启用。

## 功能清单

1. **单枚举启动模式**：`opendsh.launch.mode` 五值 —— `integrated`（内置终端+随关，默认）/ `window`（桌面窗口+随关）/ `hidden`（静默+随关）/ `window-keepalive`（桌面窗口+独立）/ `hidden-keepalive`（静默+独立）。
2. **内置补丁模块**：把 `scripts/patch-dsh-windows-hide.mjs` 的核心逻辑内嵌进扩展，幂等、检测已打则跳过（只改一次源码）。（保持不变）
3. **补丁自动执行**：仅 `hidden-keepalive` 模式且开启 `opendsh.experimental.windowsHidePatch` 时，在 VS Code 集成终端自动执行内置补丁命令。
4. **桌面窗口载体恢复**：恢复「桌面可见控制台窗口」这一载体，并可与「随关/独立」自由组合。
5. **存活与载体解耦**：存活（是否随 VS Code 关闭）不再绑死某个载体，由模式名统一表达。
6. **文档同步**：README、设置说明（package.json description）、`.intentflow/_packages/opendsh.yml` 同步更新，标注实验性与风险。

## 核心功能

### 核心功能1：五模式启动编排
- **能力**：用户通过一个下拉 `opendsh.launch.mode` 选择启动模式，系统按表分发到唯一实现路径，无优先级叠加、无互斥歧义。
- **业务价值**：一眼看清"我现在有哪些启动姿势"，消除原来 `showWindow`/`detached`/`experimental.silentKeepAlive` 三设置纠缠与命名误导。

### 核心功能2：桌面窗口载体
- **能力**：`window`（随关）与 `window-keepalive`（独立）都弹**桌面可见的控制台窗口**承载 DSH 输出；区别仅在 VS Code 关闭后是否继续运行。
- **业务价值**：把旧布尔 `showWindow=true`（弹窗）能力正名并补回，且让"弹窗"与"存活"不再绑定。

### 核心功能3：内置补丁自动执行（幂等一次）
- **能力**：`hidden-keepalive` 且 `experimental.windowsHidePatch = true` 时，扩展在 VS Code 集成终端自动执行内置补丁脚本，为 `dsh-subprocess-local` 的 `spawn()` 补 `windowsHide: platform === "win32"`；脚本幂等，已打过直接跳过。
- **业务价值**：把高风险外部手动补丁变成"开即自动、只打一次"，消除手动跑脚本负担；且只在真正需要（静默独立长跑）时才动源码。

## 业务规则

### 五模式唯一映射
- **行为**：`opendsh.launch.mode` 的每个值对应唯一实现路径，互不叠加：

  | mode | 载体 | 是否随 VS Code 关 | 实现 |
  |---|---|---|---|
  | `integrated`（默认）| VS Code 集成终端 | 随关 | `createTerminal` 跑 `dsh web` |
  | `window` | 桌面控制台窗口 | 随关 | `spawn`（stdio inherit + detached false）|
  | `hidden` | 静默（Output 面板日志）| 随关 | `spawn`（stdio pipe + detached + windowsHide）|
  | `window-keepalive` | 桌面控制台窗口 | 独立 | WMI（ShowWindow=1）|
  | `hidden-keepalive` | 静默（Output 面板日志）| 独立 | WMI（ShowWindow=0）+ 可选补丁 |

- **异常处理**：非法/缺失枚举值回退默认 `integrated`，不抛异常。

### 补丁触发条件
- **场景**：mode = `hidden-keepalive` 且 `experimental.windowsHidePatch = true` 时触发 `open`。
- **行为**：先在集成终端执行内置补丁（幂等，已打跳过）→ 再 WMI 静默启动 DSH。其它模式完全不触补丁。
- **异常处理**：补丁定位失败（DSH 源码结构变更）报错，不静默写错。

### 切换后需重启才生效
- **场景**：服务运行时改动 mode / 补丁开关。
- **行为**：启动模式在启动那一刻固定；改动只影响下一次 `open`，需先 `Stop DSH`（或关窗/关端）再 `Open`。
- **异常处理**：沿用现有说明，README/设置描述写明。

### 旧设置作废
- **行为**：`opendsh.showWindow` / `opendsh.detached` / `opendsh.experimental.silentKeepAlive` 三个旧键**作废**，不迁移、不兼容映射；VS Code 以「未知配置」黄线提示，用户自行改为 `opendsh.launch.mode`。
- **业务价值**：遵循"禁止以防万一式兜底"，避免"改了没生效"的迁移假象。

## 预设测试

> 从用户视角可执行的验证步骤。前置：Windows 10/11 + Node + 全局 `@deepseek-ai/dsh`；VS Code 加载 opendsh 扩展并打开工作区。

1. **【默认 integrated】**：`opendsh.launch.mode` 未设置（默认）→ 点「Open DSH」。**预期**：VS Code 集成终端出现 DSH 输出、可交互；无桌面独立窗口；随 VS Code 关闭而停。
2. **【window】**：设 `window` → 点「Open DSH」。**预期**：弹出桌面独立命令行窗口；关 VS Code 后窗口与服务一起停。
3. **【hidden】**：设 `hidden` → 点「Open DSH」。**预期**：静默启动，无桌面窗口、无集成终端；日志在 Output 面板「DSH」通道；随 VS Code 关闭而停。
4. **【window-keepalive】**：设 `window-keepalive` → 点「Open DSH」。**预期**：弹出桌面窗口；关 VS Code 后窗口与服务仍在；关窗或 Stop 才停。
5. **【hidden-keepalive + 补丁】**：设 `hidden-keepalive` 且 `experimental.windowsHidePatch = true` → 首次点「Open DSH」。**预期**：集成终端自动跑一条补丁命令（patched）；DSH 静默启动、日志进 Output；关 VS Code 后仍活；与 agent 对话触发 shell/subprocess 工具时任务栏不再闪 node 窗口。
6. **【补丁幂等】**：反复 Stop→Open 或重载窗口。**预期**：补丁检测"已打"而跳过，不反复改写源码。
7. **【hidden-keepalive 不打补丁】**：设 `hidden-keepalive` 但 `experimental.windowsHidePatch = false` → 点「Open DSH」。**预期**：不发补丁命令，直接 WMI 静默后台。

### 异常场景
- **【补丁定位失败】**：DSH 升级源码结构变化 → 报错提示补丁失效，不静默启动。
- **【非 win32】**：POSIX 上 5 模式降级（载体无视觉区分、keepalive 走 detached spawn），补丁 no-op，不报错。

## 边界收束

**此时必做**：
- `opendsh.launch.mode` 5 值枚举全链路打通（package.json contributes + detect.resolveConfig + manager.readSettings/ensureReady）。
- 恢复桌面窗口载体 `window`（新增 `process.spawnDshVisible`）。
- 补丁剥离为 `opendsh.experimental.windowsHidePatch`，仅 `hidden-keepalive` 生效。
- 删除三个旧设置键（不迁移）。
- 默认值 `integrated`。
- README、package.json description、`.intentflow/_packages/opendsh.yml` 同步更新，标注实验性/风险。

**此时不做**：
- macOS/Linux 的 5 模式完整复刻 —— 延后（当前面向 Windows，POSIX 沿用 detached spawn 降级）。
- 上游 DSH 修复合入后的补丁移除/自动降级 —— 延后。
- 集成终端的 UX 细节（终端复用/关闭停服务/多工作区隔离）—— maintenance 事后再定。

## 实现对齐

锚定的现状基线：`.intentflow/_packages/opendsh.yml`。

- **单枚举 5 模式**：实现路径 = package.json `opendsh.launch.mode`（enum + markdownEnumDescriptions，默认 `integrated`）→ `detect.resolveConfig` 校验回退 `integrated` → `manager.readSettings` 透传 → `manager.ensureReady` 按 5 值 switch 分发到 `createTerminal` / `spawnDshVisible` / `spawnDsh` / `spawnStandalone(showWindow 1/0)`。
- **桌面窗口载体**：实现路径 = `process.spawnDshVisible`（stdio inherit + detached false）供 `window` 模式；`window-keepalive` 走 `spawnStandalone(showWindow:1)`。
- **补丁独立开关**：实现路径 = package.json `opendsh.experimental.windowsHidePatch`（boolean 默认 false）→ `detect.resolveConfig` 读取 → manager 在 `hidden-keepalive` 分支判断开关，再走 `patch.isApplied`/`buildPatchCommand`（集成终端执行、幂等）。
- **旧设置作废**：实现路径 = package.json 删 3 旧键；detect.resolveConfig 不再读旧字段。

- **design 决策**（交由 design 定，不入需求）：
  - 枚举命名（integrated/window/hidden + `-keepalive` 后缀）与默认值。
  - 旧 key 是否迁移（结论：不迁移）。
  - 补丁开关命名与作用域（`opendsh.experimental.windowsHidePatch`，仅 hidden-keepalive 生效）。
  - 桌面窗口载体实现形态（`spawnDshVisible` 新函数 vs 参数化 spawnDsh）。