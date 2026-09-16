# 架构

Electron 只做壳：**一个进程、一个窗口、若干条载体**。业务全在 Cordis 插件树里，
壳与树之间只有一份很窄的公共契约（`Host`），渲染层与树之间只有一份协议（`shared/protocol.ts`）。

这份文档记录的是从 dsh（DeepSeek Harness）的桌面端借来的架构纪律——**去掉 agent 平面之后**，
剩下哪些是可迁移的、落在本项目的哪个文件里、以及哪些是故意不借的。

---

## 一、借过来的八条纪律

| # | dsh 的做法 | 落到本项目的哪里 | 为什么需要它 |
|---|---|---|---|
| 1 | `ElectronPlatformStrategy`：平台差异启动时选一次 | `electron/platform-plan.ts`（纯决策）+ `electron/platform.ts`（施加） | 以前散落成 `if (process.env…)` 和 `if (process.platform !== 'darwin')`，没人说得清「这台机器上到底用了哪套开关、为什么」。切两层是为了让决策可单测：决策不 import electron |
| 2 | `ElectronShellGeneration`：窗口 + 全部监听器 + 看门狗由同一个对象独占，只能经幂等的 `release()` 释放 | `electron/shell.ts` + `main.ts` 的 `startGeneration()` / `currentWindow()` | 以前监听器挂在窗口上、看门狗挂在模块变量上。一旦真的创建第二代（macOS 关窗后点 Dock → `app.on('activate')`），上一代没人摘、看门狗没人清，留下指向已销毁窗口的闭包 |
| 3 | 「Service reference、窗口对象和 subprocess handle 都不能跨 generation 缓存」 | `main.ts` 的 `currentWindow()` 是唯一取窗口的地方；各载体的 `getRenderer()` 也只认当前这一代 | 缓存窗口对象就是缓存了一个可能已经死掉的句柄。改成「每次现取」，就永远不会拿到上一代的 |
| 4 | 启动顺序最后一步：**Web surface 加载成功后才提交 profile 的 last-known-good 状态** | `electron/readiness.ts`（闸门）+ `electron/launch-profile.ts`（档案） | 以前渲染层上报就只 `console.log` 一句，上报没有任何约束力。现在「想在应用真能用之后才做的事」必须注册到闸门上，闸门没开就不会执行——一个起不来的配置绝不会被记成「可用」 |
| 5 | 公共契约与启动器内部细节分开：对外只导出 `profile-service` / `pnpm`，`desktopRuntime`、bootstrap、Electron 可执行文件路径一律不导出 | `src/host.ts` 的 `Host`（公共）与 `Host.internals`（标注只给测试/诊断）；`electron/boot-check.ts` 等标 launcher-private | 壳层一旦开始直接摸 `ctx.ssh` / `ctx.terminal`，插件就从「可替换的实现」退化成「公开 API」——之后任何一次内部重构都会变成破坏性变更 |
| 6 | subprocess 由服务独占管理，起进程的人负责这棵进程树的死活 | `electron/relaunch.ts` | 以前 `spawn` 完立刻 `app.exit(0)`：万一 spawn 失败（可执行文件没了、权限不对），结果是「既没起来新的、又把旧的关了」，用户面前什么都没了还没有任何输出 |
| 7 | 记录是插件，不是装配 | `src/plugins/host-log.ts` | `createHost` 里原来挂了 3 个 `ssh/*` 日志监听。装配（把插件装进树）和记录（观察运行时）是两件事：记录可换出口、可关掉；装配不行。抽成插件后它还随插件树一起 `dispose`，不留悬空监听 |
| 8 | **carrier 抽象**：UI 与壳之间隔一层通道，壳不认识「UI 具体跑在哪」 | `shared/protocol.ts`（协议）+ `electron/dispatch.ts`（语义）+ `carrier-ipc.ts` / `carrier-http.ts`（两条载体） | 见下一节。这条是本项目**最晚才补上**的一条，也是被指出「渲染层和壳之间要解耦」的那一条 |

