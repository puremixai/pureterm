# 本机 Web 入口

[English version](README.md)

在用户电脑运行 Node，浏览器连接同一台电脑上的 PureTerm。SSH、SFTP、主机信息和已信任主机密钥都由这个 Node 进程管理。Web 与 Desktop 使用相同的 `@pureterm/transport/web-host` 装配，但数据目录及凭据策略分离。Web 也共用 `@pureterm/host`、`@pureterm/protocol` 和 `@pureterm/ui`；运行时无需 Electron。

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

Web 保存主机信息和已信任的 SSH 主机密钥，不创建或读取 `secrets.json` 或 Desktop 的 `keychain.json` 密钥库。密码、私钥口令及私钥内容只在当前客户端会话使用，刷新后需要重新输入。Keychain 支持导入、粘贴、编辑、搜索和主机选择，使用按客户端隔离的 Host 内存；密钥及主机关联在断开时清除，绝不序列化到磁盘。私钥通过浏览器文件选择器读取内容；浏览器不会向服务暴露本机文件的完整路径。Desktop 支持原生文件选择以及系统加密的凭据和 Keychain 存储。

本入口作为独立 Node 服务，与 Desktop 可选的附带浏览器不同：附带浏览器共享 Desktop 子进程的 Web Host 与加密数据，而此命令启动使用本次会话凭据策略的独立 Host。`SSH_CORDIS_NO_WEB_CARRIER=1` 只关闭 Desktop 的附带浏览器访问，不影响 `start:web`。

所有 HTTP 资源与 WebSocket 都要求启动 token 或由它换取的会话 cookie，并验证本机 Host 与浏览器 Origin。入口不提供公开监听参数，也不包含用户账户或租户隔离。

验证入口与真实浏览器：

```powershell
npm run build:web
node --test apps/web/tests/*.test.mjs
node apps/web/tests/smoke-browser.mjs
```

最后一项使用测试用 Chromium 窗口访问独立 Node 服务，覆盖无 preload 的 WebSocket 终端、浏览器直接选钥及 Keychain 密钥引用两条路径的真实 SSH 认证、终端回显，以及刷新后清空凭据和密钥关联。Electron 只用于这个浏览器测试，Web 服务本身不依赖 Electron。
