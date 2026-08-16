/**
 * @intent
 * webview 承载 DSH Web UI 的 iframe 壳 html 生成器：单一纯函数 buildWebviewHtml(url, opts)，
 * 输出可安全嵌入 webview 的完整 html——CSP frame-src 放行目标源、iframe 铺满、剪贴板权限授予。
 * iframe 直接加载目标 URL（带时间戳 cache-buster，绕开浏览器缓存回退旧 HTML），无健康探测——
 * 服务就绪由 manager 的 waitForPort 保证（端口监听后才 openWebview 设置 html），
 * dsh 页面自身的 loading 状态负责呈现冷启动余量，壳不再重复兜底。
 *
 * 边界：url 由调用方（manager 经 detect.buildUrl / detect.buildFocusUrls）组装并传入，本模块不校验、不拼接 host/port；
 * 不写死任何地址字面量；输入非字符串时按字符串处理；opts.ts 非正整数时回退 Date.now()；
 * cache-buster 在 url 已有 query（focus 模式 ?focus=...）时用 & 拼接；CSP frame-src 用 origin（去 query/fragment）。
 *
 * 验收条件：
 * - 输出 html 含 CSP `frame-src <origin>`（origin 为 url 去掉 query/fragment 后的源）
 * - iframe src 含时间戳 cache-buster；url 已有 query 时用 & 拼接
 * - opts.ts 注入时使用该值（可测），缺省回退 Date.now()
 * - 输出含 allow="clipboard-read; clipboard-write"
 * - 无内联脚本、无 fetch 探测、无 hint 等待页
 * - 不同 url 输出不同内容（无硬编码地址）
 */

'use strict';

function buildWebviewHtml(url, opts) {
  const src = String(url);
  const o = opts || {};
  const ts = Number.isInteger(o.ts) && o.ts > 0 ? o.ts : Date.now();
  const origin = src.split(/[?#]/)[0]; // CSP frame-src 用不带 query 的源
  // cache-buster：url 已有 query（focus 模式 ?focus=...）时用 & 拼接，否则用 ?
  const sep = src.includes('?') ? '&' : '?';
  const busted = `${src}${sep}t=${ts}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${origin}; style-src 'unsafe-inline';">
<style>html,body{margin:0;padding:0;height:100%;overflow:hidden;}iframe{position:fixed;inset:0;width:100%;height:100%;border:0;display:block;}</style>
</head>
<body>
<iframe src="${busted}" allow="clipboard-read; clipboard-write" title="DSH"></iframe>
</body>
</html>`;
}

module.exports = { buildWebviewHtml };
