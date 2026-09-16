# Standalone Local Web Entry

PureTerm’s local Web entry runs Node on the user’s computer, and a browser connects to that same computer. The Node process manages SSH, SFTP, host information, and trusted host keys. Web and Desktop share `@pureterm/host`, `@pureterm/protocol`, `@pureterm/transport`, and `@pureterm/ui`; the runtime does not require Electron.

Install dependencies at the repository root and start the entry point. The command builds shared modules and the Web entry:

```powershell
npm ci
npm run start:web
```

When artifacts are already built, run ordinary Node directly:

```powershell
node apps/web/dist/main.js
```

Startup prints a tokenized URL to open in a browser on the same computer. The server binds only to a random available port on `127.0.0.1` by default and does not open a browser automatically. Press Ctrl+C to stop; closing the page releases the SSH sessions belonging to that page.

```powershell
node apps/web/dist/main.js --port 8787 --data-dir D:\PureTerm\web-data
node apps/web/dist/main.js --help
```

Set the data directory with `SSH_CORDIS_WEB_DATA_DIR`; `--data-dir` takes precedence. The default is `~/.ssh-cordis/web`, separate from Desktop’s existing data directory so that two independent processes never write the same host or credential files.

Web stores host information and trusted SSH host keys and never creates or reads `secrets.json`. Passwords, private-key passphrases, and private-key content selected in the browser exist only in the current page and must be supplied again after a refresh. The browser File API reads private-key content; the browser never exposes the complete local file path to the server. Desktop continues to use the native picker and operating-system encrypted credentials.

Every HTTP resource and WebSocket requires the startup token or a session cookie exchanged for it, and validates the local Host header and browser Origin. The entry point has no public listening option and no user accounts or tenant isolation.

Verification and real-browser checks:

```powershell
npm run build:web
node --test apps/web/tests/*.test.mjs
node apps/web/tests/smoke-browser.mjs
```

The last command uses a test Chromium window to access the standalone Node service. It covers a WebSocket terminal without preload, real SSH private-key authentication after browser key selection, terminal echo, and credential clearing after refresh. Electron is used only as the test browser; the Web service itself is an ordinary Node process.

<details>
<summary>中文版本</summary>

# 本机 Web 入口

在用户电脑运行 Node，浏览器连接同一台电脑上的 PureTerm。SSH、SFTP、主机信息和已信任主机密钥都由这个 Node 进程管理。Web 与 Desktop 共用 `@pureterm/host`、`@pureterm/protocol`、`@pureterm/transport` 和 `@pureterm/ui`，运行时无需 Electron。

从仓库根目录安装依赖后启动，命令会构建共享模块和 Web 入口：

```powershell
npm ci
npm run start:web
```

已构建时可以直接运行普通 Node：

```powershell
node apps/web/dist/main.js
```

启动会打印带临时 token 的地址，在本机浏览器中打开即可。默认仅监听 `127.0.0.1` 的随机可用端口，不自动打开浏览器。按 Ctrl+C 停止；关闭浏览器页面会释放该页面的 SSH 会话。

```powershell
node apps/web/dist/main.js --port 8787 --data-dir D:\PureTerm\web-data
node apps/web/dist/main.js --help
```

也可以使用 `SSH_CORDIS_WEB_DATA_DIR` 环境变量设置数据目录，`--data-dir` 优先。默认目录为 `~/.ssh-cordis/web`，与 Desktop 的既有数据目录分开，避免两个独立进程同时写同一份主机与凭据文件。

Web 保存主机信息和已信任的 SSH 主机密钥，不创建或读取 `secrets.json`。密码、私钥口令和浏览器选中的私钥只在当前页面使用，刷新后需要重新输入或选择。私钥通过浏览器文件选择器读取内容；浏览器不会向服务暴露本机文件的完整路径。Desktop 继续使用原生文件选择器和系统加密凭据。

所有 HTTP 资源与 WebSocket 都要求启动 token 或由它换取的会话 cookie，并验证本机 Host 与浏览器 Origin。入口不提供公开监听参数，也不包含用户账户或租户隔离。

验证入口与真实浏览器：

```powershell
npm run build:web
node --test apps/web/tests/*.test.mjs
node apps/web/tests/smoke-browser.mjs
```

最后一项使用测试用 Chromium 窗口访问独立 Node 服务，覆盖无 preload 的 WebSocket 终端、浏览器选钥后的真实 SSH 私钥认证与终端回显，以及刷新后清空凭据。Electron 只用于这个浏览器测试，Web 服务本身不依赖 Electron。

</details>
