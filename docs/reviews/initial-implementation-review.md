# Electron + Cordis SSH 客户端 —— 实现评审

评审对象：Electron 壳 + Cordis 宿主 + SshService / TerminalBridge 三层实现（含 `package.json`、
`tsconfig*.json`、`src/services/ssh.ts`、`src/plugins/terminal-bridge.ts`、`src/host.ts`、
`electron/main.ts`、`electron/preload.ts`、`renderer/*`）。

**一句话结论**：分层和插件拆分的方向是对的，Cordis 的核心 API 也基本用对了（`Service` 构造签名、
`inject`、`ctx.effect`、`await ctx.plugin()` 四样都在点子上）。但这份代码**目前跑不起来**——有 3 个
阻断级问题（依赖装不上、preload 必崩、HTML 路径错），即使绕过去，**连接失败的错误 100% 会静默丢失**，
而且**中文输出会乱码、远端 PTY 永远停在 80×24**。下面是逐条证据和修法。

验证方式：cordis 主分支源码（`packages/core/src/{service,fiber,context,registry,reflect,events}.ts`）、
ssh2 README、Electron ESM 官方文档、npm registry 实时数据。

---

## P0 —— 阻断级（不修就跑不起来）

### P0-1 `cordis: ^4.0.1` 这个版本不存在，`npm install` 直接失败

npm registry 实时结果：

```
dist-tags: { "next": "4.0.0-beta.5", "latest": "4.0.0-rc.10" }
```

**没有任何 4.0.x 稳定版**，`latest` 指向 rc。`^4.0.1` 匹配不到任何版本 → ETARGET。
而且 cordis README 自己写着：*"Cordis is under active development. The API is not yet stable and may
change without notice."*——所以带 `^` 的写法还会在下次 rc 升级时把 API 漂移带进来。

修法：

```jsonc
"dependencies": {
  "cordis": "4.0.0-rc.10",   // 锁定 rc，别用 ^；升级时人工看 diff
  "@cordisjs/plugin-loader": "^1.0.0-rc.7"  // 可选：要用配置文件加载插件树时才需要
}
```

### P0-2 ESM preload 必然崩溃：`window.sshAPI` 永远是 undefined

Electron 官方 ESM 文档原文：

> **ESM preload scripts must have the `.mjs` extension** — Preload scripts will **ignore `"type": "module"` fields**,
> so you *must* use the `.mjs` file extension in your ESM preload scripts.
>
> **Sandboxed preload scripts can't use ESM imports.**

当前 `package.json` 有 `"type": "module"`，`preload.ts` 编译成 `dist/electron/preload.js`，里面是
`import { contextBridge, ipcRenderer } from 'electron'`。preload 忽略 `type: module` → 按 CJS 加载 → 抛出
`Cannot use import statement outside a module`，preload 整体不执行 → 渲染层 `window.sshAPI` 为 undefined →
点 Connect 报 `Cannot read properties of undefined`。整个 UI 死。

修法（二选一，推荐前者）：

- **用 esbuild 单独产出 `.mjs`**，并在窗口上关掉 sandbox（ESM preload 要求非 sandbox）：

```jsonc
// package.json scripts
"build:preload": "esbuild electron/preload.ts --bundle --platform=node --format=esm --external:electron --outfile=dist/electron/preload.mjs"
```

```ts
// electron/main.ts
webPreferences: {
  preload: join(__dirname, 'preload.mjs'),
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: false,        // ESM preload 的前置条件
}
```

- 或者 preload 保持 CJS：把源文件改名 `preload.cts`（tsc 会输出 `preload.cjs`），`require('electron')`，
  路径指向 `preload.cjs`。

> 注意：`sandbox: false` 会削弱一层防护。preload 里只做 `contextBridge` + `ipcRenderer` 转发，
> 不要在 preload 里引入业务逻辑或动态 `import()`，这是可以接受的取舍。

### P0-3 `loadFile` 指向一个不存在的文件

