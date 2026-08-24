# 后续想法备忘：launch-modes

> 设计阶段识别但**此时不做**的事项，以及未来可能的演进方向。只记录想法，不做任何设计预留——需要时直接实现。

### 想法列表

- **L01**：上游 DSH 修复合入后补丁自动降级 / 无操作检测
  - 现状：补丁是针对 `@deepseek-ai/dsh` 上游缺陷的最小修复，上游合入后补丁变为 no-op，但当前没有"检测上游是否已修"的能力。
  - 何时做：上游 `dsh-subprocess-local` 的 spawn 补上 `windowsHide` 后。
  - 备注：届时 `src/patch.js` 的定位/检测逻辑可持续存在（`isApplied` 仍返回 true），或显式降级为 no-op 提示。

- **L02**：内置补丁逻辑与脱机脚本的收敛 / 合并
  - 现状：`src/patch.js`（内置：补丁命令生成 + 状态检测）与 `scripts/patch-dsh-windows-hide.mjs`（离线手动打补丁）逻辑近似但独立；用户拍板"脚本留着先不管"，暂不 DRY。
  - 何时做：当补丁定位/替换逻辑需要演进（适配 DSH 新版本结构），或希望单一逻辑源时。
  - 备注：届时可让 scripts 脚本委托 `src/patch.js`（`.mjs` 经 `createRequire` 引入），或删除 scripts 只留内置。

- **L03**：terminal 模式跨会话 pid 追踪
  - 现状：terminal 模式不写 pid 文件、stop 仅靠 `terminal.dispose()`，无跨会话残留清理能力。
  - 何时做：terminal 模式成为常用入口且出现"关终端后端口未释放"的实际问题时。
  - 备注：届时可让 createTerminal 前先写端口号标记，stop 时经 httpProbe 校验后 killPid 兜底；当前不预先预留。

- **L04**：macOS / Linux 五模式完整复刻
  - 现状：`window`/`window-keepalive` 的桌面窗口与 WMI 仅 win32；POSIX 沿用 detached spawn，载体（integrated/window/hidden）无视觉区分，keepalive 靠父退子活。
  - 何时做：有 macOS/Linux 用户需要独立存活后台 / 桌面窗口区分时。
  - 备注：POSIX detached spawn 已具备"父退子活"，补丁 no-op；主要是体验对齐与文档，不涉及新模块。

### 与当前设计的关系（轻量提示）

- L02 触达 `src/patch.js` 与 `scripts/` 的重复逻辑，届时按需合并即可，当前不预留共享抽象。
- L03 会影响 manager 的 stop/dispose 分支（terminal 模式），当前保持"关终端停服务"的简单语义，未来加 pid 追踪时在该分支内扩展，不改动模块边界。
- L01 触达 `src/patch.js` 的检测逻辑，届时在状态返回里加一个 no-op 提示即可，不需要改依赖链。