### 关于第 8 条：为什么最后才补，以及补它改了什么

先在概念上把话说清楚：**「渲染层」不等于「Electron 的窗口」**。
以前的代码里，插件树的公共契约上写着 `webContentsId: number`——字面上「插件层不 import electron」
是成立的，但 Electron 的概念已经漏进了领域层：**领域层的「客户端身份」定义成了 Electron 的渲染进程 id**。
后果很具体：只要换载体（浏览器、将来某个别的宿主）就得改 `src/`，那载体就不是可替换的实现，
解耦是假的。

现在切成三层，各管一件事：

```
① 协议      shared/protocol.ts   通道名 + 数据形状 + 线格式。不 import 任何东西
② 语义      electron/dispatch.ts  「这个名字对应哪个 Host 调用」。不 import electron
③ 载体      carrier-ipc.ts / carrier-http.ts   把消息搬运过去。只有 ipc 那个 import electron
```

领域层拿到的是**不透明字符串** `clientId`（IPC 载体填 `ipc:<webContentsId>`，Web 载体填 `ws:<序号>`），
只当句柄转手，不解释、不拆解、不比较大小。身份由**载体**认定：`TerminalOpenRequest` 里根本没有
clientId 字段，客户端无法自称。

**判据（这条可以拿去验收）：加 Web 载体时，`src/` 一行都没改。**
反过来，如果哪天为了让某条新载体跑起来必须动 `src/`，说明解耦又破了。

## 二、故意没有借的

| 没借什么 | 为什么不借 |
|---|---|
| **agent 平面** | 项目定位就是终端客户端：连上去、开通道、收字节。没有会话编排、没有工具调用，也就没有 agent 平面存在的理由 |
| **渲染层插件系统** | dsh 明确写了「Desktop 没有另造一条 renderer IPC 插件系统，也不把 Electron API 暴露给页面」。我们照做：渲染层拿到的只有一个白名单对象，没有第二个入口——桌面端是 preload 的 `window.sshAPI`，浏览器端是等价的 WebSocket 客户端；**两者是同一个接口**（`SshApi`），页面里既不出现 `window.sshAPI` 也不出现 `WebSocket`。**连带结论：渲染层不会长出一套插件树**——加一个界面能力就是加 `renderer/` 下的一个模块（主机列表 `renderer/host-list.ts`、远端文件面板 `renderer/sftp-panel.ts`），**扩展点在领域侧** `src/plugins/`，不在界面侧 |
| **「一切都是插件」的绝对化** | 启动决策（Chromium 开关、应用菜单、窗口的世代）**不能**是插件：它们必须早于插件树存在，而且每个进程只能有一份。硬做成插件只会得到一个「自己启动自己」的插件。dsh 自己也是这么划的——`desktopRuntime` 那些是启动器代码，不是插件 |
| **把记录复制进另一个「Desktop 数据库」** | 主机列表只有一份，落在数据目录里。不额外复制一份到别处，也就不会出现两份互相矛盾的状态 |
| **为 WebSocket 引一个第三方库** | 客户端本来就是浏览器原生的 `WebSocket`，服务端只需要「握手 + 拆帧」。`electron/ws-frame.ts` 把编解码做成**纯函数**，能在普通 Node 里单测（`test/smoke-desktop.mjs`），代价是几百行换取零新增依赖。更要紧的是：**鉴权发生在握手之前**，没通过 token 的连接进不到这个解析器 |

## 三、分层与依赖方向