```ts
const __dirname = dirname(fileURLToPath(import.meta.url))   // = dist/electron
await win.loadFile(join(__dirname, '../renderer/index.html'))  // = dist/renderer/index.html
```

但 `renderer/index.html` 只存在于**源码目录**，`npm run build` 从没把它复制到 `dist/`；同时 HTML 里的
`<script src="../dist/renderer/app.js">` 是按"HTML 在源码目录"解析的。两套路径互相矛盾 → `ERR_FILE_NOT_FOUND`。

修法：让 build 把 HTML 也吐到 `dist/renderer/`，HTML 里的 script src 改成同目录相对路径：

```jsonc
"build:renderer": "esbuild renderer/app.ts --bundle --outfile=dist/renderer/app.js --format=esm && node -e \"require('fs').copyFileSync('renderer/index.html','dist/renderer/index.html')\""
```

```html
<!-- renderer/index.html -->
<link rel="stylesheet" href="./app.css" />   <!-- esbuild 会随 JS 一起产出 app.css -->
<script type="module" src="./app.js"></script>
```

---

## P1 —— 功能级（跑起来也是错的）

### P1-1 把事件当 RPC 用，导致**连接失败的错误全部静默丢失**（最严重的设计问题）

cordis 的 `emit` 实现（`events.ts`）：

```ts
emit(...args: any[]) {
  const [thisArg, callbacks] = this._resolve('emit', args)
  for (const callback of callbacks) Reflect.apply(callback, thisArg, args)   // 不 await、不收集返回值
}
```

而 `terminal-bridge.ts` 里：

```ts
ctx.on('terminal:open', async (payload, getWebContents) => {
  const session = await ctx.ssh.connect({ ... })   // ← 一旦 reject，就是 unhandled rejection
  ...
})
```

`host.ts` 里 `root.emit('terminal:open', ...)`，`main.ts` 里 `ipcMain.handle('ssh:open', ...)` 的
handler **没有 return**，`openTerminal()` 本身也返回 `void`。于是：

- 渲染层 `await window.sshAPI.open({...})` **永远立刻成功**（resolve 成 `undefined`），UI 无从显示"连接中/失败"；
- 密码错、主机不通、私钥格式错……全部变成 Node 的 unhandled rejection，界面上**一点反应都没有**，
  终端保持空白，看起来像卡死。

这是"能连上的时候能用、连不上时完全不可诊断"的典型形态。

修法：**请求/响应用服务方法，不要用事件**（事件在 cordis 里是广播语义）。给 TerminalBridge 提供方法而不是
监听器，把 Promise 一路 return 回 `ipcMain.handle`：

```ts
// src/plugins/terminal-bridge.ts —— 用 Service 承载“可调用的能力”
declare module 'cordis' {
  interface Context { terminal: TerminalBridge }
}

export class TerminalBridge extends Service {
  static inject = ['ssh']          // 等价于 export const inject
  private bridges = new Map<string, { shell: ClientChannel; wc: WebContents }>()

  constructor(ctx: Context) { super(ctx, 'terminal') }

  async open(payload: OpenPayload): Promise<{ sessionId: string }> {
    const wc = this.ctx.electron.getWebContents(payload.webContentsId)
    if (!wc) throw new Error('renderer not found')

    let session
    try {
      session = await this.ctx.ssh.connect(payload)
    } catch (error) {
      wc.send('terminal:error', String((error as Error)?.message ?? error))  // 错误有出口
      throw error                                                           // 同时 reject 回 invoke
    }

    const shell = await session.shell({ cols: payload.cols, rows: payload.rows })  // 见 P1-3
    ...
    return { sessionId: session.id }
  }
}
```

```ts
// electron/main.ts
ipcMain.handle('ssh:open', (event, payload) => host.openTerminal({ ...payload, webContentsId: event.sender.id }))
```

> 如果坚持用事件，那必须换成 `await ctx.serial('terminal:open', ...)`（serial 会 await listener 并返回
> 第一个非空结果）或 `ctx.waterfall`。但用事件传 `getWebContents` 这种能力参数本身就是信号：这个"事件"
> 其实是一次调用。

