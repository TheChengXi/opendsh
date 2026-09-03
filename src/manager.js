/**
 * @intent
 * 生命周期编排：open/stop。open 端口已监听则直接打开，未监听则自动启动并等待端口就绪后再打开；
 * 已有存活 child 时复用等待，不重复 spawn（启动去重）；持有当前子进程引用，屏蔽 VS Code 交互细节；
 * 启动诊断经 outputChannel 输出，失败弹窗带具体原因。
 * 打开统一走 webview 单例：面板存活则聚焦（reveal），否则 createWebviewPanel 新建唯一标签页
 * （iframe 承载 DSH UI，html 由 webview 模块生成）；端口未监听路径（含重启）重设 html 强制重载；
 * 面板创建早于最近一次服务启动（旧页面滞留）时同样强制重设 html（serverStartedAt stale 判断）；
 * 打开方式按 settings 的 openWith 分叉（薄壳启动器：一切由 settings 决定，无面板、无状态记忆）：
 * systemBrowser → openExternal 直开；simpleBrowser → VS Code 内置浏览器（每次新建标签页）；
 * tab（默认）→ webview 单例，multipleTabs=true 时每次新建独立标签页（共享同一服务端口）。
 * 本模块只负责打开/起停，不承担任何界面聚焦契约（?focus= 由 DSH 侧负责）。
 * open 入口有防连点节流（debounceMs，默认 300ms），窗口内重复触发直接忽略。
 *
 * 边界：端口未监听且无工作区时报错返回不抛异常；resolveDsh 返回 null 时快速失败提示配置/安装 dsh；
 * spawn 失败报错返回；端口等待超时报错且不打开；端口被非 dsh 进程占用（无 child 且 httpProbe 不匹配）时报错不打开；
 * stop 后短残窗内 open 视为「刚停残留」：等待端口释放后再启动，超时未释放报错（区别于外部 dsh 直开/其他程序占用）；
 * stop 无记录实例时仅提示不抛异常；createWebviewPanel 抛错回退 openExternal；
 * 标签页关闭（onDidDispose）仅清面板引用，不触碰子进程；
 * systemBrowser/simpleBrowser/multipleTabs 方式不维护单例面板引用，无单标签页语义；simpleBrowser 抛错回退 openExternal。
 * 配置读取经 readSettings：VS Code 嵌套设置键必须用点式键读（cfg.get('launch.mode')→字段 launchMode、cfg.get('experimental.windowsHidePatch')→字段 windowsHidePatch），
 *   其余单段键（host/port/dshPath/patchFile/openWith/multipleTabs）用同名 key；产出对象为扁平字段（供 detect.resolveConfig 消费）。
 * 五模式启动（单枚举 launch.mode，无优先级叠加）经 src/launch/index 分发器按 config.launchMode 分发到对应启动器
 * （integrated/window/hidden/window-keepalive/hidden-keepalive），各启动器返回统一 {kind:'terminal'|'child', 引用} 契约，
 *   manager 按 kind 消费：terminal 存引用（integrated，无 pid）并注册 onDidClose 清引用，child 挂 attachStderr + 写 pid；
 *   启动细节（补丁、showWindow、命令组装）收敛在各启动器，manager 不感知单个模式；
 *   启动超时（waitForPort 失败）时 resetTerminal（dispose 失败终端 + 置空引用）与 resetChild（杀僵尸 child + 清引用 + 删 pid），
 *   下次 open 重走启动；复用分支超时同样复位 terminal + child（防止「毒引用」永久复用等待）。
 *
 * 验收条件：
 * - open 端口未监听时 spawn → 等待端口就绪 → openWebview；已监听时跳过 spawn 直接 openWebview
 * - debounceMs 窗口内连续 open 只执行第一次（节流）
 * - openWith=systemBrowser 时 openWebview 直接 openExternal，不创建面板
 * - openWith=simpleBrowser 时走 simpleBrowser.api.open，抛错回退 openExternal
 * - openWith=tab 时走 webview 单例；multipleTabs=true 时每次 open 新建面板（不复用 panel）
 * - openWebview 面板存活时 reveal 不新建；端口未监听路径传 reload=true 重设 html
 * - onDidDispose 清引用后再次 open 重新创建面板
 * - createWebviewPanel 抛错时回退 openExternal
 * - 端口被其他程序占用（无 child 且探测不匹配）报错不打开
 * - stop 后残窗内 open 等待端口释放后重新 spawn，超时报错；残窗过后端口在占用则按外部 dsh/其他程序判定
 * - 端口未监听且无工作区时报错且不 spawn
 * - 已有存活 child 再 open：复用 waitForPort，不重复 spawn
 * - resolveDsh 为 null 时报错且不 spawn
 * - 端口等待超时报错且不 open
 * - readSettings 用点式键读 launch.mode / experimental.windowsHidePatch，产出扁平字段 launchMode / windowsHidePatch
 * - 启动日志写入 outputChannel，失败弹窗附 stderr 摘要
 * - stop 无 child 时提示且不抛异常
 * - dispose 静默终止 child（不弹消息），无 child 时安全返回；keepalive 模式（window-keepalive/hidden-keepalive）时不终止
 * - 五模式分发经 src/launch/index 按 launchMode 分发到对应启动器，统一返回 {kind:'terminal'|'child'} 被 manager 消费：
 *   integrated 存 terminal 引用（不写 pid），window/hidden spawn 真实 child 写 pid，keepalive 两类 spawnStandalone 产出 { pid }
 * - 启动超时（waitForPort 返回 false）复位启动实例：dispose 失败终端 + 置空引用、kill 僵尸 child + 清引用 + 删 pid，下次 open 重走启动；复用分支超时同样复位 terminal + child
 * - 启动成功后写 pid 到 <workspace>/.dsh/opendsh.pid（integrated 模式除外）；stop 无 child 时读 pid 文件停止残留服务（经端口/httpProbe 验证防误杀），成功删文件
 * - dispose 杀掉后删 pid 文件；keepalive 独立模式不删（跨会话 stop 可用）；integrated 模式 dispose 关终端
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

function createManager(deps) {
  const detect = deps.detect;
  const proc = deps.process;
  const webview = deps.webview;
  const patch = deps.patch;
  const vscode = deps.vscode;
  const launcher = require('./launch').createLauncher({ vscode, process: proc, patch });

  let child = null;
  let terminal = null; // 普通 terminal 模式承载 DSH 的集成终端（无 pid，stop/dispose 关终端停服务）
  let panel = null; // DSH Web UI 单例标签页（WebviewPanel）
  let serverStartedAt = 0; // 最近一次 spawn 成功的时刻；面板创建早于它 → 面板持有的是旧服务页面，open 时强制刷新
  let stderrTail = '';
  let startedKeepAlive = false; // 启动时记录的独立存活模式（window-keepalive/hidden-keepalive），dispose 用它而非关闭时读配置
  let lastOpenAt = 0; // 防连点节流时间戳
  let lastStopAt = 0; // 最近一次 stop 时刻；残窗内 open 视为「刚停残留」等待端口释放
  const debounceMs = Number.isInteger(deps.debounceMs) && deps.debounceMs >= 0 ? deps.debounceMs : 300;
  const stopResidualMs = Number.isInteger(deps.stopResidualMs) && deps.stopResidualMs >= 0 ? deps.stopResidualMs : 5000;
  const portReleaseTimeoutMs = Number.isInteger(deps.portReleaseTimeoutMs) && deps.portReleaseTimeoutMs >= 0 ? deps.portReleaseTimeoutMs : 5000;
  const channel =
    typeof vscode.window.createOutputChannel === 'function'
      ? vscode.window.createOutputChannel('DSH')
      : null;

  function log(line) {
    if (channel && typeof channel.appendLine === 'function') {
      channel.appendLine('[opendsh] ' + line);
    }
  }

  function pidFilePath(workspace) {
    return workspace ? path.join(workspace, '.dsh', 'opendsh.pid') : null;
  }

  function writePidFile(workspace, pid) {
    const p = pidFilePath(workspace);
    if (!p) return;
    try {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, String(pid), 'utf8');
    } catch (err) {
      log('pid file write failed: ' + (err && err.message ? err.message : err));
    }
  }

  function readPidFile(workspace) {
    const p = pidFilePath(workspace);
    if (!p) return null;
    try {
      const pid = Number(fs.readFileSync(p, 'utf8').trim());
      return Number.isInteger(pid) && pid > 0 ? pid : null;
    } catch (err) {
      return null;
    }
  }

  function removePidFile(workspace) {
    const p = pidFilePath(workspace);
    if (!p) return;
    try {
      fs.unlinkSync(p);
    } catch (err) {
      // file already gone; ignore
    }
  }

  function attachStderr(c) {
    if (!c || !c.stderr) return;
    c.stderr.setEncoding('utf8');
    c.stderr.on('data', (chunk) => {
      stderrTail = (stderrTail + chunk).slice(-2048);
      if (channel && typeof channel.append === 'function') channel.append(chunk);
    });
  }

  // 关闭失败终端并清引用：命令下发后端口未就绪（waitForPort 超时）时调用，下次 open 重走 integrated 启动。
  function resetTerminal() {
    if (!terminal) return;
    const t = terminal;
    terminal = null;
    t.dispose();
  }

  // 关闭失败/卡死的 child 并清引用：端口未就绪（waitForPort 超时）时调用，杀掉僵尸进程、删 pid，
  // 下次 open 重走启动，避免「毒 child 引用」导致永远复用等待。killDsh 对已死进程 taskkill 失败，无害。
  function resetChild() {
    if (!child) return;
    const c = child;
    child = null;
    if (c && !c.killed) {
      proc.killDsh(c);
    }
    removePidFile(detect.resolveWorkspace(vscode.workspace.workspaceFolders));
  }

  function readSettings() {
    const cfg = vscode.workspace.getConfiguration('opendsh');
    const settings = {
      host: cfg.get('host'),
      webviewHost: cfg.get('webviewHost'),
      port: cfg.get('port'),
      dshPath: cfg.get('dshPath'),
      patchFile: cfg.get('patchFile'),
      launchMode: cfg.get('launch.mode'),
      windowsHidePatch: cfg.get('experimental.windowsHidePatch'),
      openWith: cfg.get('openWith'),
      multipleTabs: cfg.get('multipleTabs'),
    };
    log('readSettings: ' + JSON.stringify(settings));
    return settings;
  }

  async function openWebview(config, opts) {
    const url = detect.buildUrl(config.webviewHost, config.port);
    log('openWebview: openWith=' + config.openWith + ', multipleTabs=' + config.multipleTabs + ', url=' + url);
    if (config.openWith === 'systemBrowser') {
      // 系统浏览器直接浏览 http://host:port，绕过内置 webview 封装（完整浏览器能力，适合测试 dsh 自身 UI）
      log('openWebview: opening system browser');
      await vscode.env.openExternal(vscode.Uri.parse(url));
      return;
    }
    if (config.openWith === 'simpleBrowser') {
      // VS Code 内置 Simple Browser：每次新建标签页，失败回退系统浏览器
      log('openWebview: opening simple browser');
      try {
        await vscode.commands.executeCommand('simpleBrowser.api.open', vscode.Uri.parse(url));
      } catch (err) {
        log('openWebview: simple browser failed, falling back to system browser');
        await vscode.env.openExternal(vscode.Uri.parse(url));
      }
      return;
    }
    if (config.multipleTabs) {
      // 多标签模式：每次 open 新建独立标签页（共享同一服务端口），不做单例复用
      log('openWebview: opening multiple tabs');
      try {
        const p = vscode.window.createWebviewPanel('opendsh.dsh', 'DSH', vscode.ViewColumn.Active, {
          enableScripts: true,
          retainContextWhenHidden: true,
        });
        p.webview.html = webview.buildWebviewHtml(url);
      } catch (err) {
        log('openWebview: createWebviewPanel failed, falling back to system browser');
        await vscode.env.openExternal(vscode.Uri.parse(url));
      }
      return;
    }
    if (panel) {
      // 单例标签页已存在：reload=true（服务曾停止/重启）或面板创建早于最近一次服务启动（旧页面滞留）
      // 时重设 html 强制刷新，否则仅聚焦
      const stale = serverStartedAt > (panel._createdAt || 0);
      if ((opts && opts.reload) || stale) {
        panel.webview.html = webview.buildWebviewHtml(url);
        log('webview reloaded');
      }
      panel.reveal(vscode.ViewColumn.Active, false);
      return;
    }
    try {
      log('openWebview: creating new webview panel');
      panel = vscode.window.createWebviewPanel('opendsh.dsh', 'DSH', vscode.ViewColumn.Active, {
        enableScripts: true,
        retainContextWhenHidden: true,
      });
      panel._createdAt = Date.now(); // 面板创建时刻，供 server 重启后的 stale 判断
      panel.webview.html = webview.buildWebviewHtml(url);
      panel.onDidDispose(() => {
        panel = null; // 关标签页只清引用，服务不受影响
      });
    } catch (err) {
      log('openWebview: createWebviewPanel failed, falling back to system browser');
      await vscode.env.openExternal(vscode.Uri.parse(url));
    }
  }

  async function open() {
    const now = Date.now();
    if (now - lastOpenAt < debounceMs) return; // 防连点：节流窗口内忽略重复触发（多标签模式防误开）
    lastOpenAt = now;
    const config = detect.resolveConfig(readSettings()); // 打开方式完全由 settings 决定（薄壳）
    const r = await ensureReady(config);
    if (r.ready) {
      await openWebview(config, r.reload ? { reload: true } : undefined);
    }
  }

  // 确保 dsh 服务就绪。返回 { ready, reload }：
  // ready=false 表示已弹错（端口占用/无工作区/dsh 缺失/启动失败/超时），调用方不再打开；
  // reload=true 表示服务刚启动或刚复用（新 spawn / 复用 child），打开时需重设 html 强制刷新。
  async function ensureReady(config) {
    const port = config.port;

    // 刚 stop 后的残留：旧进程尚在退出、端口未释放。等待释放后再走正常启动路径，
    // 避免把残留旧进程误判为「外部 dsh 仍在运行」而直接打开旧服务。
    if (Date.now() - lastStopAt < stopResidualMs) {
      const released = await proc.waitForPortRelease(config.host, port, { timeoutMs: portReleaseTimeoutMs });
      if (!released) {
        vscode.window.showErrorMessage(
          'DSH: previous instance did not stop in time (port ' + port + ' still in use).'
        );
        return { ready: false, reload: false };
      }
      lastStopAt = 0; // 释放完成，清除残留标记
    }

    if (await proc.isPortInUse(config.host, port)) {
      if (child && !child.killed) {
        log('port ' + port + ' listening (child pid=' + child.pid + '); opening');
        return { ready: true, reload: false };
      }
      const isDsh = await proc.httpProbe(config.host, port);
      if (isDsh) {
        log('port ' + port + ' listening (external dsh); opening');
        return { ready: true, reload: false };
      }
      log('port ' + port + ' in use by another program; reporting');
      vscode.window.showErrorMessage('DSH: port ' + port + ' is in use by another program.');
      return { ready: false, reload: false };
    }

    if ((child && !child.killed) || terminal) {
      log('instance starting; reusing (no duplicate spawn)');
      const ready = await proc.waitForPort(config.host, port);
      if (!ready) {
        const tail = stderrTail.trim();
        resetTerminal(); // 复用中的 terminal 卡死复位
        resetChild(); // 复用中的 child 卡死复位（杀僵尸 + 清引用，下次重走启动）
        vscode.window.showErrorMessage(
          'DSH: server did not start (port not listening).' + (tail ? '\n' + tail.slice(-300) : '')
        );
        return { ready: false, reload: false };
      }
      return { ready: true, reload: true };
    }

    const workspace = detect.resolveWorkspace(vscode.workspace.workspaceFolders);
    if (!workspace) {
      vscode.window.showErrorMessage('DSH: open a workspace folder first.');
      return { ready: false, reload: false };
    }
    const patches = detect.resolvePatches(config, workspace);
    const resolved = await detect.resolveDsh(config);
    if (!resolved) {
      log('dsh not found; failing fast');
      vscode.window.showErrorMessage(
        'DSH: dsh not found. Install globally (npm i -g @deepseek-ai/dsh) or set opendsh.dshPath.'
      );
      return { ready: false, reload: false };
    }
    log(
      'spawning: ' +
        resolved.command +
        (resolved.prefixArgs && resolved.prefixArgs.length ? ' ' + resolved.prefixArgs.join(' ') : '') +
        ' web (port ' + port + ')' +
        ' mode=' + config.launchMode
    );
    try {
      // 经 src/launch 分发器按 launchMode 启动：统一返回 {kind:'terminal'|'child', 引用}，manager 按 kind 消费
      const out = await launcher.start(config.launchMode, { resolved, config, workspace, patches });
      if (out.kind === 'terminal') {
        terminal = out.terminal;
        child = null;
        const t = terminal;
        if (typeof t.onDidClose === 'function') {
          t.onDidClose(() => {
            if (terminal === t) terminal = null;
          });
        }
      } else {
        child = out.child;
        terminal = null;
        attachStderr(child);
        writePidFile(workspace, child.pid);
      }
      serverStartedAt = Date.now(); // 服务启动成功即更新标记：已存活面板在下一次 open 时被判定为旧页面并强制刷新
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      vscode.window.showErrorMessage('DSH: failed to start: ' + msg);
      return { ready: false, reload: false };
    }
    startedKeepAlive = config.launchMode === 'window-keepalive' || config.launchMode === 'hidden-keepalive';
    const ready = await proc.waitForPort(config.host, port);
    if (!ready) {
      const tail = stderrTail.trim();
      resetTerminal(); // integrated 启动失败：失败终端复位，下次重开
      resetChild(); // child 启动失败：杀僵尸 + 清引用，下次重走启动
      vscode.window.showErrorMessage(
        'DSH: server did not start (port not listening).' + (tail ? '\n' + tail.slice(-300) : '')
      );
      return { ready: false, reload: false };
    }
    log('port ' + port + ' ready; opening');
    return { ready: true, reload: true };
  }

  async function stop() {
    const workspace = detect.resolveWorkspace(vscode.workspace.workspaceFolders);
    if (terminal) {
      const t = terminal;
      terminal = null;
      t.dispose();
      lastStopAt = Date.now(); // 记录停止时刻，供 open 的「刚停残留」判定
      stderrTail = '';
      startedKeepAlive = false;
      vscode.window.showInformationMessage('DSH: stopped.');
      return;
    }
    if (child) {
      const stopped = await proc.killDsh(child);
      lastStopAt = Date.now(); // 记录停止时刻，供 open 的「刚停残留」判定
      child = null;
      stderrTail = '';
      startedKeepAlive = false;
      removePidFile(workspace);
      if (stopped) {
        vscode.window.showInformationMessage('DSH: stopped.');
      } else {
        vscode.window.showErrorMessage('DSH: failed to stop.');
      }
      return;
    }
    // 无 child（重载/跨会话）：读 pid 文件停残留服务，经端口+httpProbe 验证防误杀
    const pid = readPidFile(workspace);
    if (!pid) {
      vscode.window.showInformationMessage('DSH: not running (no instance started by this window).');
      return;
    }
    const config = detect.resolveConfig(readSettings());
    if (await proc.isPortInUse(config.host, config.port)) {
      const isDsh = await proc.httpProbe(config.host, config.port);
      if (!isDsh) {
        vscode.window.showErrorMessage('DSH: port ' + config.port + ' is in use by another program.');
        return;
      }
    } else {
      // 端口未监听：pid 文件过期，清理后提示
      removePidFile(workspace);
      vscode.window.showInformationMessage('DSH: not running (no instance started by this window).');
      return;
    }
    const stopped = await proc.killPid(pid);
    lastStopAt = Date.now(); // 记录停止时刻，供 open 的「刚停残留」判定
    if (stopped) {
      removePidFile(workspace);
      vscode.window.showInformationMessage('DSH: stopped.');
    } else {
      vscode.window.showErrorMessage('DSH: failed to stop.');
    }
  }

  async function dispose() {
    if (!child && !terminal) return;
    if (startedKeepAlive) return; // 启动时为独立存活模式：不随编辑器关闭终止服务
    if (terminal) {
      const t = terminal;
      terminal = null;
      t.dispose();
      return;
    }
    const c = child;
    child = null;
    stderrTail = '';
    const workspace = detect.resolveWorkspace(vscode.workspace.workspaceFolders);
    await proc.killDsh(c);
    removePidFile(workspace);
  }

  return {
    open,
    stop,
    dispose,
    getChild: () => child,
  };
}

module.exports = { createManager };
