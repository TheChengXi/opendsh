/**
 * @intent
 * hidden-keepalive 启动模式（独立启动器）：静默后台 + 独立存活——先（可选）windowsHidePatch 补丁
 * （isApplied 检测未打则 createTerminal 发 buildPatchCommand），再 spawnStandalone(showWindow=false) 产出含 pid 的伪 child。
 * 本模块只做「本模式启动」；引用生命周期（pid 写入 / keepalive 保护 / resetChild）由 manager 消费后编排。
 *
 * 边界：补丁终端不持有引用（发完命令丢弃）；产出 child 为 { pid }（无 stderr）；只对应 launch.mode=hidden-keepalive。
 *
 * 验收条件：
 * - windowsHidePatch=false（或已打）时不发补丁命令，直接 spawnStandalone(showWindow:false)
 * - windowsHidePatch=true 且 isApplied=false 时先 createTerminal('DSH patch') 发 buildPatchCommand 再 spawnStandalone
 * - start 返回 { kind:'child', child:{ pid } }
 * - 依赖仅经构造注入（deps.process / deps.vscode / deps.patch），内部零 require
 */
'use strict';

function createHiddenKeepaliveLauncher(deps) {
  const proc = deps.process;
  const patch = deps.patch;
  const vscode = deps.vscode;

  return {
    async start(ctx) {
      if (ctx.config.windowsHidePatch) {
        if (patch && typeof patch.isApplied === 'function' && !patch.isApplied({})) {
          const cmd = patch && typeof patch.buildPatchCommand === 'function' ? patch.buildPatchCommand({}) : '';
          if (cmd) {
            const pt = vscode.window.createTerminal('DSH patch');
            pt.sendText(cmd);
            pt.show();
          }
        }
      }
      const spawned = await proc.spawnStandalone(ctx.resolved, {
        host: ctx.config.host,
        port: ctx.config.port,
        patches: ctx.patches,
        cwd: ctx.workspace,
        showWindow: false,
      });
      return { kind: 'child', child: { pid: spawned.pid } };
    },
  };
}

module.exports = { createHiddenKeepaliveLauncher };