### P1-2 类型根本编不过：`Events` 需要模块增强

cordis 的 `Events` 只有内置事件名 + `[key: symbol]` 索引签名，**没有** `[key: string]`。所以在
`strict: true` 下：

```ts
ctx.on('terminal:open', ...)      // TS2345: '"terminal:open"' 不能赋给 keyof Events
ctx.emit('terminal:ready', id)    // 同上
```

也就是说这份 `src/` **从未通过类型检查**（这也解释了为什么 P1-1 的错误路径没被发现）。补上增强即可：

```ts
declare module 'cordis' {
  interface Events {
    'terminal:open'(payload: OpenPayload): void
    'terminal:data'(sessionId: string, chunk: Uint8Array): void
    'terminal:closed'(sessionId: string): void
  }
}
```

顺带：`ctx.emit('terminal:ready', id)` 没有任何监听者，是死代码。

### P1-3 远端 PTY 固定 80×24 且 `$TERM=vt100`，首次尺寸永远不会同步

ssh2 README：`shell([[window,] options,] callback)` —— *"If `window === false`, then no pseudo-tty is
allocated"*，即**省略 `window` 会分配一个默认 pty**，默认值是 `term: 'vt100', rows: 24, cols: 80`。

后果：

- 远端只按 80 列排版，本地窗口更宽 → 所有长行换行位置全错；
- `vt100` 没有 256 色/真彩 → `ls`/`git diff` 颜色降级或消失，`vim`、`htop`、`tmux` 表现异常（tmux 可能直接拒绝）；
- `term.onResize` 只在**尺寸发生变化**时触发，而 `fit.fit()` 发生在 connect 之前（那时 `currentSession`
  还是 null，事件被丢弃）→ **第一次 resize 永远发不出去**，远端就一直停在默认尺寸。

修法：

```ts
// ssh.ts：把 cols/rows 带进 pty 请求
shell: (size) => new Promise<ClientChannel>((resolve, reject) => {
  client.shell({ term: 'xterm-256color', cols: size.cols, rows: size.rows }, (err, stream) =>
    err ? reject(err) : resolve(stream))
})

// renderer/app.ts：opened 之后主动补一次尺寸
window.sshAPI.onOpened((id) => {
  currentSession = id
  window.sshAPI.resize(id, term.cols, term.rows)   // 不要依赖 onResize
  term.focus()
})
```

顺便确认一个**没踩的坑**：`setWindow(rows, cols, height, width)` 的参数顺序是对的（ssh2 就是 rows 在前）。

### P1-4 字节流被逐块 `toString()`，中文/emoji 必乱码

```ts
shell.on('data', (data: Buffer) => wc.send('terminal:data', session.id, data.toString()))
```

UTF-8 的一个汉字是 3 字节，一个 emoji 4 字节，而 SSH 分包**不以字符为边界**——日志、`top`、进度条这类
高频输出里，一个字符被劈到两个 chunk 是常态。逐块 `toString()` 会在断点处产生 `�`。

修法（零成本，不需要 StringDecoder 也不需要 base64）：**直接传字节**。Electron 9+ 的 IPC 走结构化克隆，
`Uint8Array` 原生支持；而 xterm 的 `write()` 签名就是 `write(data: string | Uint8Array)`，它内部有正确的
流式解码器，会自己处理跨包的多字节字符。

```ts
// 主进程侧
shell.on('data', (chunk: Buffer) => wc.send('terminal:data', session.id, chunk))  // 传 Buffer
// 渲染层
window.sshAPI.onData((id, chunk: Uint8Array) => { if (id === currentSession) term.write(chunk) })
```

顺带：如果远端 locale 不是 UTF-8（老机器的 GBK/Shift-JIS），需要在连接参数里显式处理并告知用户，
这是"乱码"的另一个来源，注释里应该写清楚假设是 UTF-8。

### P1-5 断线、退出、服务端报错都没有出口

