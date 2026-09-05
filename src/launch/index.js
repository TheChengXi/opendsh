/**
 * @intent
 * 四模式启动分发器：把四启动模式（integrated/window/window-keepalive/hidden-keepalive）聚为一族，
 * 向 manager 暴露统一入口 start(mode, ctx)。本模块只做「按 launchMode 找到对应启动器并调用」，不承载任何单一模式逻辑。
 * （hidden 静默非 keepalive 模式已下线——其登录方式应用效果与 hidden-keepalive 同类，非合格可用模式。）
 *
 * 边界：start 对未知 mode 抛错（manager 依赖 detect 的枚举校验保证合法）；依赖（vscode/process/patch）由 createLauncher(deps) 注入各启动器。
 *
 * 验收条件：
 * - createLauncher(deps) 构造四模式启动器并注册到 mode→launcher 映射
 * - start('integrated') → 调用 integrated 启动器；其余模式同理；未知 mode 抛 Error('unknown launch mode: …')
 */
'use strict';

const integrated = require('./integrated');
const windowLauncher = require('./window');
const windowKeepalive = require('./window-keepalive');
const hiddenKeepalive = require('./hidden-keepalive');

function createLauncher(deps) {
  const launchers = {
    integrated: integrated.createIntegratedLauncher(deps),
    window: windowLauncher.createWindowLauncher(deps),
    'window-keepalive': windowKeepalive.createWindowKeepaliveLauncher(deps),
    'hidden-keepalive': hiddenKeepalive.createHiddenKeepaliveLauncher(deps),
  };

  return {
    start(mode, ctx) {
      const l = launchers[mode];
      if (!l) throw new Error('unknown launch mode: ' + mode);
      return l.start(ctx);
    },
  };
}

module.exports = { createLauncher };