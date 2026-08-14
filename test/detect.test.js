/**
 * @intent
 * detect.js 的 node:test 单测，覆盖设置回退、工作区解析、patch 发现、dsh 定位优先级、buildUrl。
 *
 * 验收条件：node --test 全绿，覆盖 resolveConfig / resolveWorkspace / resolvePatches / resolveDsh / buildUrl。
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const detect = require('../src/detect');

test('resolveConfig falls back to defaults on missing/invalid values', () => {
  assert.deepStrictEqual(detect.resolveConfig(undefined), {
    host: '127.0.0.1',
    port: 3080,
    dshPath: '',
    patchFile: '',
  });
  assert.deepStrictEqual(detect.resolveConfig({ host: '', port: 'abc', dshPath: '  ', patchFile: 5 }), {
    host: '127.0.0.1',
    port: 3080,
    dshPath: '',
    patchFile: '',
  });
  assert.strictEqual(detect.resolveConfig({ host: 'localhost', port: '8080' }).port, 8080);
  assert.strictEqual(detect.resolveConfig({ port: 0 }).port, 3080);
  assert.strictEqual(detect.resolveConfig({ port: 70000 }).port, 3080);
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

test('resolveDsh priority = dshPath > PATH > npx', () => {
  assert.deepStrictEqual(
    detect.resolveDsh({ dshPath: 'C:/my/dsh.cmd' }, { pathEnv: '', isWin: true }),
    { command: 'C:/my/dsh.cmd', prefixArgs: [] }
  );

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-resolve-'));
  try {
    fs.writeFileSync(path.join(dir, 'dsh.cmd'), '');
    const r = detect.resolveDsh({ dshPath: '' }, { pathEnv: dir, isWin: true });
    assert.strictEqual(r.command, path.join(dir, 'dsh.cmd'));
    assert.deepStrictEqual(r.prefixArgs, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  assert.deepStrictEqual(
    detect.resolveDsh({ dshPath: '' }, { pathEnv: '', isWin: false }),
    { command: 'npx', prefixArgs: ['@deepseek-ai/dsh'] }
  );
});

test('buildUrl assembles host:port', () => {
  assert.strictEqual(detect.buildUrl('localhost', 8080), 'http://localhost:8080');
  assert.strictEqual(detect.buildUrl('0.0.0.0', 4000), 'http://0.0.0.0:4000');
});
