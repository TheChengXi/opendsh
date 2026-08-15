/**
 * @intent
 * VS Code 激活入口：注册 open/stop 命令、URI 深链与状态栏快捷按钮（点击执行 opendsh.open），
 * 读设置并交予 manager，自身无业务逻辑。编辑器标题栏按钮（大写 D）由 package.json 的
 * contributes.menus.editor/title 声明（点击同样执行 opendsh.open），无需代码注册。
 *
 * 边界：URI 仅处理 /open 路径；状态栏按钮常驻显示（无标签页时也能快捷启动），
 * 标题栏按钮随标签栏显示（有标签页时可用）；
 * deactivate 返回 manager.dispose()，VS Code 关闭/重载窗口时同步终止本窗口启动的 dsh 服务（随 VS Code 关闭）。
 *
 * 验收条件：
 * - 注册 opendsh.open / opendsh.stop 两条命令
 * - 创建状态栏按钮（text「DSH」/ command=opendsh.open）并 show
 * - registerUriHandler 将 /open 映射到 manager.open
 * - deactivate 调用 manager.dispose()（无 manager 时安全返回）
 */

'use strict';

const vscode = require('vscode');
const { createManager } = require('./src/manager');
const detect = require('./src/detect');
const proc = require('./src/process');
const webview = require('./src/webview');

let manager = null;

function activate(context) {
  manager = createManager({ detect, process: proc, webview, vscode });

  context.subscriptions.push(vscode.commands.registerCommand('opendsh.open', manager.open));
  context.subscriptions.push(vscode.commands.registerCommand('opendsh.stop', manager.stop));

  // 状态栏快捷按钮：常驻可见，单击直接执行 opendsh.open（无标签页时也能启动）
  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusItem.text = 'DSH';
  statusItem.command = 'opendsh.open';
  statusItem.tooltip = 'Open DSH';
  context.subscriptions.push(statusItem);
  statusItem.show();

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
