/**
 * @intent
 * src/webview.js 的 node:test 单测：断言 buildWebviewHtml 的 CSP frame-src 放行（origin 去 query）、
 * iframe src 直接加载（cache-buster）、剪贴板权限，且无内联脚本/探测/hint 等待页，
 * 并验证输出随传入 url 变化（无硬编码地址字面量）。
 *
 * 验收条件：node --test 全绿。
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { buildWebviewHtml } = require('../src/webview');

test('buildWebviewHtml sets iframe src directly with cache-buster', () => {
  const html = buildWebviewHtml('http://127.0.0.1:3080', { ts: 123 });
  assert.ok(html.includes('src="http://127.0.0.1:3080?t=123"'));
});

test('buildWebviewHtml appends cache-buster with & when url already has query', () => {
  const html = buildWebviewHtml('http://127.0.0.1:3080/?focus=conversation.session', { ts: 456 });
  assert.ok(html.includes('src="http://127.0.0.1:3080/?focus=conversation.session&t=456"'));
});

test('buildWebviewHtml falls back to Date.now() when ts is not a positive integer', () => {
  const before = Date.now();
  const html = buildWebviewHtml('http://127.0.0.1:3080', { ts: -1 });
  const m = html.match(/src="http:\/\/127\.0\.0\.1:3080\?t=(\d+)"/);
  assert.ok(m);
  const ts = Number(m[1]);
  assert.ok(ts >= before && ts <= Date.now());
});

test('buildWebviewHtml allows target origin in CSP frame-src (query stripped)', () => {
  const html = buildWebviewHtml('http://127.0.0.1:3080/?focus=sidebar', { ts: 1 });
  // frame-src 用 origin（去 query/fragment），不是带 query 的完整 url
  assert.ok(html.includes('frame-src http://127.0.0.1:3080'));
  assert.ok(!html.includes('frame-src http://127.0.0.1:3080/?focus'));
});

test('buildWebviewHtml grants clipboard permissions to iframe', () => {
  const html = buildWebviewHtml('http://127.0.0.1:3080');
  assert.ok(html.includes('allow="clipboard-read; clipboard-write"'));
});

test('buildWebviewHtml has no inline script, no probe, no hint', () => {
  const html = buildWebviewHtml('http://127.0.0.1:3080', { ts: 123 });
  assert.ok(!html.includes('<script'));
  assert.ok(!html.includes('fetch('));
  assert.ok(!html.includes('dsh-hint'));
  assert.ok(!html.includes('script-src'));
  assert.ok(!html.includes('connect-src'));
});

test('buildWebviewHtml reflects a different url (no hardcoded address)', () => {
  const html = buildWebviewHtml('http://192.168.1.5:8080');
  assert.ok(html.includes('src="http://192.168.1.5:8080?t='));
  assert.ok(!html.includes('127.0.0.1'));
});
