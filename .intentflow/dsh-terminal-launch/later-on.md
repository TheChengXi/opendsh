# 后续想法备忘（dsh-terminal-launch）

> 设计阶段识别但**此时不做**的事项，以及未来可能的演进方向。只记录想法，不做任何设计预留——需要时直接实现。

## 想法列表

- **L01：child 路径启动超时后的引用复位** ✅ 已在本次落地
  - 现状：`resetChild`（kill 僵尸 child + 清引用 + 删 pid），主启动与复用两处 `waitForPort` 超时均调用；正是本次真实根因（hidden 模式毒 child 死锁）。
  - 何时做：已完成。
  - 备注：child 的 `exit` 事件清引用仍可补充（当前 `child.killed` 只是 spawn 侧标志，进程异常退出未必置位）。

- **L02：命令文本形态对齐手动输入** ✅ 已落地（node + bin.js 部分）
  - 现状：`resolveDsh` 改为 Windows 优先 npm 全局真实入口（`node + bin.js`）并**删除** PATH `.cmd` shim 兜底（防 cmd.exe 弹黑框）；`--host 127.0.0.1` 仍因是默认值被省略（等价）。
  - 何时做：仅剩「恒输出 `--host 127.0.0.1`」未做，需要终端文本与手动输入完全一致（含 --host）时。
  - 备注：涉及 `process.buildDshArgs`（是否恒输出 `--host`）。

- **L03：集成终端 cwd 显式设置**
  - 现状：`createTerminal('DSH')` 未指定 `cwd`，命令在终端默认目录执行；本次 bug 与其无关。
  - 何时做：确认 dsh 因工作目录错误而读不到相对资源时。
  - 备注：`createTerminal` 支持 `creationOptions.cwd`，实现简单。

- **L04：更细粒度的 shell 就绪判定**
  - 现状：用 `onDidStartTerminalShell` + 3000ms 超时兜底已够覆盖本 bug。
  - 何时做：若遇到 shell 就绪但命令仍偶发丢失，再评估 shellIntegration 相关能力或 sendText 重试。
  - 备注：当前不引入重试，避免过度设计。

## 与当前设计的关系（轻量提示）

- L01 会落在 `ensureReady` 复用分支的相同 `waitForPort` 超时处，届时与 terminal 复位并排处理即可，无需提前预留接口。
- L02 会改 `detect.js` 与 `process.js`（命令拼装），与本次 `manager.js` 改动无耦合。
- L03 / L04 均为 `createTerminal` 调用点的小改造，直接在 integrated 分支内实现即可。