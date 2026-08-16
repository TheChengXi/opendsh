/**
 * @intent
 * src/webview.js 的 node:test 单测：断言 buildWebviewHtml 的 CSP 放行、iframe 地址与剪贴板权限，
 * 并验证输出随传入 url 变化（无硬编码地址字面量）；新增 cache-buster 时间戳、query 拼接、
 * connect-src 放行与健康探测脚本的断言（server 重启后旧页面滞留的加固行为）。
 *
 * 验收条件：node --test 全绿。
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { buildWebviewHtml } = require('../src/webview');

test('buildWebviewHtml embeds url as iframe src with cache-buster', () => {
  const html = buildWebviewHtml('http://127.0.0.1:3080', { ts: 123 });
  // iframe src 由壳内探测脚本在 server 就绪后赋值：脚本内 url 字面量 = busted URL
  assert.ok(html.includes('"http://127.0.0.1:3080?t=123"'));
  assert.ok(html.includes('frame.src = url;'));
});

test('buildWebviewHtml appends cache-buster with & when url already has query', () => {
  const html = buildWebviewHtml('http://127.0.0.1:3080/?focus=conversation', { ts: 456 });
  assert.ok(html.includes('"http://127.0.0.1:3080/?focus=conversation&t=456"'));
});

test('buildWebviewHtml falls back to Date.now() when ts is not a positive integer', () => {
  const before = Date.now();
  const html = buildWebviewHtml('http://127.0.0.1:3080', { ts: -1 });
  const m = html.match(/"http:\/\/127\.0\.0\.1:3080\?t=(\d+)"/);
  assert.ok(m);
  const ts = Number(m[1]);
  assert.ok(ts >= before && ts <= Date.now());
});

test('buildWebviewHtml allows the target origin in CSP frame-src', () => {
  const html = buildWebviewHtml('http://127.0.0.1:3080');
  assert.ok(html.includes('frame-src http://127.0.0.1:3080'));
  // frame-src 放行原始 url（不带 cache-buster）
  assert.ok(!html.includes('frame-src http://127.0.0.1:3080?'));
});

test('buildWebviewHtml allows fetch probe via CSP connect-src', () => {
  const html = buildWebviewHtml('http://127.0.0.1:3080');
  assert.ok(html.includes('connect-src http://127.0.0.1:3080'));
});

test('buildWebviewHtml allows inline bootstrap script via CSP script-src', () => {
  const html = buildWebviewHtml('http://127.0.0.1:3080');
  assert.ok(html.includes("script-src 'unsafe-inline'"));
});

test('buildWebviewHtml grants clipboard permissions to iframe', () => {
  const html = buildWebviewHtml('http://127.0.0.1:3080');
  assert.ok(html.includes('allow="clipboard-read; clipboard-write"'));
});

test('buildWebviewHtml embeds health-probe bootstrap script', () => {
  const html = buildWebviewHtml('http://127.0.0.1:3080', { ts: 123 });
  // 探测：no-cors + no-store 的 fetch，指向带 cache-buster 的同一 url
  assert.ok(html.includes('fetch('));
  assert.ok(html.includes('no-cors'));
  assert.ok(html.includes('no-store'));
  assert.ok(html.includes('http://127.0.0.1:3080?t=123'));
  // 退避重试与上限
  assert.ok(html.includes('setTimeout'));
  assert.ok(html.includes('MAX = 60'));
  // iframe 初始不带 src，由探测成功后赋值
  assert.ok(html.includes('<iframe id="dsh-frame"'));
});

test('buildWebviewHtml reflects a different url (no hardcoded address)', () => {
  const html = buildWebviewHtml('http://192.168.1.5:8080');
  assert.ok(html.includes('http://192.168.1.5:8080'));
  assert.ok(!html.includes('127.0.0.1'));
});
