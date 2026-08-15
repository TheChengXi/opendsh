/**
 * @intent
 * detect.js 的 node:test 单测，覆盖设置回退、工作区解析、patch 发现、dsh 定位优先级（dshPath > npm 全局 > PATH，落空 null）、buildUrl。
 *
 * 验收条件：node --test 全绿，覆盖 resolveConfig / resolveWorkspace / resolvePatches / resolveNpmGlobal / resolveDsh / buildUrl。
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
    port: 3080,
    dshPath: '',
    patchFile: '',
    detached: false,
    showWindow: false,
    openWith: 'tab',
    multipleTabs: false,
  });
  assert.deepStrictEqual(detect.resolveConfig({ host: '', port: 'abc', dshPath: '  ', patchFile: 5, detached: 'yes', showWindow: 1, openWith: 'bogus' }), {
    host: '127.0.0.1',
    port: 3080,
    dshPath: '',
    patchFile: '',
    detached: false,
    showWindow: false,
    openWith: 'tab',
    multipleTabs: false,
  });
  assert.strictEqual(detect.resolveConfig({ host: 'localhost', port: '8080' }).port, 8080);
  assert.strictEqual(detect.resolveConfig({ port: 0 }).port, 3080);
  assert.strictEqual(detect.resolveConfig({ port: 70000 }).port, 3080);
});

test('resolveConfig resolves openWith with fallback to tab', () => {
  assert.strictEqual(detect.resolveConfig({ openWith: 'simpleBrowser' }).openWith, 'simpleBrowser');
  assert.strictEqual(detect.resolveConfig({ openWith: 'systemBrowser' }).openWith, 'systemBrowser');
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

test('resolveDsh priority = dshPath > PATH > null (no npx fallback)', async () => {
  assert.deepStrictEqual(
    await detect.resolveDsh({ dshPath: 'C:/my/dsh.cmd' }, { pathEnv: '', isWin: true }),
    { command: 'C:/my/dsh.cmd', prefixArgs: [] }
  );

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-resolve-'));
  try {
    fs.writeFileSync(path.join(dir, 'dsh.cmd'), '');
    // env.APPDATA 指向不存在的目录，确保 npm 全局分支 miss，走 PATH
    const r = await detect.resolveDsh(
      { dshPath: '' },
      { isWin: true, env: { APPDATA: path.join(dir, 'no-appdata') }, nodePath: 'node.exe', pathEnv: dir }
    );
    assert.strictEqual(r.command, path.join(dir, 'dsh.cmd'));
    assert.deepStrictEqual(r.prefixArgs, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  assert.strictEqual(await detect.resolveDsh({ dshPath: '' }, { pathEnv: '', isWin: false }), null);
});

test('resolveNpmGlobal finds global install via npm prefix -g', async () => {
  const d = freshDetect();
  const prefix = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-prefix-'));
  try {
    const bin = path.join(prefix, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    fs.writeFileSync(bin, '');
    const r = await d.resolveNpmGlobal({
      isWin: true,
      env: {},
      nodePath: 'node.exe',
      execFile: (cmd, args, cb) => cb(null, prefix),
    });
    assert.deepStrictEqual(r, { command: 'node.exe', prefixArgs: [bin] });
  } finally {
    fs.rmSync(prefix, { recursive: true, force: true });
  }
});

test('resolveNpmGlobal caches npm prefix and does not re-spawn', async () => {
  const d = freshDetect();
  const prefix = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-prefix2-'));
  try {
    const bin = path.join(prefix, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    fs.writeFileSync(bin, '');
    let calls = 0;
    const execFile = (cmd, args, cb) => {
      calls++;
      cb(null, prefix);
    };
    await d.resolveNpmGlobal({ isWin: false, env: {}, nodePath: 'node', execFile });
    const second = await d.resolveNpmGlobal({ isWin: false, env: {}, nodePath: 'node', execFile });
    assert.strictEqual(calls, 1);
    assert.deepStrictEqual(second, { command: 'node', prefixArgs: [bin] });
  } finally {
    fs.rmSync(prefix, { recursive: true, force: true });
  }
});

test('resolveNpmGlobal APPDATA fast path hits without spawning', async () => {
  const d = freshDetect();
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-appdata-'));
  try {
    const bin = path.join(appData, 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    fs.writeFileSync(bin, '');
    const r = await d.resolveNpmGlobal({
      isWin: true,
      env: { APPDATA: appData },
      nodePath: 'node.exe',
      execFile: () => {
        throw new Error('should not spawn npm prefix');
      },
    });
    assert.deepStrictEqual(r, { command: 'node.exe', prefixArgs: [bin] });
  } finally {
    fs.rmSync(appData, { recursive: true, force: true });
  }
});

test('resolveNpmGlobal returns null when global install absent', async () => {
  const d = freshDetect();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-noglob-'));
  try {
    const r = await d.resolveNpmGlobal({
      isWin: true,
      env: { APPDATA: dir },
      nodePath: 'node.exe',
      execFile: (cmd, args, cb) => cb(null, dir),
    });
    assert.strictEqual(r, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveDsh prefers npm global over PATH', async () => {
  const d = freshDetect();
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-resolve-appdata-'));
  const pathDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-resolve-path-'));
  try {
    const bin = path.join(appData, 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    fs.writeFileSync(bin, '');
    fs.writeFileSync(path.join(pathDir, 'dsh.cmd'), '');
    const r = await d.resolveDsh(
      { dshPath: '' },
      { isWin: true, env: { APPDATA: appData }, nodePath: 'node.exe', pathEnv: pathDir }
    );
    assert.deepStrictEqual(r, { command: 'node.exe', prefixArgs: [bin] });
  } finally {
    fs.rmSync(appData, { recursive: true, force: true });
    fs.rmSync(pathDir, { recursive: true, force: true });
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

test('resolveNpmGlobal uses resolved node path not execPath', async () => {
  const d = freshDetect();
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-appdata-node-'));
  const pathDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-node-path-'));
  try {
    const bin = path.join(appData, 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    fs.writeFileSync(bin, '');
    fs.writeFileSync(path.join(pathDir, 'node.exe'), '');
    const r = await d.resolveNpmGlobal({
      isWin: true,
      env: { APPDATA: appData },
      execPath: 'C:/Program Files/Microsoft VS Code/Code.exe',
      pathEnv: pathDir,
    });
    // command 必须是 PATH 解析出的 node.exe，而不是 Code.exe
    assert.strictEqual(r.command, path.join(pathDir, 'node.exe'));
    assert.deepStrictEqual(r.prefixArgs, [bin]);
  } finally {
    fs.rmSync(appData, { recursive: true, force: true });
    fs.rmSync(pathDir, { recursive: true, force: true });
  }
});

test('resolveConfig passes through detached/showWindow booleans', () => {
  const r = detect.resolveConfig({ detached: true, showWindow: true });
  assert.strictEqual(r.detached, true);
  assert.strictEqual(r.showWindow, true);
  assert.strictEqual(detect.resolveConfig({ multipleTabs: true }).multipleTabs, true);
  assert.strictEqual(detect.resolveConfig({}).multipleTabs, false);
});