```
renderer/app.ts                界面：不出现 window.sshAPI，也不出现 WebSocket
   │  renderer/host-list.ts    主机列表：只画行 + 把行上动作翻成回调，不认识 api 也不认识终端
   │  renderer/sftp-panel.ts   远端文件面板：同上，连「当前在哪个目录」都不记（那是 app.ts 的状态）
   │  renderer/local-file.ts   本地文件的进出口（Blob 存盘 / File 读字节）——两端对称的那一半
   │  renderer/format.ts       只做显示的大小/时间格式化，不参与任何判断
   │  renderer/transport.ts    选载体（有 preload 注入就走 ipc，否则走 ws）
   ├───────────────┐
   │ contextBridge │            electron/preload.ts   渲染层唯一的 Node 能力入口，只做转发
   │               │  ws://
   │               ▼
   │        carrier-http.ts     本机 HTTP + WebSocket（127.0.0.1，随机端口，token）
   │               │
   ▼               ▼
carrier-ipc.ts   （同一个 dispatcher）
   └───────┬───────┘
           ▼
   electron/dispatch.ts        协议名 → Host 调用（唯一一份语义）
           │
   src/host.ts                 装配插件树，返回 Host
      ├─ services/  ssh · renderer · host-key-store      引擎与桥
      └─ plugins/   terminal-bridge · sftp-bridge · session-store · host-log   业务
```

依赖方向是单向的：`electron → src`，而且只经过 `Host`。
**`src/` 绝不 import electron**——需要「往客户端发消息」时走 `ctx.renderer`
（`RendererService` + `RendererBridge` / `RendererHandle` 结构接口），
所以宿主层可以脱离 Electron 用假实现单测（`test/smoke-host.mjs` 就是这么跑的）。

### 加一个新能力，要开几个洞

**判据：`Host` 上是不是要多一个方法。** 要 → 这是一个真能力，把四处洞一次开齐：

| 处 | 开什么 |
|---|---|
| `src/plugins/` | 新插件（照 `terminal-bridge.ts` / `sftp-bridge.ts`），`static inject` 只声明它真依赖的服务 |
| `shared/protocol.ts` | 通道名（`METHODS`）+ 跨边界的数据形状 |
| `src/host.ts` | `Host` 接口上的方法 + `createHost` 里的装配与转发 |
| `electron/dispatch.ts` | `case METHODS.xxx:` 一行映射（参数先收窄再往下传） |
| `renderer/` | 一个界面模块（可选；没有界面的能力也成立） |

**载体层（`carrier-ipc.ts` / `carrier-http.ts`）一个字都不用改**——它们只按名字搬运。
这正是这条边界成立的判据：SFTP 是照着这张表加的，两条载体确实没动。

反过来，「只是把已有能力换个样子摆出来」不需要开洞：主机列表、双击连接、编辑按钮
都是 `SessionStore` 这一个能力的不同动词，加它们只在 `renderer/` 里多写一个模块。

插件按**领域对象 / 能力域**切，不按界面动作切。照界面动作切的话会得到
「新增主机插件 / 删除主机插件 / 编辑主机插件」三个都 inject 同一个 store 的插件——
能力没多一个，插件多三个。

同理，`electron/` 里有两个方向约束：

- **纯决策不碰 Electron**：`platform-plan.ts`、`readiness.ts`、`launch-profile.ts`、`relaunch.ts`
  、`ws-frame.ts`、`ws-server.ts`、`dispatch.ts`、`carrier.ts`、`carrier-http.ts` 都不 import electron，
  于是它们能在普通 Node 里直接跑（`test/smoke-desktop.mjs` / `test/smoke-carrier.mjs`）。
- **只有 `carrier-ipc.ts` 和 `shell.ts` / `platform.ts` / `main.ts` 直接 import electron**。
  想加新载体时照 `carrier-http.ts` 写，不要往 `main.ts` 里塞逻辑。

## 四、四条不变量（改代码前先读）

1. **不跨 generation 缓存窗口。** 要窗口就用 `currentWindow()` 现取。
   新的一代起来之前，`startGeneration()` 会先把上一代 `release()` 掉——
   窗口、监听器、看门狗不许同时存在两份。

