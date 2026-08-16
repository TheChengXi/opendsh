/**
 * @intent
 * webview 承载 DSH Web UI 的 iframe 壳 html 生成器：单一纯函数 buildWebviewHtml(url, opts)，
 * 输出可安全嵌入 webview 的完整 html——CSP frame-src 显式放行目标源、iframe 铺满、剪贴板权限授予。
 *
 * 两个针对「DSH 服务重启后旧页面滞留」问题的加固：
 * ① 时间戳 cache-buster：每次生成壳都给 iframe URL 附加 ?t=<ts>（url 已有 query 时用 & 拼接），
 *    使 iframe 每次加载的都是从未请求过的新 URL——浏览器磁盘缓存无法回退旧 HTML
 *    （旧 HTML 携带上一进程注入的完整插件清单，而新进程插件表未就绪 → 全部 404 → Failed to load plugins 横幅）；
 * ② 健康探测：壳内脚本先 fetch 探测目标 server 是否已监听（no-cors + no-store），
 *    未就绪则指数退避重试（1.5s 起、封顶 10s、上限 60 次≈5 分钟），就绪后才给 iframe 赋值 src——
 *    覆盖 server 冷启动窗口期（加载 38 个插件需数秒到数十秒），不再出现「连接拒绝/半死」白屏。
 *
 * 边界：url 由调用方（manager 经 detect.buildUrl / detect.buildFocusUrls）组装并传入，本模块不校验、不拼接 host/port；
 * 不写死任何地址字面量；输入非字符串时按字符串处理；opts.ts 非正整数时回退 Date.now()；
 * 探测只区分「能连上 / 连不上」：server 监听后一切交给 iframe（HTTP 4xx/5xx 属 dsh 自身行为，壳不干预）；
 * 探测失败上限用尽后静默停止（hint 文案保留），不循环空转。
 *
 * 验收条件：
 * - 输出 html 含 CSP `frame-src <url>`、`connect-src <url>`、`script-src 'unsafe-inline'`
 * - iframe src 含时间戳 cache-buster；url 已有 query 时用 & 拼接
 * - opts.ts 注入时使用该值（可测），缺省回退 Date.now()
 * - 输出含 fetch 探测脚本（no-cors + no-store + 退避重试 + 上限）
 * - 输出含 allow="clipboard-read; clipboard-write"
 * - 不同 url 输出不同内容（无硬编码地址）
 */

'use strict';

function buildWebviewHtml(url, opts) {
  const src = String(url);
  const o = opts || {};
  const ts = Number.isInteger(o.ts) && o.ts > 0 ? o.ts : Date.now();
  // cache-buster：url 已有 query（focus 模式 ?focus=...）时用 & 拼接，否则用 ?
  const sep = src.includes('?') ? '&' : '?';
  const busted = `${src}${sep}t=${ts}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${src}; script-src 'unsafe-inline'; connect-src ${src}; style-src 'unsafe-inline';">
<style>html,body{margin:0;padding:0;height:100%;overflow:hidden;}iframe{width:100%;height:100%;border:0;display:block;}</style>
</head>
<body>
<div id="dsh-hint" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:13px sans-serif;color:#888;">正在等待 DSH 服务启动…</div>
<iframe id="dsh-frame" allow="clipboard-read; clipboard-write" title="DSH"></iframe>
<script>
(function () {
  var url = ${JSON.stringify(busted)};
  var frame = document.getElementById("dsh-frame");
  var hint = document.getElementById("dsh-hint");
  var attempts = 0;
  var MAX = 60;
  function nextDelay() {
    var d = Math.min(1500 * Math.pow(1.5, attempts), 10000);
    attempts += 1;
    return d;
  }
  function start() {
    fetch(url, { mode: "no-cors", cache: "no-store" }).then(function () {
      if (hint) hint.style.display = "none";
      frame.src = url;
    }).catch(function () {
      if (attempts >= MAX) return;
      setTimeout(start, nextDelay());
    });
  }
  start();
})();
</script>
</body>
</html>`;
}

module.exports = { buildWebviewHtml };
