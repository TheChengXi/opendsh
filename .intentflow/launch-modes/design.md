# 结构设计：启动模式单枚举重构（launch-modes 修订）

## 0. 与需求文档的偏差（设计阶段新发现）

- **偏差**：原「三设置 + 互斥优先级」（`showWindow` / `detached` / `experimental.silentKeepAlive`）把两个正交维度——**输出载体（内置终端/桌面窗口/静默）** 与 **存活（随关/独立）**——互相绑定，且命名误导：`showWindow` 名不副实（实际是载体）、`detached` 把「桌面窗口 + 存活」绑死、`experimental.silentKeepAlive` 把「静默 + 存活 + 补丁」三件事绑死。— **影响**：重构为单枚举 `opendsh.launch.mode`（把 5 个有效组合逐一枚举）+ 独立补丁开关 `opendsh.experimental.windowsHidePatch`。
- **偏差**：原 design 判「`spawnDsh` 的 showWindow=true 分支无调用方」并删除，导致「桌面窗口 + 随关」这个载体从语义表消失。— **影响**：恢复为独立 `window` 模式，新增 `process.spawnDshVisible`。
- **偏差**：默认输出载体原为 `output`（静默），用户拍板默认应为「内置终端」。— **影响**：`opendsh.launch.mode` 默认 `integrated`。
- **偏差**：原 design 的「showWindow 布尔→枚举兼容映射（true→terminal 等）」被用户否掉——违反 AGENTS.md「禁止以防万一式兜底」，且制造"改了没生效"假象。— **影响**：彻底删除兼容映射；本次重命名同理**不做旧 key 迁移**，旧 3 个设置直接作废。
- **偏差**：补丁原绑死在 `experimental.silentKeepAlive` 分支。— **影响**：剥离为独立 `opendsh.experimental.windowsHidePatch`，仅 `hidden-keepalive` 模式且为 `true` 时才打补丁。

## 1. 模块清单

- **[extension.js]**：上层 — 激活入口不变，`createManager({ ..., patch })` 注入补丁模块 — 依赖：[manager]
- **[src/manager.js]**：中间层 — `readSettings` 读 `launchMode`/`windowsHidePatch`；`ensureReady` 按 5 模式 switch 分发；`startedDetached` 重命名为 `startedKeepAlive`；补丁逻辑从实验分支剥到 `hidden-keepalive` — 依赖：[detect, process, webview, patch, vscode]
- **[src/process.js]**：下层 — 新增 `spawnDshVisible`（桌面窗口、随关）；`spawnDsh`（静默）/`buildTerminalCommand`/`spawnStandalone`（WMI，showWindow 1/0）保持 — 依赖：无
- **[src/detect.js]**：下层 — `resolveConfig` 重写：`launchMode` 枚举校验（5 值，非法回退 `integrated`）、`windowsHidePatch`（仅 `=== true`）；删除 `showWindow`/`detached`/`experimentalSilentKeepAlive` 字段 — 依赖：无
- **[src/patch.js]**：下层 — 无改动 — 依赖：无
- **[src/webview.js]**：下层 — 无改动 — 依赖：无
- **[package.json]**：声明层 — 删除 `opendsh.showWindow`/`opendsh.detached`/`opendsh.experimental.silentKeepAlive`；新增 `opendsh.launch.mode`（string enum + markdownEnumDescriptions）、`opendsh.experimental.windowsHidePatch` — 依赖：无

## 2. 最小依赖链

```
extension.js → manager.js → detect.resolveConfig（launchMode 枚举 / windowsHidePatch）
                               ├→ patch.isApplied / buildPatchCommand（仅 hidden-keepalive + 补丁开关）
                               ├→ process.spawnDshVisible / spawnDsh / buildTerminalCommand / spawnStandalone
                               ├→ webview.buildWebviewHtml（不改）
                               └→ vscode（系统边界：createTerminal / createOutputChannel / createWebviewPanel / openExternal）
```

**跨层依赖体检**：extension → manager → {detect, process, webview, patch} + vscode，全部上层→下层单向；patch 为纯 node 下层模块，与 detect/process/webview 同级并列，不依赖 vscode。**本次无跨层依赖，无新增修复项。**

## 3. 测试策略

- **验证方式**：
  - detect.js：纯函数 — `launchMode` 5 值解析、非法值回退 `integrated`、`windowsHidePatch` 非 true 回退 false；断言返回对象不再含 `showWindow`/`detached`/`experimentalSilentKeepAlive`
  - process.js：纯函数 — `spawnDshVisible` 断言 `stdio:'inherit'`、`detached:false`、`windowsHide` 缺省（false），`shell` 仅 .cmd 为 true
  - manager.js：编排 — 注入 fake patch / fake vscode（含 fake createTerminal）断言 5 模式分发、补丁「hidden-keepalive + windowsHidePatch=true 且未打才发送」、`startedKeepAlive` 语义（keepalive 模式 dispose 不杀）
  - patch.js：不变
- **依赖注入点**：manager 由 [构造器参数] 注入 { detect, process, webview, patch, vscode }（沿用现状）
- **验证命令**：`node --test --test-isolation=none` — 预期：全绿（沙箱禁子进程 pipe 捕获，故需 `--test-isolation=none` 在主进程内跑）
- **Mock 边界**：只 mock vscode、spawn/execFile 系统边界；patch/webview/detect 用真实模块