2. **状态只经闸门提交。** 任何「等应用真能用了再干活」的代码，都注册到
   `readiness.onReady(...)`，不要自己再判一次。判定就绪的依据是渲染层回报
   `app:renderer-ready` 且 `ok: true`，**不是** `did-finish-load`——后者只说明 HTML 解析完了。
   上报里必须带着**量过的** `cols/rows`（渲染层先 `settleLayout()` 再上报），
   否则写进档案的窗口尺寸会是 xterm 的默认值，那条证据就失效了。
   同理，**只有窗口里的渲染层（`ipc:` 客户端）的上报能解锁闸门**——
   一个浏览器标签页不该决定桌面应用算不算启动成功。

   这条有可观察的验收效果：

   ```
   第一次启动（无档案）：失败一次 → 自动以 --no-sandbox 重启 → 起来了才写档案
   第二次启动（有档案）：启动前就带上 --no-sandbox → 直接起来，不再失败
   ```

   `test/smoke-launch-profile.mjs` 就是跑这两次来做验收的。

3. **插件层不 import electron。** 通过 `ctx.renderer`。这条让宿主层可测；
   破坏它等于把整棵插件树绑死在 Electron 上。
   连带一条：**领域层不许出现载体的概念**——身份是 `clientId` 这个不透明字符串，不是 webContents id。

4. **协议的名字只在 `shared/protocol.ts` 定义一次。** 载体与业务代码一律用常量。
   写两份字面量的症状是「界面点了没反应」——最难查的一类错；
   换成两条载体之后，「两边一个字都不差」更是成了硬要求。
   `test/smoke-desktop.mjs` 用**字面量**反向断言这些通道名，改一个就红。

## 五、两条载体，与 Web 载体的安全约束

| | `carrier-ipc.ts` | `carrier-http.ts` |
|---|---|---|
| 客户端 id | `ipc:<webContentsId>` | `ws:<连接序号>` |
| 谁在用 | 桌面窗口里的渲染层（preload 注入 `window.sshAPI`） | 用浏览器打开控制台打印的那条地址 |
| 攻击面 | 无监听端口；只有 `contextBridge` 白名单 + `ipcMain`，**且校验调用者必须是当前窗口** | 本机回环上的一个 HTTP/WS 端口 |

Web 载体不是「另一条更弱的路」：同一个 token 才能连上，连上之后能做的事与桌面端完全一样
（都走同一个 dispatcher、同一棵插件树）。所以下列约束每一条都是**必须的**，不是加固：

1. **只绑 `127.0.0.1`**，端口随机（`listen(0)`）。绝不绑 `0.0.0.0`——那是「本机可用」与
   「局域网里谁都能连」的区别。
2. **token 是必须的，连取 HTML 也要。** 只给 WebSocket 加 token 是不够的：
   本机任何进程 `GET /` 就能把页面拿到手（以及页面里的 token）。
   流程是「带 `?token=` 打开页面 → 下发 HttpOnly + `SameSite=Strict` 的会话 cookie →
   之后静态资源与 WS 升级都凭 cookie」，token 不进 JS，也不留在地址栏给 Referer 带走。
3. **校验 `Host` 与 `Origin`。** `Host` 挡 DNS rebinding（恶意域名解析到 `127.0.0.1`）；
   `Origin` 挡「别家页面拿你的浏览器当跳板」。没有 `Origin` 的脚本客户端（冒烟测试）必须拿出 token。
4. **CSP + `nosniff` + `no-store`。** 终端是能显示任意远端文本的地方，别给它多余的权限；
   静态资源路径做目录穿越检查（解码之后再比对前缀）。
5. 想关掉它：`SSH_CORDIS_NO_WEB_CARRIER=1`（`test/smoke-electron-web.mjs` 之外都用不到它）。

## 六、启动顺序

`electron/main.ts` 只负责顺序，具体实现都在各自的文件里：

1. 读启动档案，把档案里的开关**先**追加到命令行（`launch-profile.ts`）
2. 选平台策略——幂等，只第一次生效（`platform.ts`）
3. `app.whenReady()`
4. 装应用菜单（`platform.ts`）
5. 建 shell generation #1（`shell.ts`）
6. 起 Cordis 宿主（`src/host.ts`）——桥是**合成**的（`carrier.ts`），把若干载体当一个用；
   装载体（`main.ts` 的 `installCarriers`）：先 ipc，再 web（起不来只记日志，不影响桌面端）
