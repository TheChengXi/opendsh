/**
 * @intent
 * webview 承载 DSH Web UI 的 iframe 壳 html 生成器：单一纯函数 buildWebviewHtml(url)，
 * 输出可安全嵌入 webview 的完整 html——CSP frame-src 显式放行目标源、iframe 铺满、剪贴板权限授予。
 *
 * 边界：url 由调用方（manager 经 detect.buildUrl）组装并传入，本模块不校验、不拼接 host/port；
 * 不写死任何地址字面量；输入非字符串时按字符串处理。
 *
 * 验收条件：
 * - 输出 html 含 CSP `frame-src <url>` 与 `<iframe src="<url>"`
 * - 输出含 allow="clipboard-read; clipboard-write"
 * - 不同 url 输出不同内容（无硬编码地址）
 */

'use strict';

function buildWebviewHtml(url) {
  const src = String(url);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${src}; style-src 'unsafe-inline';">
<style>html,body{margin:0;padding:0;height:100%;overflow:hidden;}iframe{width:100%;height:100%;border:0;display:block;}</style>
</head>
<body>
<iframe src="${src}" allow="clipboard-read; clipboard-write" title="DSH"></iframe>
</body>
</html>`;
}

module.exports = { buildWebviewHtml };
