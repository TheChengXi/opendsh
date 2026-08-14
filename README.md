# Open DSH

Tiny, zero-dependency VS Code extension that opens the DeepSeek Harness Web UI
inside VS Code's built-in Simple Browser (falling back to your system browser),
and can start / stop the `dsh web` server for the current workspace.

## Features

- `DSH: Open DSH` — open the Web UI; if the server isn't running for the current
  workspace, it auto-starts it first (auto-detecting the workspace folder, its
  `.dsh/*.patch.yml` files, and the `dsh` executable). If the port is already
  listening, it just opens.
- `DSH: Stop DSH` — stop the server this extension started.
- Deep link `vscode://TheChengXi.opendsh/open` opens the UI from outside VS Code (same
  auto-start behavior).

## Prerequisites

- Node.js (to run the `dsh` CLI).
- `dsh` installed globally: `npm i -g @deepseek-ai/dsh`, or set `opendsh.dshPath`.
  If neither is found, the extension falls back to `npx @deepseek-ai/dsh`.

## Settings

- `opendsh.host` (default `127.0.0.1`) — host the DSH web server binds to.
- `opendsh.port` (default `3080`) — port the DSH web server listens on.
- `opendsh.dshPath` (default `""`) — path to `dsh`; empty means auto (PATH, then npx).
- `opendsh.patchFile` (default `""`) — MCP patch file; empty means auto-discover
  `.dsh/*.patch.yml` in the workspace root.

## Install

Build a `.vsix` with `npx @vscode/vsce package`, then install it, or copy this
folder into your extensions directory as `TheChengXi.opendsh-0.0.1` and reload the window.

## Test

```
node --test
```

To open from a terminal: `start "" "vscode://TheChengXi.opendsh/open"` (Windows) or
`open "vscode://TheChengXi.opendsh/open"` (macOS).