## 4. 决策记录

- **决策**：用单个 enum `opendsh.launch.mode` 枚举 5 个有效组合，替代「载体 × 存活」两个正交设置
  - **理由**："内置终端 + 独立存活"是逻辑矛盾项（终端随 VS Code 亡），正交排列会多出无效组合；单下拉 5 项 + 每项 enum 描述最直观，无脑选；用户拍板方案 A
  - **影响**：manager 按 mode 值 switch 分发，无优先级判断（原来实验版 > detached > 普通的优先级链消失）
- **决策**：5 模式取值 `integrated` / `window` / `hidden` / `window-keepalive` / `hidden-keepalive`，默认 `integrated`
  - **理由**：前 3 个字点名「载体」、`-keepalive` 后缀名「独立存活」；用户拍板"内置终端是默认"
  - **影响**：`detect.resolveConfig` 非法值一律回退 `integrated`（唯一默认，无其它兜底映射）
- **决策**：5 模式到实现的映射表（见下）——载体与存活在实现层用不同机制，不混淆
  - **理由**：Windows 上「独立存活」必须走 WMI 脱离 VS Code job（detached spawn 会被 VS Code 关进程树时杀掉）；「随关」走 spawn/createTerminal
  - **影响**：

  | mode | 载体 | 存活 | 实现 |
  |---|---|---|---|
  | `integrated` | 内置终端 | 随关 | `buildTerminalCommand` + `createTerminal` |
  | `window` | 桌面窗口 | 随关 | `spawnDshVisible`（stdio inherit + detached false）|
  | `hidden` | 静默 | 随关 | `spawnDsh`（pipe + detached + windowsHide）|
  | `window-keepalive` | 桌面窗口 | 独立 | `spawnStandalone({ showWindow: 1 })` |
  | `hidden-keepalive` | 静默 | 独立 | [补丁] + `spawnStandalone({ showWindow: 0 })` |

- **决策**：补丁剥离为独立 `opendsh.experimental.windowsHidePatch`（boolean，默认 false），仅 `hidden-keepalive` 模式且为 true 时生效
  - **理由**：补丁是"改 DSH 源码"的实验性动作，与"存活/载体"无关，不应绑死在某个模式里；只有静默独立存活（无窗口可看、agent 长跑）才需要抑制子进程闪窗
  - **影响**：manager 仅在该模式+开关开启时调 `patch.isApplied`/`buildPatchCommand`；其它模式完全不触 patch
- **决策**：不做旧 key 迁移（`showWindow`/`detached`/`experimental.silentKeepAlive` 直接作废）
  - **理由**：个人工具无老用户；重命名还写映射又是"以防万一式兜底"，且会重演"改了没生效"的困惑——旧 key 残留时 VS Code 会以「未知配置」黄线提醒，用户自行改
  - **影响**：package.json 直接删 3 旧项；detect.resolveConfig 不再读旧字段；README/settings 说明按新 key 写
- **决策**：新增 `spawnDshVisible` 恢复「桌面窗口 + 随关」载体，而不用参数化 `spawnDsh`
  - **理由**：窗口模式 stdio `inherit`（子进程绕开 stderr pipe，直接写新控制台窗口），与静默模式 stdio pipe（走 Output 面板）在 stderr 归属、attachStderr 有无上**行为可分叉**，拆成两个明确函数比一个带 flag 的更直白（每个函数只做一件事）
  - **影响**：process 导出 +1；manager `window` 分支调 `spawnDshVisible` 后不 attachStderr（child.stderr 为 null，现有 attachStderr 已安全跳过）

## 5. 改动点清单

改动（现有文件）：
1. `src/detect.js` — `resolveConfig` 删除 `showWindow`/`detached`/`experimentalSilentKeepAlive`；新增 `launchMode`（枚举 5 值，非法回退 `integrated`）+ `windowsHidePatch`（=== true）
2. `src/process.js` — 新增 `spawnDshVisible(resolved, opts, spawnFn)`（stdio inherit + detached false + 缺省 windowsHide）；模块导出 +1
3. `src/manager.js` — `readSettings` 读 `launchMode`/`windowsHidePatch`（删旧 3 key）；`ensureReady` 由三态优先级改为 5 模式 switch；`startedDetached` 重命名 `startedKeepAlive`（值 = mode 含 `-keepalive`）；补丁逻辑移入 `hidden-keepalive` 分支并加 `windowsHidePatch` 开关条件
4. `package.json` — 删 `opendsh.showWindow`/`opendsh.detached`/`opendsh.experimental.silentKeepAlive`；新增 `opendsh.launch.mode`（enum + markdownEnumDescriptions，默认 `integrated`）、`opendsh.experimental.windowsHidePatch`（boolean 默认 false）
5. `test/detect.test.js` — launchMode 5 值解析 + 非法回退 + windowsHidePatch 回退；删除旧字段断言
6. `test/process.test.js` — `spawnDshVisible` opts 断言
7. `test/manager.test.js` — 5 模式分发、补丁开关条件、`startedKeepAlive` dispose 语义
8. `README.md` — 设置说明按新 key 重写（report 阶段）
9. `.intentflow/_packages/opendsh.yml` — 模块现状与 summary 更新（report 阶段）

新增文件：无（`spawnDshVisible` 落在 `src/process.js` 内）

删除文件：无（`scripts/patch-dsh-windows-hide.mjs` 保留不动）