`client.on('error')` 只在连接阶段注册过一次；`ready` 之后所有 error 都被那个 `reject` 吞掉
（Promise 早已 resolve，reject 是 no-op，连日志都没有）。也没有监听 `close` / `end`，shell 流也没监听
`error`。结果：拔网线、服务器重启、`exit` 退出、MOTD 之后的权限报错——终端界面**永远停在最后一帧**，
用户以为还连着。

修法：`client.on('close'|'end'|'error')` 和 `shell.on('close'|'error')` 都要接到一个统一的
`disposeSession(id, reason)`，把 `terminal:closed` + 原因发给渲染层，并清掉 `bridges` / `sessions`。

### P1-6 `SshService.sessions` 只增不减

shell 关闭时只删了 `bridges` 里的条目，`SshService.sessions` 里那条 session 一直留到**服务卸载**。
连 20 台机器再断开 → map 里 20 条 client 引用还在（`client.end()` 也没被调）。属于内存/句柄泄漏。
session 结束时应从 map 里 `delete`，并 `client.end()`；`dispose` 只作为兜底。

### P1-7 没有 host key 校验（作者已知，但这个不能"以后再说"）

`hostVerifier` 缺失 = 中间人攻击无门槛。这个客户端的用途就是连生产服务器，用户会用它执行 `rm`、
部署、改数据库。TOFU（首次记录、之后比对，落在 `~/.ssh/known_hosts` 同构的 JSON 里）大约 20 行代码。
在加上它之前，这个客户端只适合连自己的测试机。

---

## P2 —— 加固 / 一致性

1. **"宿主进程"其实没独立。** 设计文档写"启动 Cordis 宿主进程"，实现是 `main.ts` 里直接 `createHost()`
   ——同进程。这个选择**更好**（不需要序列化、能直接传 Buffer），但既然同进程，就别再模拟跨进程边界
   （字符串化输出、把能力函数塞进事件参数）。要么承认"进程内宿主"，要么真开子进程——那时才轮到设计文档里
   的 WebSocket + 字节前缀多路复用，而且要面对一个额外的事实：**新增的 TCP 监听端口本身就是攻击面**，
   必须配 token 认证，否则等于在你机器上开了个免密 SSH 代理。二选一，别两个都留。
2. **`getWebContents` 通过事件参数传入不是 Cordis 的写法。** 应该做成服务：`ElectronService` 提供
   `ctx.electron.getWebContents(id)` / `ctx.electron.send(id, channel, ...)`，TerminalBridge 用
   `inject: ['ssh', 'electron']`。收益：TerminalBridge 不再 `import type { WebContents } from 'electron'`，
   能脱离 Electron 做单测；现在这个 `src/` 其实和 Electron 是硬耦合的，"三层架构"只剩名义。
3. **没有背压和批量。** `cat bigfile`、`yes`、`npm run build` 会在几秒内产生上万个 `wc.send`，
   主进程和渲染进程一起卡死。最少按 ~16ms 合并一次输出；队列超阈值时 `shell.pause()` / `resume()`
   做真流控。这是 SSH 终端客户端的经典必修课，不是优化项。
4. **`xterm@5.3.0` 已被 npm 标记废弃**：registry 里明写 *"This package is now deprecated. Move to
   `@xterm/xterm` instead."*（`xterm-addon-fit` 同理）。同时 `index.html` 从 unpkg 拉 CSS：离线直接用不了，
   打包后更用不了，而且页面没有任何 CSP。改成 `@xterm/xterm` + `@xterm/addon-fit`，CSS 走 esbuild
   打包（会并出 `app.css`），页面加 CSP meta。
5. **`tsconfig.main.json` 用 `moduleResolution: "Bundler"` 配 tsc 直出 Node ESM 是错组合**：Bundler 允许
   省略扩展名的相对 import，但 Node 会 `ERR_MODULE_NOT_FOUND`。这份代码恰好都写了 `.js` 后缀所以没爆，
   下一个模块就会踩。改 `"module": "NodeNext", "moduleResolution": "NodeNext"`。
