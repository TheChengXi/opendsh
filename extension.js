/**
 * @intent
 * VS Code 激活入口：注册 open/stop 命令、URI 深链与侧边栏视图树（单节点「Open DSH」点击执行 opendsh.open），
 * 读设置并交予 manager，自身无业务逻辑。
 *
 * 边界：URI 仅处理 /open 路径；视图树只提供静态单节点，无状态、不读配置；
 * deactivate 返回 manager.dispose()，VS Code 关闭/重载窗口时同步终止本窗口启动的 dsh 服务（随 VS Code 关闭）。
 *
 * 验收条件：
 * - 注册 opendsh.open / opendsh.stop 两条命令
 * - registerUriHandler 将 /open 映射到 manager.open
 * - registerTreeDataProvider('opendsh.launch') 单节点「Open DSH」，TreeItem.command=opendsh.open
 * - deactivate 调用 manager.dispose()（无 manager 时安全返回）
 */

'use strict';

const vscode = require('vscode');
const { createManager } = require('./src/manager');
const detect = require('./src/detect');
const proc = require('./src/process');
const webview = require('./src/webview');

let manager = null;

// 侧边栏视图树：静态单节点「Open DSH」，点击执行 opendsh.open（等价命令面板 @command）
function createLaunchTreeProvider() {
  const item = () =>
    new vscode.TreeItem('Open DSH', {
      command: { command: 'opendsh.open', title: 'Open DSH' },
      tooltip: 'Open DeepSeek Harness Web UI',
    });
  return {
    getTreeItem: (el) => el,
    getChildren: (el) => (el ? [] : [item()]),
  };
}

function activate(context) {
  manager = createManager({ detect, process: proc, webview, vscode });

  context.subscriptions.push(vscode.commands.registerCommand('opendsh.open', manager.open));
  context.subscriptions.push(vscode.commands.registerCommand('opendsh.stop', manager.stop));

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('opendsh.launch', createLaunchTreeProvider())
  );

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
