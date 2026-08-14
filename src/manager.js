/**
 * @intent
 * 生命周期编排：start/open/stop 的决策顺序，持有当前子进程引用，屏蔽 VS Code 交互细节。
 *
 * 边界：start 无工作区时报错返回不抛异常；端口已监听则只 open 不 spawn；spawn 失败报错返回；
 * stop 无记录实例时仅提示不抛异常；open 优先 simpleBrowser.api.open、失败回退 openExternal。
 *
 * 验收条件：
 * - start 顺序 = resolveConfig → resolveWorkspace → isPortInUse →(spawn)→ open
 * - 端口已占用时 start 跳过 spawn 直接 open
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

  async function open() {
    const config = detect.resolveConfig(readSettings());
    const url = detect.buildUrl(config.host, config.port);
    const uri = vscode.Uri.parse(url);
    try {
      await vscode.commands.executeCommand('simpleBrowser.api.open', uri);
    } catch (err) {
      await vscode.env.openExternal(uri);
    }
  }

  async function start() {
    const config = detect.resolveConfig(readSettings());
    const workspace = detect.resolveWorkspace(vscode.workspace.workspaceFolders);
    if (!workspace) {
      vscode.window.showErrorMessage('DSH: open a workspace folder first.');
      return;
    }
    if (await proc.isPortInUse(config.host, config.port)) {
      await open();
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
    await open();
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
    start,
    stop,
    getChild: () => child,
  };
}

module.exports = { createManager };