6. **`fit.fit()` 在首帧前调用**：容器尺寸可能为 0，xterm 会算出 NaN/抛错；`window.resize` 里的 `fit()`
   也没有节流。放到 `requestAnimationFrame` 里并做保护。
7. **版本与类型**：Electron 33 早已超出官方支持窗口（只维护最近三个大版本），且 `@types/node@24` 与
   Electron 33 内置的 Node 版本不一致，会产生"类型里有、运行时报 undefined"的假信号。升到当前稳定版并
   对齐 `@types/node`。
8. **`exec()` 是死代码**；设计里的 SessionStore、SFTP、端口转发、多标签都还没实现（作者已标注）。
   补 SessionStore 时特别注意：**不要明文存密码**。用 Electron `safeStorage.encryptString()`
   （Windows DPAPI / macOS Keychain）。参考的 `~/.dsh/ssh-hosts.json` 模式里，密码如果也是明文，
   那是**不该照抄的部分**。
9. **无 keepalive**：`connect({ keepaliveInterval: 15_000 })`，否则 NAT/防火墙会静默掐断长连接，
   而且用户不会收到任何提示（叠加 P1-5 就是"看起来在连着，其实早断了"）。
10. **macOS 生命周期**：`window-all-closed` 里直接 `app.quit()` 可以接受，但缺 `activate` 重建窗口；
    另外建议把 `host.dispose()` 挪到 `before-quit`，而不是已经在关窗的 `window-all-closed` 里 await。

---

## 用对了的部分（别改掉）

- **Cordis 的四件事都用对了**：`Service` 的 `super(ctx, 'ssh')` 与 core 源码
  `constructor(protected ctx: Context, name: string)` 完全一致；`ctx.effect(() => () => {...})` 返回
  disposer 的写法正确（cordis 支持返回函数/迭代器/Promise）；`await ctx.plugin(x)` 确实会等待——
  `RegistryService.plugin()` 返回 `Fiber & PromiseLike<Fiber>`，`then` 走 `fiber.await()`，插件加载失败会
  在这里抛出来；`inject: ['ssh']` 的"服务未就绪就不 apply、就绪后自动重放"语义用对了，这正是这套架构
  真正值钱的地方。
- **插件拆分粒度合理**：连接引擎（SshService）/ 字节通道（TerminalBridge）/ 状态持久化（SessionStore）
  是三个正交的关注点，各自可以独立卸载——这确实是 cordis 该干的事，而不是照搬 dsh 的 agent 平面。
  `schema`/`Config` 校验（`static Config`）暂时没写也不算问题。
- **Electron 安全基线是对的**：`nodeIntegration: false` + `contextIsolation: true` + `preload` 白名单，
  渲染层拿不到 Node 能力，符合设计意图。
- **渲染层没有 XSS 面**：全部走 `term.write()` 写文本，没有任何 `innerHTML`/`dangerouslySetInnerHTML`。
  终端输出是不可信数据，这条很关键，保持住。
- **`setWindow(rows, cols, height, width)` 的参数顺序正确**（很多人会写成 cols 在前）。

---

## 建议的修复顺序

| 顺序 | 内容 | 理由 |
|---|---|---|
| 1 | P0-1 / P0-2 / P0-3 | 不然连 `npm install` 和窗口都过不去 |
| 2 | P1-1 + P1-2 | 打通错误通道 + 让 `tsc` 真的检查类型，后面所有 bug 才可见 |
| 3 | P1-4 + P2-3 | Buffer 传输 + 批量，同时解决乱码和卡死 |
| 4 | P1-3 | pty term/尺寸，终端才"像个终端" |
| 5 | P1-5 / P1-6 | 断线可见 + 不泄漏 |
| 6 | P1-7 | host key 校验，之后才谈得上"能用" |
| 7 | SessionStore（safeStorage）/ SFTP / 多标签 | 增量插件，按同样的 Cordis 模式逐个加 |

这 7 步里，第 1–2 步之后项目才第一次"可调试"，第 4 步之后才第一次"可用"。
