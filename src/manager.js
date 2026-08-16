/**
 * @intent
 * 生命周期编排：open/stop。open 端口已监听则直接打开，未监听则自动启动并等待端口就绪后再打开；
 * 已有存活 child 时复用等待，不重复 spawn（启动去重）；持有当前子进程引用，屏蔽 VS Code 交互细节；
 * 启动诊断经 outputChannel 输出，失败弹窗带具体原因。
 * 打开统一走 webview 单例：面板存活则聚焦（reveal），否则 createWebviewPanel 新建唯一标签页
 * （iframe 承载 DSH UI，html 由 webview 模块生成）；端口未监听路径（含重启）重设 html 强制重载；
 * 面板创建早于最近一次服务启动（旧页面滞留）时同样强制重设 html（serverStartedAt stale 判断）；
 * 打开方式按 config.openWith 分叉：systemBrowser → openExternal 直开；simpleBrowser → VS Code 内置浏览器
 * （每次新建标签页）；tab（默认）→ webview 单例，multipleTabs=true 时每次新建独立标签页（共享同一服务端口）；
 * focus → 委托注入的 focus 编排器打开「对话进 VS Code 侧栏 + 输入区留主编辑区」双承载面（复用本模块 spawn/起停流程，
 * 仅把"开单页 webview"替换为"开双承载面"，focus 模块不管理服务进程）；
 * open 入口有防连点节流（debounceMs，默认 300ms），窗口内重复触发直接忽略。
 *
 * 边界：端口未监听且无工作区时报错返回不抛异常；resolveDsh 返回 null 时快速失败提示配置/安装 dsh；
 * spawn 失败报错返回；端口等待超时报错且不打开；端口被非 dsh 进程占用（无 child 且 httpProbe 不匹配）时报错不打开；
 * stop 无记录实例时仅提示不抛异常；createWebviewPanel 抛错回退 openExternal；
 * 标签页关闭（onDidDispose）仅清面板引用，不触碰子进程；
 * systemBrowser/simpleBrowser/multipleTabs 方式不维护单例面板引用，无单标签页语义；simpleBrowser 抛错回退 openExternal；
 * focus 分支若 focus 编排器未注入（deps 缺 focus）则按 tab 兜底，不静默创建残缺承载面；
 * focus 创建侧栏/主区 webview 抛错时回退 openExternal（与 tab 一致）。
 *
 * 验收条件：
 * - open 端口未监听时 spawn → 等待端口就绪 → openWebview；已监听时跳过 spawn 直接 openWebview
 * - debounceMs 窗口内连续 open 只执行第一次（节流）
 * - multipleTabs=true 时每次 open 新建面板（不复用 panel）
 * - openWith=systemBrowser 时 openWebview 直接 openExternal，不创建面板
 * - openWith=simpleBrowser 时走 simpleBrowser.api.open，抛错回退 openExternal
 * - openWebview 面板存活时 reveal 不新建；端口未监听路径传 reload=true 重设 html
 * - onDidDispose 清引用后再次 open 重新创建面板
 * - createWebviewPanel 抛错时回退 openExternal
 * - 端口被其他程序占用（无 child 且探测不匹配）报错不打开
 * - 端口未监听且无工作区时报错且不 spawn
 * - 已有存活 child 再 open：复用 waitForPort，不重复 spawn
 * - 端口被其他程序占用（无 child 且探测不匹配）报错不打开
 * - 端口未监听且无工作区时报错且不 spawn
 * - resolveDsh 为 null 时报错且不 spawn
 * - 端口等待超时报错且不 open
 * - 启动日志写入 outputChannel，失败弹窗附 stderr 摘要
 * - stop 无 child 时提示且不抛异常
 * - dispose 静默终止 child（不弹消息），无 child 时安全返回；detached=true（独立存活）时不终止
 * - spawn 透传 showWindow 决定窗口/静默模式
 * - 启动成功后写 pid 到 <workspace>/.dsh/opendsh.pid；stop 无 child 时读 pid 文件停止残留服务（经端口/httpProbe 验证防误杀），成功删文件
 * - dispose 杀掉后删 pid 文件；detached 独立模式不删（跨会话 stop 可用）
 * - detached=true 时走 spawnStandalone（Windows WMI 脱离 VS Code job），child 变为 { pid } 伪对象，日志经窗口展示
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

function createManager(deps) {
  const detect = deps.detect;
  const proc = deps.process;
  const webview = deps.webview;
  const focus = deps.focus; // focus 编排器（openWith=focus 时委托），可选注入
  const vscode = deps.vscode;

  let child = null;
  let panel = null; // DSH Web UI 单例标签页（WebviewPanel）
  let serverStartedAt = 0; // 最近一次 spawn 成功的时刻；面板创建早于它 → 面板持有的是旧服务页面，open 时强制刷新
  let stderrTail = '';
  let startedDetached = false; // 启动时记录的独立存活模式，dispose 用它而非关闭时读配置
  let lastOpenAt = 0; // 防连点节流时间戳
  const debounceMs = Number.isInteger(deps.debounceMs) && deps.debounceMs >= 0 ? deps.debounceMs : 300;
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

  function readSettings() {
    const cfg = vscode.workspace.getConfiguration('opendsh');
    return {
      host: cfg.get('host'),
      webviewHost: cfg.get('webviewHost'),
      port: cfg.get('port'),
      dshPath: cfg.get('dshPath'),
      patchFile: cfg.get('patchFile'),
      detached: cfg.get('detached'),
      showWindow: cfg.get('showWindow'),
      openWith: cfg.get('openWith'),
      multipleTabs: cfg.get('multipleTabs'),
    };
  }

  async function openWebview(config, opts) {
    const url = detect.buildUrl(config.webviewHost, config.port);
    if (config.openWith === 'focus') {
      // 聚焦模式：对话进 VS Code 侧栏 + 输入区留主编辑区，双承载面由 focus 编排器负责。
      // focus 未注入（可选依赖）时回退 tab 单例逻辑（下方），不静默创建残缺承载面。
      if (focus && typeof focus.open === 'function') {
        try {
          await focus.open(config);
        } catch (err) {
          await vscode.env.openExternal(vscode.Uri.parse(url));
        }
        return;
      }
    }
    if (config.openWith === 'systemBrowser') {
      // 系统浏览器直接浏览 http://host:port，绕过内置 webview 封装（完整浏览器能力，适合测试 dsh 自身 UI）
      await vscode.env.openExternal(vscode.Uri.parse(url));
      return;
    }
    if (config.openWith === 'simpleBrowser') {
      // VS Code 内置 Simple Browser（旧版默认打开方式）：每次新建标签页，失败回退系统浏览器
      try {
        await vscode.commands.executeCommand('simpleBrowser.api.open', vscode.Uri.parse(url));
      } catch (err) {
        await vscode.env.openExternal(vscode.Uri.parse(url));
      }
      return;
    }
    if (config.multipleTabs) {
      // 多标签模式：每次 open 新建独立标签页（共享同一服务端口），不做单例复用
      try {
        const p = vscode.window.createWebviewPanel('opendsh.dsh', 'DSH', vscode.ViewColumn.Active, {
          enableScripts: true,
          retainContextWhenHidden: true,
        });
        p.webview.html = webview.buildWebviewHtml(url);
      } catch (err) {
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
      await vscode.env.openExternal(vscode.Uri.parse(url));
    }
  }

  async function open() {
    const now = Date.now();
    if (now - lastOpenAt < debounceMs) return; // 防连点：节流窗口内忽略重复触发（多标签模式防误开）
    lastOpenAt = now;
    const config = detect.resolveConfig(readSettings());
    const port = config.port;

    if (await proc.isPortInUse(config.host, port)) {
      // 端口已监听：本窗口 child 或外部 dsh → 打开；其他程序占用 → 报错
      if (child && !child.killed) {
        log('port ' + port + ' listening (child pid=' + child.pid + '); opening');
        await openWebview(config);
        return;
      }
      const isDsh = await proc.httpProbe(config.host, port);
      if (isDsh) {
        log('port ' + port + ' listening (external dsh); opening');
        await openWebview(config);
      } else {
        log('port ' + port + ' in use by another program; reporting');
        vscode.window.showErrorMessage('DSH: port ' + port + ' is in use by another program.');
      }
      return;
    }

    // 端口空闲但已有本窗口 child 在启动中：复用等待，不重复 spawn
    if (child && !child.killed) {
      log('child pid=' + child.pid + ' starting; reusing (no duplicate spawn)');
      const ready = await proc.waitForPort(config.host, port);
      if (!ready) {
        const tail = stderrTail.trim();
        vscode.window.showErrorMessage(
          'DSH: server did not start (port not listening).' + (tail ? '\n' + tail.slice(-300) : '')
        );
        return;
      }
      await openWebview(config, { reload: true });
      return;
    }

    const workspace = detect.resolveWorkspace(vscode.workspace.workspaceFolders);
    if (!workspace) {
      vscode.window.showErrorMessage('DSH: open a workspace folder first.');
      return;
    }
    const patches = detect.resolvePatches(config, workspace);
    const resolved = await detect.resolveDsh(config);
    if (!resolved) {
      log('dsh not found; failing fast');
      vscode.window.showErrorMessage(
        'DSH: dsh not found. Install globally (npm i -g @deepseek-ai/dsh) or set opendsh.dshPath.'
      );
      return;
    }
    log(
      'spawning: ' +
        resolved.command +
        (resolved.prefixArgs && resolved.prefixArgs.length ? ' ' + resolved.prefixArgs.join(' ') : '') +
        ' web (port ' + port + ')'
    );
    try {
      if (config.detached) {
        // 独立存活模式：Windows 经 WMI 脱离 VS Code job（真独立），POSIX 走 detached spawn
        const spawned = await proc.spawnStandalone(resolved, {
          host: config.host,
          port,
          patches,
          cwd: workspace,
          showWindow: config.showWindow,
        });
        child = { pid: spawned.pid }; // 伪 child：仅 pid（WMI 进程非本进程子进程，无 stderr/exit 事件）
      } else {
        child = proc.spawnDsh(resolved, {
          host: config.host,
          port,
          patches,
          cwd: workspace,
          showWindow: config.showWindow,
        });
      }
      serverStartedAt = Date.now(); // 服务启动成功即更新标记：已存活面板在下一次 open 时被判定为旧页面并强制刷新
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      vscode.window.showErrorMessage('DSH: failed to start: ' + msg);
      return;
    }
    attachStderr(child);
    writePidFile(workspace, child.pid);
    startedDetached = config.detached;
    const ready = await proc.waitForPort(config.host, port);
    if (!ready) {
      const tail = stderrTail.trim();
      vscode.window.showErrorMessage(
        'DSH: server did not start (port not listening).' + (tail ? '\n' + tail.slice(-300) : '')
      );
      return;
    }
    log('port ' + port + ' ready; opening');
    await openWebview(config, { reload: true });
  }

  async function stop() {
    if (focus && typeof focus.reset === 'function') focus.reset(); // 聚焦承载面随服务停止清引用
    const workspace = detect.resolveWorkspace(vscode.workspace.workspaceFolders);
    if (child) {
      const stopped = await proc.killDsh(child);
      child = null;
      stderrTail = '';
      startedDetached = false;
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
    if (stopped) {
      removePidFile(workspace);
      vscode.window.showInformationMessage('DSH: stopped.');
    } else {
      vscode.window.showErrorMessage('DSH: failed to stop.');
    }
  }

  async function dispose() {
    if (!child) {
      if (focus && typeof focus.reset === 'function') focus.reset(); // 无 child 时也清聚焦承载面引用
      return;
    }
    if (startedDetached) return; // 启动时为独立存活模式：不随编辑器关闭终止服务
    if (focus && typeof focus.reset === 'function') focus.reset();
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
