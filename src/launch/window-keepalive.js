/**
 * @intent
 * window-keepalive 启动模式（独立启动器）：桌面可见窗口 + 独立存活——WMI/Posix detached 弹窗脱离 VS Code 进程树，
 * 跨会话可 stop。本模块只做「本模式启动」——spawnStandalone(showWindow=true) 产出含 pid 的伪 child 并返回统一 child 描述；
 * 引用生命周期（pid 写入 / keepalive 保护 / resetChild）由 manager 消费后编排。
 *
 * 边界：产出的 child 为 { pid }（无真实子进程引用/stderr）；不写 pid（manager 消费后写）；只对应 launch.mode=window-keepalive。
 *
 * 验收条件：
 * - start 返回 { kind:'child', child:{ pid } }，spawned 来自 proc.spawnStandalone(…, showWindow:true)
 * - 依赖仅经构造注入（deps.process），内部零 require
 */
'use strict';

function createWindowKeepaliveLauncher(deps) {
  const proc = deps.process;

  return {
    async start(ctx) {
      const spawned = await proc.spawnStandalone(ctx.resolved, {
        host: ctx.config.host,
        port: ctx.config.port,
        patches: ctx.patches,
        cwd: ctx.workspace,
        showWindow: true,
      });
      return { kind: 'child', child: { pid: spawned.pid } };
    },
  };
}

module.exports = { createWindowKeepaliveLauncher };