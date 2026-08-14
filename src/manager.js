/**
 * @intent
 * 生命周期编排：open/stop。open 端口已监听则直接打开，未监听则自动启动并等待端口就绪后再打开——启动判定封装在代码层，用户无需显式 start；
 * 持有当前子进程引用，屏蔽 VS Code 交互细节。
 *
 * 边界：端口未监听且无工作区时报错返回不抛异常；spawn 失败报错返回；端口等待超时报错且不打开；
 * stop 无记录实例时仅提示不抛异常；打开优先 simpleBrowser.api.open、失败回退 openExternal。
 *
 * 验收条件：
 * - open 端口未监听时 spawn → 等待端口就绪 → open；已监听时跳过 spawn 直接 open
 * - 端口未监听且无工作区时报错且不 spawn
 * - 端口等待超时报错且不 open
 * - 端口已监听时 open 无需工作区也能直接打开
 * - stop 无 child 时提示且不抛异常
 */

'use strict';

function createManager(deps) {
  const detect = deps.detect;
  const proc = deps.process;
  const vscode = deps.vscode;

  let child = null;

  function readSettings() {
    const cfg = vscode.workspace.getConfiguration('opendsh');
    return {
      host: cfg.get('host'),
      port: cfg.get('port'),
      dshPath: cfg.get('dshPath'),
      patchFile: cfg.get('patchFile'),
    };
  }

  async function openBrowser(config) {
    const url = detect.buildUrl(config.host, config.port);
    const uri = vscode.Uri.parse(url);
    try {
      await vscode.commands.executeCommand('simpleBrowser.api.open', uri);
    } catch (err) {
      await vscode.env.openExternal(uri);
    }
  }

  async function open() {
    const config = detect.resolveConfig(readSettings());
    if (await proc.isPortInUse(config.host, config.port)) {
      await openBrowser(config);
      return;
    }
    const workspace = detect.resolveWorkspace(vscode.workspace.workspaceFolders);
    if (!workspace) {
      vscode.window.showErrorMessage('DSH: open a workspace folder first.');
      return;
    }
    const patches = detect.resolvePatches(config, workspace);
    const resolved = detect.resolveDsh(config);
    try {
      child = proc.spawnDsh(resolved, {
        host: config.host,
        port: config.port,
        patches,
        cwd: workspace,
      });
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      vscode.window.showErrorMessage('DSH: failed to start: ' + msg);
      return;
    }
    const ready = await proc.waitForPort(config.host, config.port);
    if (!ready) {
      vscode.window.showErrorMessage('DSH: server did not start (port not listening).');
      return;
    }
    await openBrowser(config);
  }

  async function stop() {
    if (!child) {
      vscode.window.showInformationMessage('DSH: not running (no instance started by this window).');
      return;
    }
    const stopped = await proc.killDsh(child);
    child = null;
    if (stopped) {
      vscode.window.showInformationMessage('DSH: stopped.');
    } else {
      vscode.window.showErrorMessage('DSH: failed to stop.');
    }
  }

  return {
    open,
    stop,
    getChild: () => child,
  };
}

module.exports = { createManager };
