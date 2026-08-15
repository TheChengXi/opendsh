/**
 * @intent
 * src/webview.js 的 node:test 单测：断言 buildWebviewHtml 的 CSP 放行、iframe 地址与剪贴板权限，
 * 并验证输出随传入 url 变化（无硬编码地址字面量）。
 *
 * 验收条件：node --test 全绿。
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { buildWebviewHtml } = require('../src/webview');

test('buildWebviewHtml embeds url as iframe src', () => {
  const html = buildWebviewHtml('http://127.0.0.1:3080');
  assert.ok(html.includes('src="http://127.0.0.1:3080"'));
});

test('buildWebviewHtml allows the target origin in CSP frame-src', () => {
  const html = buildWebviewHtml('http://127.0.0.1:3080');
  assert.ok(html.includes('frame-src http://127.0.0.1:3080'));
});

test('buildWebviewHtml grants clipboard permissions to iframe', () => {
  const html = buildWebviewHtml('http://127.0.0.1:3080');
  assert.ok(html.includes('allow="clipboard-read; clipboard-write"'));
});

test('buildWebviewHtml reflects a different url (no hardcoded address)', () => {
  const html = buildWebviewHtml('http://192.168.1.5:8080');
  assert.ok(html.includes('http://192.168.1.5:8080'));
  assert.ok(!html.includes('127.0.0.1'));
});
