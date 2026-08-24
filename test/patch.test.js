/**
 * @intent
 * patch.js 的 node:test 单测：定位、状态检测、命令与脚本生成、真实 node 执行补丁的幂等。
 *
 * 验收条件：node --test 全绿；用真实临时目录 + deps.dshRoot 注入定位（不 mock fs 内部）；
 * buildScript 经 node -e 执行对临时目标文件写补丁、重复执行幂等跳过；非 win32 返回空串/no-op。
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const patch = require('../src/patch');

const DETACHED_LINE = '  detached: platform !== "win32"\n';

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'patch-dsh-'));
  const lib = path.join(root, 'dsh-subprocess-local', 'lib');
  fs.mkdirSync(lib, { recursive: true });
  const target = path.join(lib, 'index.js');
  fs.writeFileSync(target, DETACHED_LINE, 'utf8');
  const dshRoot = path.join(root, '@deepseek-ai', 'dsh');
  return { root, target, dshRoot };
}

test('locateTarget derives dsh-subprocess-local target from dshRoot', () => {
  const { dshRoot, target } = makeRoot();
  assert.strictEqual(patch.locateTarget({ dshRoot, isWin: true }), target);
});

test('locateTarget returns null on non-win32', () => {
  assert.strictEqual(patch.locateTarget({ isWin: false }), null);
});

test('isApplied reflects patch state', () => {
  const { dshRoot, target } = makeRoot();
  assert.strictEqual(patch.isApplied({ dshRoot, isWin: true }), false);
  fs.writeFileSync(target, DETACHED_LINE + '  windowsHide: platform === "win32"\n', 'utf8');
  assert.strictEqual(patch.isApplied({ dshRoot, isWin: true }), true);
});

test('isApplied false when target missing', () => {
  const missingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'patch-missing-'));
  const dshRoot = path.join(missingRoot, '@deepseek-ai', 'dsh');
  assert.strictEqual(patch.isApplied({ dshRoot, isWin: true }), false);
});

test('buildScript embeds target and stays single-quote-free', () => {
  const { dshRoot } = makeRoot();
  const script = patch.buildScript({ dshRoot, isWin: true });
  assert.ok(script.includes('dsh-subprocess-local'));
  assert.ok(script.includes('index.js'));
  assert.ok(!script.includes("'"));
});

test('buildPatchCommand wraps script in node -e single quotes', () => {
  const { dshRoot } = makeRoot();
  const cmd = patch.buildPatchCommand({ dshRoot, isWin: true });
  assert.ok(cmd.startsWith("node -e '"));
  assert.ok(cmd.endsWith("'"));
});

test('non-win32 returns empty script/command and no-op', () => {
  assert.strictEqual(patch.buildScript({ isWin: false }), '');
  assert.strictEqual(patch.buildPatchCommand({ isWin: false }), '');
});

test('buildScript patches target then idempotently skips', () => {
  const { dshRoot, target } = makeRoot();
  const script = patch.buildScript({ dshRoot, isWin: true });
  const r1 = spawnSync(process.execPath, ['-e', script], { stdio: 'ignore' });
  assert.strictEqual(r1.error, undefined);
  assert.strictEqual(r1.status, 0);
  const patched = fs.readFileSync(target, 'utf8');
  assert.ok(patched.includes('windowsHide: platform === "win32"'));
  assert.ok(patched.includes('detached: platform !== "win32",'));
  const r2 = spawnSync(process.execPath, ['-e', script], { stdio: 'ignore' });
  assert.strictEqual(r2.status, 0);
  assert.strictEqual(fs.readFileSync(target, 'utf8'), patched);
});