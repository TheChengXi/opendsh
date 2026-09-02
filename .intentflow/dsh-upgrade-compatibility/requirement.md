# 需求文档：DSH 升级兼容性修复（第二迭代）

## 项目意图
让 opendsh 的 `opendsh.open` / `opendsh.stop` 命令对 dsh 本体升级**鲁棒**——升级后手动 Stop/Open 直接可用，不再需要修改扩展源码并重新编译重装。

> 承接第一迭代（见本目录 `report.md`）：上轮用「补 `--no-open` + 挪 `--patch` 位置」打补丁式修了两个契约断点，未消除根因。本迭代目标是把根因（对 dsh CLI/路径契约的硬编码耦合）解掉。

## 功能清单
1. **启动契约鲁棒**：open 启动 dsh 不再依赖写死的 CLI 参数顺序/名称。
2. **升级后命令直接可用**：dsh 升级后手动 open/stop 直接生效，无需重编译重装。
3. **诊断可见**：open/stop 每次调用留痕，失效时可定位到具体断点。
4. **stop 残留清理**：stop 后端口/进程/pid 状态干净，紧接 open 能起新服务。

## 核心功能

### 核心功能1：启动契约鲁棒
- **能力**：系统能够 启动 dsh web 服务而不依赖硬编码的 CLI 参数顺序与名称，在 dsh CLI 契约演进后仍能正确启动。
- **业务价值**：dsh 每次升级不再使 `opendsh.open` 失效。

### 核心功能2：升级后命令直接可用
- **能力**：系统能够 在 dsh 升级后，仅通过手动 `Stop DSH` → `Open DSH` 完成旧服务停止与新服务启动，无需修改扩展源码或重新编译重装。
- **业务价值**：消除每轮升级的维护负担。

### 核心功能3：诊断可见
- **能力**：系统能够 在 open/stop 无法产生预期效果时，通过输出日志定位到具体断点（配置读取 / 契约解析 / 路径解析 / 端口判定 / spawn / 等待端口）。
- **业务价值**：从「完全没反应、只能重编译再试」变成「一眼看到卡在哪」。

## 业务规则

### 升级后手动重启规则
- **场景**：dsh 本体（`@deepseek-ai/dsh` 全局安装）升级后，手动执行 `Stop DSH` 再 `Open DSH`。
- **行为**：Stop 停止旧服务并释放端口与状态；Open 解析新 dsh 并启动新服务、打开 UI。全程无需重编译/重装扩展。
- **异常处理**：任一环节失败，必须在日志与可见提示中给出具体原因，而不是静默无反应。

### open 与 autoStart 同源规则
- **场景**：手动执行 `opendsh.open` 与 `activate` 阶段的 autoStart。
- **行为**：两者必须走同一启动函数与同一套契约解析路径，禁止分叉。
- **异常处理**：无（当前已同源，本规则为约束确认）。

### 状态一致性规则
- **场景**：Stop 后立即 Open（含集成终端模式下 stop 仅 dispose 终端、不等待进程退出的竞态）。
- **行为**：Open 不得把「尚未退出完的旧 dsh」误判为「外部 dsh 仍在运行」而直接打开旧服务，或误判为「端口被其他程序占用」而报错。
- **异常处理**：进入新启动前，对端口归属给出确定性判定。

## 预设测试

### 前置条件
- Windows；已全局安装 `@deepseek-ai/dsh`（任一版本）；opendsh 扩展已加载；Output 面板存在「DSH」频道。

### 测试步骤

1. **升级后手动打开**：[升级 dsh] → [命令面板执行 `DSH: Open DSH`] **预期结果**：新 dsh 服务启动、DSH 标签页打开，无需重编译重装。
2. **手动停止**：[执行 `DSH: Stop DSH`] **预期结果**：服务停止、端口释放（集成终端关闭）。
3. **停止后立即打开**：[执行 `Stop DSH` 后立即执行 `Open DSH`] **预期结果**：新 dsh 服务启动，不误开旧服务、不报端口占用。
4. **无反应定位**：[手动 Open 无反应时] → [查看 Output「DSH」频道] **预期结果**：能看到 `readSettings` / `spawning` / `ready`（或明确失败原因）日志，可定位断点。

### 异常场景

- **dsh 未安装 / 路径失效** → 明确报错并提示安装或配置 `opendsh.dshPath`，而非静默。
- **端口被非 dsh 程序占用** → 明确报错。
- **dsh 启动失败（CLI 报错 / profile 初始化失败）** → 弹出带 stderr 摘要的错误，而非静默等待 15 秒。

## 边界收束

**此时必做**：
- 消除 `buildDshArgs` 对 dsh CLI 参数顺序/名称的硬耦合（核心）。
- 补足诊断日志，令「无反应」可定位。
- 修 stop → open 的端口归属判定竞态。

**此时不做**：
- 修改 dsh 源码（仅 opendsh 侧适配）。
- 新增打开方式 / 启动模式枚举。

## 实现对齐

### 已确认脆弱点（✅ 明确）
- `src/process.js:buildDshArgs` 硬拼 `web --patch … --host … --port … --no-open`，参数顺序/名随 dsh CLI 契约走（git `c0ae911` 证明 `--patch` 位置曾变）。
- `src/detect.js:resolveNpmGlobal` 硬编码 `node_modules/@deepseek-ai/dsh/lib/bin.js`，兜底 `findOnPath('dsh')`。
- `src/detect.js:resolveDsh` 被 manager 调用时未传 deps，导致 `runNpmPrefix` 恒拿不到 `execFile`、npm prefix 探测实际失效（只剩 APPDATA 快速路径 + PATH 兜底）。
- open 与 autoStart 同源（`extension.js` 注册 `opendsh.open == manager.open`，autoStart 也调 `manager.open`）——本次不动同源性，只修契约脆弱。

### 待运行时验证（⏸ 延后）
- 本次「手动 open/stop 完全没反应」的精确运行时机制（命令未分发？spawn 失败被吞？服务起来了但 UI 没开？）。触发条件：execute 阶段在真实 VS Code 复现，抓 Output「DSH」频道日志。已实测当前 dsh 下启动命令参数层可进入 `runProfile`（EPERM 为本会话沙箱限制，非用户环境）。

### design 决策（🎯 记录问题，交由 design 阶段选择）
- `buildDshArgs` 如何对 dsh CLI 演进鲁棒：
  - A. 契约探测：spawn 前跑 `dsh web --help` / `--dump-config` 探测支持的 flag 再拼。
  - B. 版本感知：读 dsh 版本按分支拼参。
  - C. 最小稳定集：只依赖最稳定参数（`web`、`--port`、`--no-open`），把 `--patch`/`--host` 改为探测式/可选。
  - D. 其他。