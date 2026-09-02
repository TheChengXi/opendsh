/**
 * @intent
 * manager.js 的 node:test 编排测试，注入假 detect/process/webview/patch/vscode 断言决策顺序与边界。
 *
 * 验收条件：node --test 全绿，覆盖 open 自动启动、启动去重复用 child、端口占用归属判定、stop 后残窗内 open 等待端口释放、无工作区报错、
 * resolveDsh null 快速失败、端口超时报错、webview 单例/复用 reveal/重启重载/关页重建/创建失败回退、
 * 打开方式分叉（systemBrowser/simpleBrowser/multipleTabs/tab）、channel 日志、stop 无 child 提示、
 * pid 文件读写、五模式分发（integrated 终端 / window 桌面窗口 / hidden 静默 / window-keepalive 弹窗独立 / hidden-keepalive 静默独立+可选补丁）。
 * settings 测试数据用真实 VS Code 键名（'launch.mode' / 'experimental.windowsHidePatch' 点式键），
 * harness 的 cfgGet 按键直查 settings，不模拟点段拆分；键名错位时值取不到 → 回退 → 断言失败，回归敏感。
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createManager } = require('../src/manager');
const webview = require('../src/webview');

function makeHarness(opts) {
  opts = opts || {};
  const calls = {
    messages: [],
    panels: [],
    opened: [],
    external: [],
    spawned: null,
    spawnCount: 0,
    killed: null,
    killedPid: null,
    waited: null,
    waitedCount: 0,
    portRelease: null,
    channel: null,
    patchAppliedChecks: 0,
    terminals: [],
  };

  const fakeDetect = {
    resolveConfig: (s) => s,
    resolveWorkspace: (folders) =>
      (folders && folders[0] && folders[0].uri && folders[0].uri.fsPath) || null,
    resolvePatches: () => ['/ws/.dsh/a.patch.yml'],
    resolveDsh: () => ({ command: 'dsh', prefixArgs: [] }),
    buildUrl: (h, p) => `http://${h}:${p}`,
    ...(opts.detect || {}),
  };

  const fakeProc = {
    isPortInUse: async () => false,
    httpProbe: async () => true,
    spawnDsh: (r, o) => {
      calls.spawned = { r, o };
      calls.spawnCount++;
      return { pid: 1, killed: false };
    },
    spawnDshVisible: (r, o) => {
      calls.spawned = { r, o, visible: true };
      calls.spawnCount++;
      return { pid: 8, killed: false };
    },
    waitForPort: async (host, port) => {
      calls.waited = { host, port };
      calls.waitedCount++;
      return true;
    },
    waitForPortRelease: async (host, port) => {
      calls.portRelease = { host, port };
      return true;
    },
    killDsh: async () => {
      calls.killed = true;
      return true;
    },
    killPid: async (pid) => {
      calls.killedPid = pid;
      return true;
    },
    spawnStandalone: async (r, o) => {
      calls.spawned = { r, o, standalone: true };
      calls.spawnCount++;
      return { pid: 9 };
    },
    buildTerminalCommand: (r, o) => {
      calls.terminalCommand = { r, o };
      return 'dsh web --host 127.0.0.1 --port 3080';
    },
    ...(opts.process || {}),
  };

  const fakePatch = {
    isApplied: () => {
      calls.patchAppliedChecks++;
      return opts.patchApplied !== undefined ? opts.patchApplied : true;
    },
    buildPatchCommand: () => (opts.patchCommand !== undefined ? opts.patchCommand : "node -e 'x'"),
    ...(opts.patch || {}),
  };

  const baseSettings = { host: '127.0.0.1', webviewHost: '', port: 3080, dshPath: '', patchFile: '', 'launch.mode': 'hidden', 'experimental.windowsHidePatch': false, openWith: 'tab' };
  const cfgGet = (key) =>
    opts.settings && opts.settings[key] !== undefined ? opts.settings[key] : baseSettings[key];

  const vscode = {
    workspace: {
      getConfiguration: () => ({ get: cfgGet }),
      workspaceFolders: opts.folders !== undefined ? opts.folders : [{ uri: { fsPath: '/ws' } }],
    },
    Uri: { parse: (u) => u },
    ViewColumn: { Active: 1 },
    commands: {
      executeCommand: async (cmd, uri) => {
        if (opts.throwOnOpen) throw new Error('no simple browser');
        calls.opened.push({ cmd, uri });
      },
    },
    env: { openExternal: async (uri) => calls.external.push(uri) },
    window: {
      showErrorMessage: (m) => calls.messages.push({ kind: 'error', m }),
      showInformationMessage: (m) => calls.messages.push({ kind: 'info', m }),
      createTerminal: (name) => {
        const t = {
          name,
          sent: [],
          shown: 0,
          disposed: false,
          onDidClose: (cb) => {
            t._close = cb;
          },
          sendText: (txt) => t.sent.push(txt),
          show: () => {
            t.shown++;
          },
          dispose: () => {
            t.disposed = true;
          },
        };
        calls.terminals.push(t);
        return t;
      },
      createOutputChannel: (name) => {
        calls.channel = { name, lines: [], appended: '' };
        return {
          appendLine: (l) => calls.channel.lines.push(l),
          append: (s) => {
            calls.channel.appended += s;
          },
        };
      },
      createWebviewPanel: (viewType, title, column, options) => {
        if (opts.throwOnOpen) throw new Error('webview unavailable');
        const p = {
          viewType,
          title,
          column,
          options,
          revealed: 0,
          htmlSets: [],
          _dispose: null,
          webview: {
            get html() {
              return p._html;
            },
            set html(v) {
              p._html = v;
              p.htmlSets.push(v);
            },
          },
          reveal: (col, focus) => {
            p.revealed++;
            p.revealArgs = { col, focus };
          },
          onDidDispose: (cb) => {
            p._dispose = cb;
          },
        };
        calls.panels.push(p);
        return p;
      },
    },
  };

  const manager = createManager({
    detect: fakeDetect,
    process: fakeProc,
    webview,
    patch: fakePatch,
    vscode,
    debounceMs: opts.debounceMs !== undefined ? opts.debounceMs : 0,
    stopResidualMs: opts.stopResidualMs !== undefined ? opts.stopResidualMs : 5000,
    portReleaseTimeoutMs: opts.portReleaseTimeoutMs !== undefined ? opts.portReleaseTimeoutMs : 5000,
  });
  return { manager, calls };
}

test('open auto-starts when port free', async () => {
  const h = makeHarness();
  await h.manager.open();
  assert.ok(h.calls.spawned);
  assert.strictEqual(h.calls.spawned.o.cwd, '/ws');
  assert.ok(h.calls.waited);
  assert.strictEqual(h.calls.waited.host, '127.0.0.1');
  assert.strictEqual(h.calls.waited.port, 3080);
  assert.strictEqual(h.calls.panels.length, 1);
  assert.strictEqual(h.calls.panels[0].htmlSets.length, 1);
  assert.ok(h.calls.panels[0].webview.html.includes('frame-src'));
  assert.ok(h.manager.getChild());
});

test('open skips spawn when port in use', async () => {
  const h = makeHarness({
    process: {
      isPortInUse: async () => true,
      spawnDsh: () => {
        throw new Error('should not spawn');
      },
      killDsh: async () => true,
    },
  });
  await h.manager.open();
  assert.strictEqual(h.calls.spawned, null);
  assert.strictEqual(h.calls.panels.length, 1);
  assert.strictEqual(h.manager.getChild(), null);
});

test('open opens without workspace when port already in use', async () => {
  const h = makeHarness({
    folders: [],
    process: {
      isPortInUse: async () => true,
      spawnDsh: () => {
        throw new Error('should not spawn');
      },
      killDsh: async () => true,
    },
  });
  await h.manager.open();
  assert.strictEqual(h.calls.spawned, null);
  assert.strictEqual(h.calls.panels.length, 1);
});

test('open shows error when port free and no workspace', async () => {
  const h = makeHarness({ folders: [] });
  await h.manager.open();
  assert.strictEqual(h.calls.spawned, null);
  assert.strictEqual(h.calls.panels.length, 0);
  assert.ok(h.calls.messages.some((x) => x.kind === 'error'));
});

test('open shows error when server fails to start (port timeout)', async () => {
  const h = makeHarness({
    process: {
      isPortInUse: async () => false,
      waitForPort: async () => false,
      killDsh: async () => true,
    },
  });
  await h.manager.open();
  assert.ok(h.calls.spawned);
  assert.strictEqual(h.calls.panels.length, 0);
  assert.ok(h.calls.messages.some((x) => x.kind === 'error'));
});

test('open falls back to external browser when createWebviewPanel throws', async () => {
  const h = makeHarness({ throwOnOpen: true });
  await h.manager.open();
  assert.strictEqual(h.calls.external.length, 1);
  assert.strictEqual(h.calls.panels.length, 0);
});

test('open uses system browser directly when openWith is systemBrowser', async () => {
  const h = makeHarness({ settings: { openWith: 'systemBrowser' } });
  await h.manager.open();
  assert.strictEqual(h.calls.external.length, 1);
  assert.strictEqual(h.calls.panels.length, 0);
});

test('open uses simple browser when openWith is simpleBrowser', async () => {
  const h = makeHarness({ settings: { openWith: 'simpleBrowser' } });
  await h.manager.open();
  assert.strictEqual(h.calls.opened.length, 1);
  assert.strictEqual(h.calls.opened[0].cmd, 'simpleBrowser.api.open');
  assert.strictEqual(h.calls.panels.length, 0);
  assert.strictEqual(h.calls.external.length, 0);
});

test('open falls back to external browser when simpleBrowser throws', async () => {
  const h = makeHarness({ settings: { openWith: 'simpleBrowser' }, throwOnOpen: true });
  await h.manager.open();
  assert.strictEqual(h.calls.external.length, 1);
  assert.strictEqual(h.calls.panels.length, 0);
});

test('stop with no child shows info and does not kill', async () => {
  const h = makeHarness();
  await h.manager.stop();
  assert.strictEqual(h.calls.killed, null);
  assert.ok(h.calls.messages.some((x) => x.kind === 'info'));
});

test('stop kills tracked child then clears it', async () => {
  const h = makeHarness();
  await h.manager.open();
  await h.manager.stop();
  assert.strictEqual(h.calls.killed, true);
  assert.strictEqual(h.manager.getChild(), null);
});

test('open after stop waits for port release before respawning', async () => {
  let releaseCalled = 0;
  const h = makeHarness({
    process: {
      waitForPortRelease: async () => {
        releaseCalled++;
        return true;
      },
    },
  });
  await h.manager.open();
  assert.strictEqual(h.calls.spawnCount, 1);
  await h.manager.stop();
  assert.strictEqual(h.calls.killed, true);

  await h.manager.open(); // stop 残窗内：先等待端口释放，再重新 spawn
  assert.strictEqual(releaseCalled, 1);
  assert.strictEqual(h.calls.spawnCount, 2);
});

test('open after stop reports error when port not released in time', async () => {
  const h = makeHarness({
    process: {
      waitForPortRelease: async () => false, // 端口一直未释放
    },
  });
  await h.manager.open();
  await h.manager.stop();
  await h.manager.open();
  assert.strictEqual(h.calls.spawnCount, 1); // 第二次没再 spawn
  assert.ok(h.calls.messages.some((x) => x.kind === 'error' && x.m.includes('did not stop in time')));
});

test('open after stop with zero residual window skips release wait', async () => {
  let releaseCalled = 0;
  const h = makeHarness({
    stopResidualMs: 0,
    process: {
      waitForPortRelease: async () => {
        releaseCalled++;
        return true;
      },
    },
  });
  await h.manager.open();
  await h.manager.stop();
  await h.manager.open(); // 残窗为 0，不进入释放等待，直接走正常 isPortInUse
  assert.strictEqual(releaseCalled, 0);
});

test('open reuses existing child instead of duplicate spawn', async () => {
  const h = makeHarness();
  await h.manager.open(); // first spawn
  assert.strictEqual(h.calls.spawnCount, 1);
  await h.manager.open(); // second must reuse, not spawn
  assert.strictEqual(h.calls.spawnCount, 1);
  assert.ok(h.calls.waitedCount >= 2);
  // 单例标签页：第二次 open 复用面板（reload 重设 html + reveal），不新建
  assert.strictEqual(h.calls.panels.length, 1);
  assert.strictEqual(h.calls.panels[0].revealed, 1);
  assert.strictEqual(h.calls.panels[0].htmlSets.length, 2);
});

test('open force-reloads a live panel created before the last server start', async () => {
  const proc = { isPortInUse: async () => false }; // 可变引用：第一次走 spawn，之后模拟端口已监听
  const h = makeHarness({ process: proc });
  await h.manager.open(); // spawn#1 → 创建面板
  assert.strictEqual(h.calls.spawnCount, 1);
  const panel = h.calls.panels[0];
  assert.strictEqual(panel.htmlSets.length, 1);
  panel._createdAt = 0; // 模拟面板创建早于最近一次服务启动（旧页面滞留）
  proc.isPortInUse = async () => true; // 第二次 open：端口已监听 + child 存活 → 无 reload 参数
  await h.manager.open();
  // stale 判断（serverStartedAt > _createdAt）触发强制重设 html，而非仅聚焦
  assert.strictEqual(panel.htmlSets.length, 2);
});

test('open reports port occupied by non-dsh program', async () => {
  const h = makeHarness({
    process: {
      isPortInUse: async () => true,
      httpProbe: async () => false,
      killDsh: async () => true,
    },
  });
  await h.manager.open();
  assert.strictEqual(h.calls.spawnCount, 0);
  assert.strictEqual(h.calls.panels.length, 0);
  assert.ok(h.calls.messages.some((x) => x.kind === 'error' && x.m.includes('in use')));
});

test('open opens when listening port is external dsh', async () => {
  const h = makeHarness({
    process: {
      isPortInUse: async () => true,
      httpProbe: async () => true,
      killDsh: async () => true,
    },
  });
  await h.manager.open();
  assert.strictEqual(h.calls.spawnCount, 0);
  assert.strictEqual(h.calls.panels.length, 1);
});

test('open fails fast when resolveDsh returns null', async () => {
  const h = makeHarness({
    detect: { resolveDsh: async () => null },
  });
  await h.manager.open();
  assert.strictEqual(h.calls.spawnCount, 0);
  assert.strictEqual(h.calls.panels.length, 0);
  assert.ok(h.calls.messages.some((x) => x.kind === 'error' && x.m.includes('dsh not found')));
});

test('open writes startup logs to output channel', async () => {
  const h = makeHarness();
  await h.manager.open();
  assert.ok(h.calls.channel);
  assert.ok(h.calls.channel.lines.length >= 2);
  assert.ok(h.calls.channel.lines.some((l) => l.includes('spawning')));
  assert.ok(h.calls.channel.lines.some((l) => l.includes('ready')));
});

test('dispose kills tracked child silently and clears it', async () => {
  const h = makeHarness();
  await h.manager.open();
  assert.strictEqual(h.calls.spawnCount, 1);
  await h.manager.dispose();
  assert.strictEqual(h.calls.killed, true);
  assert.strictEqual(h.manager.getChild(), null);
  // dispose 不弹任何消息
  assert.strictEqual(h.calls.messages.length, 0);
});

test('dispose is safe without child', async () => {
  const h = makeHarness();
  await h.manager.dispose();
  assert.strictEqual(h.calls.killed, null);
});

test('dispose does not kill child in window-keepalive mode', async () => {
  const h = makeHarness({ settings: { 'launch.mode': 'window-keepalive' } });
  await h.manager.open();
  assert.strictEqual(h.calls.spawnCount, 1);
  await h.manager.dispose();
  // 独立存活模式：dispose 不杀、不清引用
  assert.strictEqual(h.calls.killed, null);
  assert.ok(h.manager.getChild());
});

test('open writes pid file after successful spawn', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opendsh-pid-'));
  try {
    const h = makeHarness({ folders: [{ uri: { fsPath: dir } }] });
    await h.manager.open();
    const pidFile = path.join(dir, '.dsh', 'opendsh.pid');
    assert.ok(fs.existsSync(pidFile));
    assert.strictEqual(Number(fs.readFileSync(pidFile, 'utf8').trim()), 1); // fake child pid=1
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('stop kills residual server via pid file when child is gone', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opendsh-residual-'));
  try {
    fs.mkdirSync(path.join(dir, '.dsh'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.dsh', 'opendsh.pid'), '4242');
    const h = makeHarness({
      folders: [{ uri: { fsPath: dir } }],
      process: { isPortInUse: async () => true, httpProbe: async () => true, killDsh: async () => true },
    });
    await h.manager.stop();
    assert.strictEqual(h.calls.killedPid, 4242);
    assert.ok(h.calls.messages.some((x) => x.kind === 'info' && x.m.includes('stopped')));
    assert.ok(!fs.existsSync(path.join(dir, '.dsh', 'opendsh.pid')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('stop removes stale pid file when port not listening', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opendsh-stale-'));
  try {
    fs.mkdirSync(path.join(dir, '.dsh'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.dsh', 'opendsh.pid'), '4242');
    const h = makeHarness({ folders: [{ uri: { fsPath: dir } }] }); // 默认 isPortInUse false
    await h.manager.stop();
    assert.strictEqual(h.calls.killedPid, null);
    assert.ok(h.calls.messages.some((x) => x.kind === 'info' && x.m.includes('not running')));
    assert.ok(!fs.existsSync(path.join(dir, '.dsh', 'opendsh.pid')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('stop does not kill pid when port is foreign program', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opendsh-foreign-'));
  try {
    fs.mkdirSync(path.join(dir, '.dsh'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.dsh', 'opendsh.pid'), '4242');
    const h = makeHarness({
      folders: [{ uri: { fsPath: dir } }],
      process: { isPortInUse: async () => true, httpProbe: async () => false, killDsh: async () => true },
    });
    await h.manager.stop();
    assert.strictEqual(h.calls.killedPid, null);
    assert.ok(h.calls.messages.some((x) => x.kind === 'error' && x.m.includes('in use')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('dispose removes pid file when killing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opendsh-dispose-'));
  try {
    const h = makeHarness({ folders: [{ uri: { fsPath: dir } }] });
    await h.manager.open();
    assert.ok(fs.existsSync(path.join(dir, '.dsh', 'opendsh.pid')));
    await h.manager.dispose();
    assert.ok(!fs.existsSync(path.join(dir, '.dsh', 'opendsh.pid')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('open window-keepalive uses spawnStandalone and stop kills pseudo child', async () => {
  const h = makeHarness({ settings: { 'launch.mode': 'window-keepalive' } });
  await h.manager.open();
  assert.strictEqual(h.calls.spawnCount, 1);
  assert.ok(h.calls.spawned.standalone);
  // child 为伪对象 { pid: 9 }
  assert.strictEqual(h.manager.getChild().pid, 9);
  // stop 经 killDsh 杀（内部按 pid）
  await h.manager.stop();
  assert.strictEqual(h.calls.killed, true);
  assert.strictEqual(h.manager.getChild(), null);
});

test('open recreates panel after tab dispose and keeps server', async () => {
  const h = makeHarness();
  await h.manager.open();
  assert.strictEqual(h.calls.panels.length, 1);
  h.calls.panels[0]._dispose(); // 模拟关闭标签页：仅清引用
  assert.ok(h.manager.getChild()); // 服务不受影响
  await h.manager.open(); // 再次打开：复用 child，重建面板
  assert.strictEqual(h.calls.panels.length, 2);
});

test('open throttles rapid re-clicks within debounce window', async () => {
  const h = makeHarness({ debounceMs: 300 });
  await h.manager.open();
  await h.manager.open(); // 节流窗口内第二次触发被忽略
  assert.strictEqual(h.calls.spawnCount, 1);
  assert.strictEqual(h.calls.panels.length, 1);
});

test('open creates separate tabs when multipleTabs is set', async () => {
  const h = makeHarness({ settings: { multipleTabs: true } });
  await h.manager.open();
  await h.manager.open();
  // 每次 open 新建独立面板（共享同一服务，不重复 spawn）
  assert.strictEqual(h.calls.panels.length, 2);
  assert.strictEqual(h.calls.spawnCount, 1);
});

test('hidden-keepalive with patch enabled patches then starts standalone silent', async () => {
  const h = makeHarness({ settings: { 'launch.mode': 'hidden-keepalive', 'experimental.windowsHidePatch': true }, patchApplied: false });
  await h.manager.open();
  assert.strictEqual(h.calls.patchAppliedChecks, 1);
  assert.strictEqual(h.calls.terminals.length, 1);
  assert.strictEqual(h.calls.terminals[0].sent.length, 1);
  assert.strictEqual(h.calls.spawned.standalone, true);
  assert.strictEqual(h.calls.spawned.o.showWindow, false);
});

test('hidden-keepalive skips patch when already applied', async () => {
  const h = makeHarness({ settings: { 'launch.mode': 'hidden-keepalive', 'experimental.windowsHidePatch': true }, patchApplied: true });
  await h.manager.open();
  assert.strictEqual(h.calls.patchAppliedChecks, 1);
  assert.strictEqual(h.calls.terminals.length, 0);
  assert.strictEqual(h.calls.spawned.standalone, true);
  assert.strictEqual(h.calls.spawned.o.showWindow, false);
});

test('window-keepalive starts standalone with console window (showWindow=true)', async () => {
  const h = makeHarness({ settings: { 'launch.mode': 'window-keepalive' } });
  await h.manager.open();
  assert.strictEqual(h.calls.spawned.standalone, true);
  assert.strictEqual(h.calls.spawned.o.showWindow, true);
});

test('integrated runs DSH in terminal without child', async () => {
  const h = makeHarness({ settings: { 'launch.mode': 'integrated' } });
  await h.manager.open();
  assert.strictEqual(h.calls.terminals.length, 1);
  assert.strictEqual(h.calls.terminals[0].sent.length, 1);
  assert.strictEqual(h.calls.spawned, null);
  assert.strictEqual(h.manager.getChild(), null);
});

test('integrated stop disposes terminal', async () => {
  const h = makeHarness({ settings: { 'launch.mode': 'integrated' } });
  await h.manager.open();
  const t = h.calls.terminals[0];
  assert.strictEqual(t.disposed, false);
  await h.manager.stop();
  assert.strictEqual(t.disposed, true);
  assert.ok(h.calls.messages.some((x) => x.kind === 'info' && x.m.includes('stopped')));
});

test('dispose disposes terminal in integrated mode', async () => {
  const h = makeHarness({ settings: { 'launch.mode': 'integrated' } });
  await h.manager.open();
  const t = h.calls.terminals[0];
  await h.manager.dispose();
  assert.strictEqual(t.disposed, true);
});

test('dispose does not kill child in hidden-keepalive mode', async () => {
  const h = makeHarness({ settings: { 'launch.mode': 'hidden-keepalive', 'experimental.windowsHidePatch': true }, patchApplied: true });
  await h.manager.open();
  await h.manager.dispose();
  assert.strictEqual(h.calls.killed, null);
  assert.ok(h.manager.getChild());
});

test('window mode spawns visible desktop window via spawnDshVisible', async () => {
  const h = makeHarness({ settings: { 'launch.mode': 'window' } });
  await h.manager.open();
  assert.ok(h.calls.spawned.visible);
  assert.strictEqual(h.calls.spawnCount, 1);
});

test('hidden mode spawns silently via spawnDsh', async () => {
  const h = makeHarness({ settings: { 'launch.mode': 'hidden' } });
  await h.manager.open();
  assert.ok(h.calls.spawned);
  assert.strictEqual(h.calls.spawned.visible, undefined);
  assert.strictEqual(h.calls.spawnCount, 1);
});

test('hidden-keepalive without patch flag does not patch', async () => {
  const h = makeHarness({ settings: { 'launch.mode': 'hidden-keepalive' }, patchApplied: false });
  await h.manager.open();
  assert.strictEqual(h.calls.patchAppliedChecks, 0);
  assert.strictEqual(h.calls.terminals.length, 0);
  assert.strictEqual(h.calls.spawned.standalone, true);
  assert.strictEqual(h.calls.spawned.o.showWindow, false);
});
