/**
 * @intent
 * detect.js 的 node:test 单测，覆盖设置回退、工作区解析、patch 发现、dsh 定位优先级（dshPath > npm 全局读 bin，Windows 无 PATH 兜底，落空 null）、
 * buildUrl、launchMode 枚举、windowsHidePatch 回退。
 *
 * 验收条件：node --test 全绿；launchMode 仅 5 个合法值、其余（含旧 showWindow/detached/experimentalSilentKeepAlive 遗留）回退 integrated；
 * windowsHidePatch 非 true 回退 false；openWith 合法值为 tab/simpleBrowser/systemBrowser（其余回退 tab）；
 * resolveDsh 优先 dshPath，其次 npm 全局（node + bin.js 绕 .cmd shim）；Windows 找不到 npm 全局直接 null，不 PATH 兜底；POSIX 走 PATH shim；
 * resolveNpmGlobal 按 package.json bin 字段定位真实入口，非 Windows / 无 package.json / 无 bin 返回 null。
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const detect = require('../src/detect');

// 模块级 npm prefix 缓存跨测试共享，缓存相关测试用全新模块实例隔离
function freshDetect() {
  delete require.cache[require.resolve('../src/detect')];
  return require('../src/detect');
}

test('resolveConfig falls back to defaults on missing/invalid values', () => {
  assert.deepStrictEqual(detect.resolveConfig(undefined), {
    host: '127.0.0.1',
    webviewHost: '127.0.0.1',
    port: 3080,
    dshPath: '',
    patchFile: '',
    launchMode: 'integrated',
    windowsHidePatch: false,
    openWith: 'tab',
    multipleTabs: false,
  });
  assert.deepStrictEqual(detect.resolveConfig({ host: '', port: 'abc', dshPath: '  ', patchFile: 5, launchMode: 'bogus', windowsHidePatch: 'yes', openWith: 'bogus' }), {
    host: '127.0.0.1',
    webviewHost: '127.0.0.1',
    port: 3080,
    dshPath: '',
    patchFile: '',
    launchMode: 'integrated',
    windowsHidePatch: false,
    openWith: 'tab',
    multipleTabs: false,
  });
  assert.strictEqual(detect.resolveConfig({ host: 'localhost', port: '8080' }).port, 8080);
  assert.strictEqual(detect.resolveConfig({ port: 0 }).port, 3080);
  assert.strictEqual(detect.resolveConfig({ port: 70000 }).port, 3080);
});

test('resolveConfig separates webviewHost from host', () => {
  const c = detect.resolveConfig({ host: '127.0.0.1', webviewHost: 'dsh.local', port: 3081 });
  assert.strictEqual(c.host, '127.0.0.1');
  assert.strictEqual(c.webviewHost, 'dsh.local');
  // 未设置 webviewHost 时回退 host
  assert.strictEqual(detect.resolveConfig({ host: 'localhost' }).webviewHost, 'localhost');
});

test('resolveConfig resolves openWith with fallback to tab', () => {
  assert.strictEqual(detect.resolveConfig({ openWith: 'simpleBrowser' }).openWith, 'simpleBrowser');
  assert.strictEqual(detect.resolveConfig({ openWith: 'systemBrowser' }).openWith, 'systemBrowser');
  assert.strictEqual(detect.resolveConfig({ openWith: 'focus' }).openWith, 'tab'); // focus 已移除，回退 tab
  assert.strictEqual(detect.resolveConfig({ openWith: 'tab' }).openWith, 'tab');
  assert.strictEqual(detect.resolveConfig({}).openWith, 'tab');
});

test('resolveWorkspace returns first fsPath or null', () => {
  assert.strictEqual(detect.resolveWorkspace(undefined), null);
  assert.strictEqual(detect.resolveWorkspace([]), null);
  assert.strictEqual(detect.resolveWorkspace([{ uri: { fsPath: 'C:/proj' } }]), 'C:/proj');
});

test('resolvePatches returns explicit patchFile first, else auto-discovers sorted', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-test-'));
  try {
    fs.mkdirSync(path.join(dir, '.dsh'));
    fs.writeFileSync(path.join(dir, '.dsh', 'b.patch.yml'), '');
    fs.writeFileSync(path.join(dir, '.dsh', 'a.patch.yml'), '');
    fs.writeFileSync(path.join(dir, '.dsh', 'note.md'), '');

    const auto = detect.resolvePatches({ patchFile: '' }, dir);
    assert.strictEqual(auto.length, 2);
    assert.ok(auto[0].endsWith(path.join('.dsh', 'a.patch.yml')));
    assert.ok(auto[1].endsWith(path.join('.dsh', 'b.patch.yml')));

    const explicit = detect.resolvePatches({ patchFile: '.dsh/x.patch.yml' }, dir);
    assert.strictEqual(explicit.length, 1);
    assert.ok(explicit[0].endsWith(path.join('.dsh', 'x.patch.yml')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('resolvePatches returns [] when no .dsh dir', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-none-'));
  try {
    assert.deepStrictEqual(detect.resolvePatches({ patchFile: '' }, dir), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('findOnPath finds dsh.cmd across PATH (win semantics)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-path-'));
  try {
    fs.writeFileSync(path.join(dir, 'dsh.cmd'), '');
    assert.strictEqual(detect.findOnPath('dsh', dir, true), path.join(dir, 'dsh.cmd'));
    assert.strictEqual(detect.findOnPath('dsh', '', true), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveDsh priority = dshPath > npm global; Windows null when npm global misses (no PATH fallback)', async () => {
  assert.deepStrictEqual(
    await detect.resolveDsh({ dshPath: 'C:/my/dsh.cmd' }, { pathEnv: '', isWin: true }),
    { command: 'C:/my/dsh.cmd', prefixArgs: [] }
  );

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-resolve-'));
  try {
    fs.writeFileSync(path.join(dir, 'dsh.cmd'), '');
    // Windows：npm 全局 miss 时直接 null，绝不 fallback 到 PATH 的 .cmd shim（会弹控制台窗口）
    const r = await detect.resolveDsh(
      { dshPath: '' },
      { isWin: true, env: { APPDATA: path.join(dir, 'no-appdata') }, nodePath: 'node.exe', pathEnv: dir }
    );
    assert.strictEqual(r, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  assert.strictEqual(await detect.resolveDsh({ dshPath: '' }, { pathEnv: '', isWin: false }), null);
});

test('resolveNpmGlobal locates entry via package.json bin string', () => {
  const d = freshDetect();
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-bin-'));
  try {
    const pkgDir = path.join(appData, 'npm', 'node_modules', '@deepseek-ai', 'dsh');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ bin: 'lib/cli.js' }));
    const entry = path.join(pkgDir, 'lib', 'cli.js');
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    fs.writeFileSync(entry, '');
    const r = d.resolveNpmGlobal({ isWin: true, env: { APPDATA: appData }, nodePath: 'node.exe' });
    assert.deepStrictEqual(r, { command: 'node.exe', prefixArgs: [entry] });
  } finally {
    fs.rmSync(appData, { recursive: true, force: true });
  }
});

test('resolveNpmGlobal resolves object bin.dsh', () => {
  const d = freshDetect();
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-binobj-'));
  try {
    const pkgDir = path.join(appData, 'npm', 'node_modules', '@deepseek-ai', 'dsh');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ bin: { dsh: 'dist/cli.js' } }));
    const entry = path.join(pkgDir, 'dist', 'cli.js');
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    fs.writeFileSync(entry, '');
    const r = d.resolveNpmGlobal({ isWin: true, env: { APPDATA: appData }, nodePath: 'node.exe' });
    assert.deepStrictEqual(r, { command: 'node.exe', prefixArgs: [entry] });
  } finally {
    fs.rmSync(appData, { recursive: true, force: true });
  }
});

test('resolveNpmGlobal returns null when package.json / bin / win missing', () => {
  const d = freshDetect();
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-nobin-'));
  try {
    const pkgDir = path.join(appData, 'npm', 'node_modules', '@deepseek-ai', 'dsh');
    fs.mkdirSync(pkgDir, { recursive: true });
    // 无 package.json
    assert.strictEqual(d.resolveNpmGlobal({ isWin: true, env: { APPDATA: appData }, nodePath: 'node.exe' }), null);
    // 有 package.json 但无 bin
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: 'dsh' }));
    assert.strictEqual(d.resolveNpmGlobal({ isWin: true, env: { APPDATA: appData }, nodePath: 'node.exe' }), null);
    // 非 Windows
    assert.strictEqual(d.resolveNpmGlobal({ isWin: false, env: { APPDATA: appData }, nodePath: 'node' }), null);
  } finally {
    fs.rmSync(appData, { recursive: true, force: true });
  }
});

test('resolveDsh prefers npm global over PATH shim', async () => {
  const d = freshDetect();
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-resolve-appdata-'));
  const pathDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-resolve-path-'));
  try {
    const pkgDir = path.join(appData, 'npm', 'node_modules', '@deepseek-ai', 'dsh');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ bin: 'lib/bin.js' }));
    const entry = path.join(pkgDir, 'lib', 'bin.js');
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    fs.writeFileSync(entry, '');
    // npm shim 也存在于 PATH：Windows 上仍应优先 node + bin.js（绕 .cmd 弹窗）
    fs.writeFileSync(path.join(pathDir, 'dsh.cmd'), '');
    const r = await d.resolveDsh(
      { dshPath: '' },
      { isWin: true, env: { APPDATA: appData }, nodePath: 'node.exe', pathEnv: pathDir }
    );
    assert.deepStrictEqual(r, { command: 'node.exe', prefixArgs: [entry] });
  } finally {
    fs.rmSync(appData, { recursive: true, force: true });
    fs.rmSync(pathDir, { recursive: true, force: true });
  }
});

test('resolveDsh uses npm global entry when PATH misses', async () => {
  const d = freshDetect();
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-resolve-noglob-'));
  try {
    const pkgDir = path.join(appData, 'npm', 'node_modules', '@deepseek-ai', 'dsh');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ bin: 'lib/bin.js' }));
    const entry = path.join(pkgDir, 'lib', 'bin.js');
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    fs.writeFileSync(entry, '');
    const r = await d.resolveDsh(
      { dshPath: '' },
      { isWin: true, env: { APPDATA: appData }, nodePath: 'node.exe', pathEnv: '' }
    );
    assert.deepStrictEqual(r, { command: 'node.exe', prefixArgs: [entry] });
  } finally {
    fs.rmSync(appData, { recursive: true, force: true });
  }
});

test('buildUrl assembles host:port', () => {
  assert.strictEqual(detect.buildUrl('localhost', 8080), 'http://localhost:8080');
  assert.strictEqual(detect.buildUrl('0.0.0.0', 4000), 'http://0.0.0.0:4000');
});

test('resolveNode reuses execPath when it is node itself', () => {
  const d = freshDetect();
  assert.strictEqual(d.resolveNode({ execPath: 'D:/node/node.exe', pathEnv: '', isWin: true }), 'D:/node/node.exe');
  assert.strictEqual(d.resolveNode({ execPath: '/usr/bin/node', pathEnv: '', isWin: false }), '/usr/bin/node');
});

test('resolveNode falls back to PATH node when execPath is not node (VS Code host)', () => {
  const d = freshDetect();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-node-'));
  try {
    fs.writeFileSync(path.join(dir, 'node.exe'), '');
    const r = d.resolveNode({
      execPath: 'C:/Program Files/Microsoft VS Code/Code.exe',
      pathEnv: dir,
      isWin: true,
      env: {},
    });
    assert.strictEqual(r, path.join(dir, 'node.exe'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveNode falls back to Program Files nodejs when PATH misses', () => {
  const d = freshDetect();
  const pf = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-pf-'));
  try {
    fs.mkdirSync(path.join(pf, 'nodejs'));
    fs.writeFileSync(path.join(pf, 'nodejs', 'node.exe'), '');
    const r = d.resolveNode({
      execPath: 'C:/Code.exe',
      pathEnv: '',
      isWin: true,
      env: { ProgramFiles: pf },
    });
    assert.strictEqual(r, path.join(pf, 'nodejs', 'node.exe'));
  } finally {
    fs.rmSync(pf, { recursive: true, force: true });
  }
});

test('resolveNode returns command name node as last resort', () => {
  const d = freshDetect();
  const r = d.resolveNode({
    execPath: 'C:/Code.exe',
    pathEnv: '',
    isWin: true,
    env: {},
  });
  assert.strictEqual(r, 'node');
});

test('resolveNpmGlobal uses resolved node path not execPath', () => {
  const d = freshDetect();
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-appdata-node-'));
  const pathDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-node-path-'));
  try {
    const pkgDir = path.join(appData, 'npm', 'node_modules', '@deepseek-ai', 'dsh');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ bin: 'lib/bin.js' }));
    const entry = path.join(pkgDir, 'lib', 'bin.js');
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    fs.writeFileSync(entry, '');
    fs.writeFileSync(path.join(pathDir, 'node.exe'), '');
    const r = d.resolveNpmGlobal({
      isWin: true,
      env: { APPDATA: appData },
      execPath: 'C:/Program Files/Microsoft VS Code/Code.exe',
      pathEnv: pathDir,
    });
    // command 必须是 PATH 解析出的 node.exe，而不是 Code.exe
    assert.strictEqual(r.command, path.join(pathDir, 'node.exe'));
    assert.deepStrictEqual(r.prefixArgs, [entry]);
  } finally {
    fs.rmSync(appData, { recursive: true, force: true });
    fs.rmSync(pathDir, { recursive: true, force: true });
  }
});

test('resolveConfig resolves launchMode enum and windowsHidePatch', () => {
  for (const m of ['integrated', 'window', 'window-keepalive', 'hidden-keepalive']) {
    assert.strictEqual(detect.resolveConfig({ launchMode: m }).launchMode, m);
  }
  assert.strictEqual(detect.resolveConfig({}).launchMode, 'integrated');
  assert.strictEqual(detect.resolveConfig({ launchMode: 'bogus' }).launchMode, 'integrated');
  // hidden 静默非 keepalive 模式已下线：非法一律回退默认 integrated
  assert.strictEqual(detect.resolveConfig({ launchMode: 'hidden' }).launchMode, 'integrated');
  // 旧 showWindow 值（terminal/output）与旧键遗留一律回退默认 integrated
  assert.strictEqual(detect.resolveConfig({ launchMode: 'terminal' }).launchMode, 'integrated');
  assert.strictEqual(detect.resolveConfig({ launchMode: 'output' }).launchMode, 'integrated');
  assert.strictEqual(detect.resolveConfig({ windowsHidePatch: true }).windowsHidePatch, true);
  assert.strictEqual(detect.resolveConfig({ windowsHidePatch: 'yes' }).windowsHidePatch, false);
  assert.strictEqual(detect.resolveConfig({}).windowsHidePatch, false);
  assert.strictEqual(detect.resolveConfig({ multipleTabs: true }).multipleTabs, true);
});
