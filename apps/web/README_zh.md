# 本机 Web 入口

[English version](README.md)

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
