/**
 * @intent
 * window 启动模式（独立启动器）：桌面可见控制台窗口承载 DSH，随 VS Code 关闭。
 * 本模块只做「本模式启动」——spawnDshVisible 产出真实子进程并返回统一 child 描述；
 * 子进程引用生命周期（attachStderr / pid 写入 / resetChild）由 manager 消费后编排。
 *
 * 边界：不写 pid（manager 消费后写）；不注册引用清理；只对应 launch.mode=window。
 *
 * 验收条件：
 * - start 返回 { kind:'child', child }，child 为 proc.spawnDshVisible 产物
 * - 依赖仅经构造注入（deps.process），内部零 require
 */
'use strict';

function createWindowLauncher(deps) {
  const proc = deps.process;

  return {
    start(ctx) {
      const child = proc.spawnDshVisible(ctx.resolved, {
        host: ctx.config.host,
        port: ctx.config.port,
        patches: ctx.patches,
        cwd: ctx.workspace,
      });
      return { kind: 'child', child };
    },
  };
}

module.exports = { createWindowLauncher };