7. 渲染层回报就绪 → 闸门打开 → **提交启动档案**（`readiness.ts`）→ 启动自检收尾（`boot-check.ts`）

第 1 步必须在第 2 步之前：这样策略会把 `--no-sandbox` 当成命令行上本来就有的开关，
不会重复追加，日志里也能如实说明它从哪来。

第 6 步的桥要先于宿主存在，而载体要等 dispatcher（它依赖宿主）才能建——
所以桥拿到的是「取载体列表的函数」而不是列表本身。

退出顺序（`will-quit`）：释放窗口（摘监听器、停看门狗）→ 卸载体（不再收发消息）→
卸插件树（关所有 SSH 连接）→ 真退出。

## 七、数据文件

全部在 `SSH_CORDIS_DATA_DIR`（默认 `~/.ssh-cordis`），都按 `0600` 写。

| 文件 | 内容 | 为什么单独一个 |
|---|---|---|
| `hosts.json` | 主机元数据（**不含任何密文**） | 定位是「可以放心备份 / 同步 / 给人看」 |
| `secrets.json` | id → safeStorage 密文 | 和元数据分开：导出主机列表时不会把密文一起带走 |
| `known_hosts.json` | 已信任的主机密钥指纹 | TOFU 记录，丢了只是要重新确认一次 |
| `launch-profile.json` | 上次是哪套 Chromium 配置真的跑起来了 | 加速手段，不是数据源：损坏/版本不符就整个忽略，绝不因此启动不了 |

早期版本把密文混在 `hosts.json` 的 `sealedSecret` 字段里；
`SessionStore` 读到就搬进 `secrets.json`（先写密文再写元数据，中途失败也不会丢密码）。

**SFTP 一个文件都不加**，这是有意的：远端文件只经内存过线，下载由渲染层存到用户自己那台机器上，
上传的内容也不落我们的数据目录。要传的文件是用户的文件，不是我们的数据——
多存一份就多一份「同一份东西有两个版本」的可能（何况还可能夹着私钥、数据库备份这类东西）。

## 八、验证矩阵

| 命令 | 覆盖什么 | 需要 Electron |
|---|---|---|
| `npm run smoke:runner` | 端到端测试的**判定逻辑**（真实失败优先于环境限制） | 否 |
| `npm run smoke:desktop` | 平台策略、就绪闸门、启动档案、重启、WS 帧编解码、线上字节编码、协议常量 | 否 |
| `npm run smoke:host` | 插件树 + 真 ssh2 客户端对着本地假 SSH 服务（含密钥认证、错误翻译） | 否 |
| `npm run smoke:sftp` | SFTP：路径纯函数 + 真 SFTP 协议往返（对着内存文件系统） | 否 |
| `npm run smoke:carrier` | Web 载体的鉴权与完整协议（外部客户端跑完一个真会话，含 SFTP 过线） | **否**（解耦的直接收益） |
| `npm run smoke:profile` | 启动档案的两次启动验收 | 是（两次） |
| `npm run smoke:electron` | 窗口 + 真 preload + IPC 载体 + 真 SSH 会话 | 是 |
| `npm run smoke:web` | 真应用里的 Web 载体：外部客户端连上去开一个真会话 | 是 |
| `../termius-analysis/drive-sftp.mjs` | SFTP **界面**端到端：点抽屉、进目录、上传、下载（比字节）、新建、删除 | 是，且要一个真实可见的前台桌面 |

最后一条不在 `smoke` 链里，因为它**会接管真实的鼠标与键盘焦点**：路上那三个模态框
（上传的文件选择框、下载的保存框、删除的 confirm）属于操作系统，只能从进程外驱动
（页面内走 CDP，框内用 SendInput）。一条会自动抢你前台的测试不该进 `npm run verify`。

退出码语义（`smoke:electron` 与 `smoke:web` 一致，**不要改**）：
`0` 通过 · `1` 真实失败 · `2` 环境不支持。
**真实失败必须优先于环境限制**——否则受限环境会把真 bug 一并吞成「环境问题」。
