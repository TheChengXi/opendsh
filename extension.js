/**
 * @intent
 * VS Code 激活入口：注册 open/stop 命令与 URI 深链，读设置并交予 manager，自身无业务逻辑。
 *
 * 边界：open 优先 simpleBrowser.api.open、失败回退 openExternal；URI 仅处理 /open 路径；
 * deactivate 返回 manager.dispose()，VS Code 关闭/重载窗口时同步终止本窗口启动的 dsh 服务（随 VS Code 关闭）。
 *
 * 验收条件：
 * - 注册 opendsh.open / opendsh.stop 两条命令
 * - registerUriHandler 将 /open 映射到 manager.open
 * - deactivate 调用 manager.dispose()（无 manager 时安全返回）
 */

'use strict';

const vscode = require('vscode');
const { createManager } = require('./src/manager');
const detect = require('./src/detect');
const proc = require('./src/process');

let manager = null;

function activate(context) {
  manager = createManager({ detect, process: proc, vscode });

  context.subscriptions.push(vscode.commands.registerCommand('opendsh.open', manager.open));
  context.subscriptions.push(vscode.commands.registerCommand('opendsh.stop', manager.stop));

  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri(uri) {
        if (uri.path === '/open') {
          manager.open();
        }
      },
    })
  );
}

function deactivate() {
  if (!manager) return;
  return manager.dispose();
}

module.exports = { activate, deactivate };
