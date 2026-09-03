/**
 * @intent
 * integrated 启动模式（独立启动器）：把 DSH 命令交给 VS Code 集成终端承载（无 pid，stop/dispose 关终端停服务）。
 * 本模块只做「本模式启动」——组装 buildTerminalCommand + createTerminal + show + sendText，返回统一 terminal 描述；
 * 引用生命周期（onDidClose 清引用）由 manager 消费后编排，本模块不持有。
 *
 * 边界：不写 pid 文件；不注册 onDidClose（manager 拿到 terminal 后负责）；只对应 launch.mode=integrated。
 *
 * 验收条件：
 * - start 返回 { kind:'terminal', terminal }，terminal 为 vscode.createTerminal('DSH') 产物且已 sendText/show
 * - 不触碰 child 引用、不写 pid
 * - 依赖仅经构造注入（deps.process / deps.vscode），内部零 require
 */
'use strict';

function createIntegratedLauncher(deps) {
  const proc = deps.process;
  const vscode = deps.vscode;

  return {
    start(ctx) {
      const cmd = proc.buildTerminalCommand(ctx.resolved, {
        host: ctx.config.host,
        port: ctx.config.port,
        patches: ctx.patches,
        cwd: ctx.workspace,
      });
      const terminal = vscode.window.createTerminal('DSH');
      terminal.show();
      terminal.sendText(cmd);
      return { kind: 'terminal', terminal };
    },
  };
}

module.exports = { createIntegratedLauncher };