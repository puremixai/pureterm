# SSH Cordis Client

Electron 壳 + Cordis 宿主（Node.js 主进程）+ 四个 Cordis 插件（SshService / TerminalBridge / SessionStore / HostLog）
+ xterm.js 渲染层。

渲染层与壳之间隔着一份协议（`shared/protocol.ts`）和一层**载体**（`electron/carrier-*.ts`）：
同一份 `dist/renderer` 产物既能被 Electron 窗口加载（走 IPC 载体），
也能被浏览器加载（走本机 HTTP + WebSocket 载体），两条路共用同一套协议、同一个 dispatcher、同一棵插件树。
换句话说，**「渲染层」不等于「Electron 的窗口」**。

借的是 dsh 的「薄壳 + 插件树」模型，**没有**照搬它的 agent 平面：整个项目用到的 Cordis 能力只有
Context / Service / inject / ctx.effect 四样。借来的架构纪律（以及故意没借的那些）见
[ARCHITECTURE.md](ARCHITECTURE.md)。

```
ssh-cordis-client/
├─ shared/
│  └─ protocol.ts        渲染层 ⇄ 壳的**唯一**协议定义处（不 import 任何东西，三边共用）
├─ electron/
│  ├─ main.ts            壳：只负责启动/退出顺序 + 装配载体，只调用 Host 的公共契约
│  ├─ platform-plan.ts   平台策略的**纯决策**（不 import electron，可单测）
│  ├─ platform.ts        把策略施加到 app 上：开关 / 硬件加速 / 菜单
│  ├─ shell.ts           ElectronShellGeneration：窗口 + 全部监听器 + 看门狗，只经幂等 release() 释放
│  ├─ readiness.ts       就绪闸门：状态只在表面真正就绪之后才提交（纯逻辑，可单测）
│  ├─ launch-profile.ts  启动档案：上次是哪套配置跑起来的（纯 fs，可单测）
│  ├─ relaunch.ts        以新配置重启自己，并独占管理那个子进程（不 import electron，可单测）
│  ├─ boot-check.ts      启动自检收尾（launcher-private）
│  ├─ dispatch.ts        协议名 → Host 调用的**唯一**映射（不 import electron）
│  ├─ carrier.ts         合成桥：把若干载体当一个 RendererBridge 用（不 import electron）
│  ├─ carrier-ipc.ts     IPC 载体：桌面窗口，客户端 id = ipc:<webContentsId>
│  ├─ carrier-http.ts    Web 载体：本机 HTTP + WebSocket（不 import electron，可单测）
│  ├─ ws-frame.ts        RFC 6455 帧编解码（纯函数，可单测）
│  ├─ ws-server.ts       最小 WebSocket 服务端（握手 + 拆帧 + 心跳）
│  ├─ preload.ts         contextBridge 白名单（esbuild 产出 preload.cjs）
│  └─ smoke.ts           端到端冒烟测试驱动（仅 SSH_CORDIS_SMOKE=1 时加载）
├─ src/
│  ├─ host.ts          Cordis 宿主入口：返回公共契约 Host（内部视图在 host.internals）
│  ├─ services/
│  │  ├─ ssh.ts            SshService：ssh2 连接引擎（ctx.ssh）
│  │  ├─ renderer.ts       RendererService：往「某个客户端」发消息 + 加解密（ctx.renderer）
│  │  │                    接口里没有任何 Electron 类型 → 宿主可脱离 Electron 单测
│  │  └─ host-key-store.ts TOFU 主机密钥库（SHA256 指纹）
│  └─ plugins/
│     ├─ terminal-bridge.ts  TerminalBridge：字节桥 + 合并 + 背压（ctx.terminal）
│     ├─ session-store.ts    SessionStore：主机元数据与密文分文件落盘（ctx.sessionStore）
│     └─ host-log.ts         HostLog：把 ssh/* 事件写成日志的观测插件（ctx.hostLog）
├─ renderer/           index.html / app.ts / transport.ts / style.css（xterm.js）
├─ scripts/
│  ├─ build-preload.mjs        esbuild → dist/electron/preload.cjs（CommonJS）
│  ├─ build-renderer.mjs       esbuild → dist/renderer/{app.js,app.css,index.html}
│  ├─ check-esm-extensions.mjs 强制相对导入带显式扩展名（Node ESM 要求）
│  ├─ diagnose-electron.mjs    探测哪套 Chromium 开关能让渲染进程跑起来
│  ├─ boot-check.mjs           启动自检：应用能不能真的站起来（含截图）
│  ├─ start.mjs                前台启动（构建 + electron），不经过 npm
│  └─ launch.mjs               脱离终端启动应用（日志落 dist/launch.log）
├─ test/
│  ├─ fake-ssh-server.mjs        本地假 SSH 服务（记录 pty/输入，故意切碎 UTF-8 分片）
│  ├─ smoke-desktop.mjs          纯逻辑 42 项（无需 Electron）
│  ├─ smoke-host.mjs             宿主层 32 项（无需 Electron）
│  ├─ runner-decision.mjs        端到端 runner 的判定逻辑（纯函数，可单测）
│  ├─ smoke-runner-decision.mjs  判定逻辑 11 项
│  ├─ smoke-carrier.mjs          Web 载体 25 项：鉴权 + 完整协议（无需 Electron）
│  ├─ smoke-launch-profile.mjs   启动档案往返：两次真启动做验收
│  ├─ smoke-electron.mjs         端到端：窗口 + preload + IPC 载体
│  └─ smoke-electron-web.mjs     端到端：真应用里的 Web 载体（外部客户端连上去）
├─ ARCHITECTURE.md     从 dsh 借了什么、故意没借什么、四条不变量
└─ README.md
```

先读 [ARCHITECTURE.md](ARCHITECTURE.md) 再改代码：里面有四条不变量（不跨 generation 缓存窗口、
状态只经闸门提交、插件层不 import electron、协议名字只定义一次），破坏任何一条都会埋下很难查的 bug。

## 跑起来

```bash
npm install
node scripts/start.mjs
```

**为什么启动入口是 `node scripts/start.mjs` 而不是 `npm start`。** 构建 + 启动本身没问题，
问题在 `npm` 这个入口本身在这台机器上不稳定——它同目录下有 `npm`（无扩展名）、`npm.cmd`、`npm.ps1`
三份，三种 shell 各挑一份，各有各的坏法：

| shell | 挑中的 | 症状 |
|---|---|---|
| Git Bash / MSYS | `npm`（`#!/usr/bin/env bash`） | `No such file or directory`——**看着像「npm 没装」，其实不是**，是 shim 里没有 `/usr/bin/env` |
| PowerShell | `npm.ps1` | 受 `Get-ExecutionPolicy` 约束（本机是 `RemoteSigned`） |
| cmd.exe | `npm.cmd` | 能跑，三条里唯一一条 |

而 `node` 一定在 PATH 上。所以入口收在 node 上，三种 shell 下是同一条命令。
`start.mjs` 做的就是 `npm start` 那两件事（构建 → 前台启动 electron，日志直接打在眼前，Ctrl+C 结束），
只是不经过 npm。`SSH_CORDIS_SKIP_BUILD=1` 可以跳过构建。

`npm start` / `npm run build` 依然保留，能用的时候用就行；跑不起来时换 `node scripts/start.mjs`。

窗口打开后在工具栏填主机/端口/用户名，**选认证方式**，再点「连接」。「保存」会把主机写进
`~/.ssh-cordis/hosts.json`，凭据用系统密钥加密后落盘。

### 认证方式：密码 / 私钥

「认证方式」一栏决定下面出现哪个凭据输入框，两者的**下一步动作不一样**，所以没有合并成一个框：

| 认证方式 | 要填的 | 说明 |
|---|---|---|
| 密码 | 密码 | 传统做法 |
| 私钥 | 私钥文件 + 私钥口令（没有就留空） | 点「选择…」挑一个文件，常用的在 `~/.ssh` 下 |

**只记路径，不复制私钥本体。** 选中的是 `id_ed25519` 这类文件时，落盘的是路径字符串；
私钥内容在**每次连接时现读**。理由很直接：私钥已经在用户自己的 `~/.ssh` 下，
那里有它自己的权限模型（`ssh` 自己也在校验 0600），我们这边再存一份只是多一个泄露面。
代价是移动/删除那个文件后重连会失败——这时报的就是「读不到私钥文件：<路径>（原因）」，
不会含糊成「认证失败」。

选中私钥后如果文件是加密的，界面会**提前**提示要去填口令——不用等连一次失败才知道。
口令填错和不填会得到两句不同的提示：前者是「私钥口令不对」，后者是「这把私钥有口令保护，请填上」，
因为用户接下来该做的事不一样。

存量主机切认证方式时，**旧凭据会被清掉**。密文槽只有一份，密码和私钥口令不能混着放，
否则换了方式之后会拿旧密码去当口令用，报出来是「认证失败」这种查不出所以然的话。

命令行连本机 WSL2 走的是同一套字段（见下），只是第一步得先在 WSL 里装上服务端。

想让它脱离终端独立运行（关掉终端也不退出、日志写到 `dist/launch.log`）：

```bash
node scripts/launch.mjs
```


`launch.mjs` **不做开关决策**，只负责「脱离终端」和「把档案读出来告诉你这次会用哪套配置」：

```
启动档案：--no-sandbox｜放宽了进程沙箱｜终端 133x28｜主机 0 个｜记录于 2026-09-15T…
          C:\Users\ausu\.ssh-cordis\launch-profile.json
按档案回填：--no-sandbox（应用会在建窗口之前自己追加，不是这个脚本加的）
已启动：pid=12345  透传参数=(无)
```

要显式指定开关就原样透传：`node scripts/launch.mjs -- --in-process-gpu`。
「这台机器需不需要放宽沙箱」始终由应用自己判断——`electron/platform-plan.ts` 按平台和环境变量决策，
`electron/launch-profile.ts` 记住上次的结果。脚本替它决定的话，那套机制会静默失效
（`planProfileSwitches` 看到命令行上已有 `--no-sandbox` 就会正确地什么都不做），
档案还会记下一次用户从没选择过的 `sandboxWeakened: true`。

### 连不上时，先看清是「哪一段」断的

报错信息是按**连接阶段**区分的，别一看到「连不上」就去怀疑密钥。每一段该查的东西完全不同：

| 界面上看到 | 断在哪一段 | 该查什么 |
|---|---|---|
| `这个文件不是可识别的私钥` / `读不到私钥文件：<路径>` | 还没出网 | 私钥文件选错了、或路径变了。**跟网络和服务器都无关** |
| `这把私钥有口令保护，请填上` / `口令可能不对` | 还没出网 | 口令没填或填错。**还没去连服务器** |
| `<host>:<port> 的连接被重置` / `连接超时` | TCP | 服务没起、端口不对、安全组没放行 |
| `<host>:<port> 的 TCP 连接建立了，但对方在送出 SSH 横幅之前就断开了` | 握手（最前面一步） | 见下 |
| `主机密钥已改变` | 握手 | 要么真被换了密钥，要么你重装过系统。确认无误后删掉本地记录再连 |
| `认证失败：用户名、密码或私钥不正确` | 认证 | 到此为止网络和服务都是好的：是**用户名或凭据**不对 |

**「TCP 连接建立了，但对方在送出 SSH 横幅之前就断开了」这条最容易把人带偏**，
因为它看起来像「连接问题」，用户会转头去怀疑密钥——但这一步**还没走到认证**，密钥根本没被用到。
它的确切含义是：TCP 三次握手成功，然后 socket 在收到任何字节之前就被关掉了
（ssh2 里的判据是 `wasConnected && !sawHeader`）。

常见原因按概率排：这个端口上跑的根本不是 SSH（比如连到了 80/443）；对端安全组只放通了 TCP
却丢弃数据；对端瞬时不稳（**隔几秒重试一次通常就好了**）。

想验证「到底是主机的问题还是应用的问题」，用系统自带的 `ssh` 对照一下最快：

```bash
ssh -vvv -o ConnectTimeout=15 ubuntu@<host>      # 看它停在哪一步
```

`ssh` 能进就说明主机和网络没问题（那应用也该能进）；`ssh` 也进不去就是主机/网络侧的事，
跟客户端无关。本节这条报错就是用这个办法定位的。

### 连本机的 WSL2

WSL2 在 NAT 后面，**不是** `127.0.0.1`，而且它的 IP 每次重启都变，所以别把 IP 存成主机。
本机实测环境：Ubuntu（WSL2，`systemd=true`）、无 `.wslconfig`（默认 NAT + `localhostForwarding=true`）。

**第一步：在 WSL 里装服务端**（默认两个 OpenSSH 都只有客户端，连不上不是应用的问题）

```bash
# 在 WSL 的终端里执行
sudo apt update && sudo apt install -y openssh-server
sudo systemctl enable --now ssh      # systemd=true 才能这么写；否则用 sudo service ssh start
sudo passwd "$USER"                  # 走密码认证才需要；用私钥登录就跳过，见下
ss -tln | grep ':22 '                # 确认在监听
```

**用私钥登录（没有密码的机器走这条）**：把 Windows 侧的公钥追加到 WSL 里，然后认证方式选「私钥」。

```bash
# 在 WSL 的终端里执行；<你的公钥> 就是 Windows 上 ~/.ssh/id_ed25519.pub 的内容
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo '<你的公钥>' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys
sudo grep -i '^PubkeyAuthentication' /etc/ssh/sshd_config   # 默认是 yes，被改成 no 才要动
```

WSL 侧要确认三件事，少一件都会表现为「认证失败」：家目录权限别太松（`chmod g-w ~`）、
`.ssh` 是 700、`authorized_keys` 是 600。服务端拒绝的原因在 `sudo journalctl -u ssh -n 50` 里。

**第二步：在应用里填**

| 字段 | 值 | 为什么 |
|---|---|---|
| 主机 | `127.0.0.1` | `localhostForwarding` 默认开着，Windows 侧访问 WSL 监听的端口走 localhost 就行，且不受 IP 变化影响 |
| 端口 | `22` | 注意先确认 Windows 侧没另外跑一个 OpenSSH 服务端占着 22 |
| 用户名 | WSL 里的用户名（`id -un`） | |
| 认证方式 | 密码 → 填 `passwd` 设的密码；私钥 → 「选择…」挑 `id_ed25519`，有口令就填 | 见上一节 |

首次连接会弹主机密钥确认（TOFU），确认一次即可，之后记在 `known_hosts.json` 里。

**连不上时的排查顺序**（先分清是哪一段断的）

1. `ss -tln | grep ':22 '` —— WSL 里到底有没有在监听？没有就是第一步没成。
2. Windows 侧 `netstat -ano | findstr ":22"` —— 端口有没有被别的服务端（比如 Windows 自带的 OpenSSH）占着。
3. 换成 WSL 的实际 IP 试一次：`wsl hostname -I`（能通说明是 localhost 转发的问题，不是服务端问题）。
4. 密码认证被拒：`sudo grep -i passwordauth /etc/ssh/sshd_config`，确认是 `yes`。
5. 私钥认证被拒：先看 `sudo journalctl -u ssh -n 50`。应用这边连不上时会明确说是
   「读不到私钥文件」「口令不对」还是「认证失败」——**前两种都还没轮到服务端**，别去 WSL 里白查。

数据文件（可用环境变量 `SSH_CORDIS_DATA_DIR` 改目录），一律按 `0600` 写：

| 文件 | 内容 | 说明 |
|---|---|---|
| `~/.ssh-cordis/hosts.json` | 主机元数据 | **不含任何密文**——定位是「可以放心备份 / 同步 / 给人看」 |
| `~/.ssh-cordis/secrets.json` | safeStorage 密文 | 和元数据分开：导出主机列表时不会把密文一起带走 |
| `~/.ssh-cordis/known_hosts.json` | 已信任的主机密钥指纹 | TOFU 记录 |
| `~/.ssh-cordis/launch-profile.json` | 上次跑起来的那套 Chromium 配置 | 加速手段，不是数据源：损坏或版本不符就整个忽略 |

### 远端文件（SFTP）

连上之后，工具行右边的「文件」按钮会亮起来，点开是底部一个抽屉：路径条 + 目录列表。
列表里每一项都能**下载**（目录是**打开**，双击行也是同一个动作）、**删除**；
抽屉头顶有「上级 / 刷新 / 新建文件夹 / 上传…」。新建文件夹的名字在**面板里的输入框**里填，
不用系统弹窗——Electron 并不支持 `window.prompt`（`alert` / `confirm` 都实现了，唯独它没有），
用它的话桌面端点下去会什么都不发生，而浏览器里偏偏是好的。

```
┌ 主机 ─────────┬────────────────────────────────────────────────────┐
│ 生产           │ 新建主机              [保存] [删除] [文件]          │
│ ops@10.0.0.9   │ 主机 [10.0.0.9] 端口[22] 用户名[ops] 认证[密码] …  │
│                ├────────────────────────────────────────────────────┤
│                │ 已连接（远端 pty 133×28）                          │
│                │ ┌────────────────────────────────────────────────┐ │
│                │ │ ops@10.0.0.9:~$ █                              │ │
│                │ └────────────────────────────────────────────────┘ │
│                │ 远端文件  /home/ops        [上级][刷新][新建文件夹][上传…][收起] │
│                │ notes        [目录]        2026-09-16 09:41   [打开][删除] │
│                │ deploy.sh     1.2 KB      2026-09-14 22:03   [下载][删除] │
│                │ readme.md     842 B       2026-09-15 10:18   [下载][删除] │
└────────────────┴────────────────────────────────────────────────────┘
```

抽屉是**按需展开**的，不是常驻一栏：终端占满整行时是 133 列，常驻一栏就只剩 100 列
（第一版把主机列表放在左边时已经吃过一次这个亏）。开关抽屉会重新 `fit()` 一次，
远端才不会以为自己的行数还是旧的。

**「本地」永远是你面前这台机器。** 下载走 Blob，上传走 `<input type="file">`——
都是浏览器就有的东西，所以桌面端和浏览器端是同一条路。这一点是刻意选的：
如果下载交给主进程写盘，那么在 Web 载体下文件就会落到**跑后端的那台机器**上，
而用浏览器的你可能正坐在另一台机器前。渲染层的产物因此一个字都不用分叉。

两个附带的行为，都是为了让「你在哪、发生了什么」不含糊：

- 列表**从 home 开始**。`sftp` 子系统的初始目录就是用户的 home，所以「家在哪」不需要查
  passwd、也不需要服务端支持 `expand-path@openssh.com`（老的服务器不一定有）。
  路径条里也可以直接敲 `~` 或 `~/notes`，回车才跳转（失焦就跳的话，点到别处会莫名其妙换目录）。
- 排序由**后端**定：目录在前、然后按名字（大小写不敏感，同名前后的用码位兜底）。
  不用 `localeCompare`——它的结果依赖运行时带的是哪份 ICU 数据，
  同一个目录在两台机器上可能排得不一样，而用户是靠位置记东西的。

这条界面链路是**在真窗口里点过一遍**的，包括那三个原生框：上传（要过文件选择框）、
下载（要过保存框，且落盘的字节与远端**逐字节**比对）、新建文件夹（面板内输入框）、
删除（要过 `confirm`）。这几个框是操作系统的，进程内自动化一点就卡死，所以那一次
是由外部程序驱动的——页面内的动作走 CDP，框里用 SendInput 填路径 / 敲回车。
`window.confirm` 里那句「删除远端文件「/home/demo/上传给我的.txt」？此操作不可恢复。」
和保存框里预填的文件名，都在 `../termius-analysis/shots/s7-delete-confirm.png` /
`s4-save-dialog.png` 里留了证据。跑法与它断言什么，见「测试」那节的最后一段。

### 在浏览器里用（Web 载体）

同一个 `dist/renderer` 产物既能被 Electron 窗口加载，也能被浏览器加载——后者走 Web 载体。
启动日志里会打印一条带 token 的地址：

```
[main] 载体已就绪：web（浏览器入口 http://127.0.0.1:50070/?token=vpA4QVPKWPRNsc95r0vmcvQ16cWt_I6M）
[main]   只监听 127.0.0.1:50070，token 每次启动重新生成。
```

把它贴进浏览器就能用，界面与桌面端完全一样（同一份 HTML/JS、同一套协议、同一棵插件树
——连接、终端、主机列表、私钥选择都是同一批代码）。想关掉它：`SSH_CORDIS_NO_WEB_CARRIER=1`。

**这条地址等于这台机器的 SSH 权限，别往外发。** 具体挡了这些：

- **只绑 `127.0.0.1`，端口随机**；不绑 `0.0.0.0`，所以局域网里连不上。
- **取页面也要 token**。只给 WebSocket 加 token 是不够的：本机任何进程 `GET /` 就能把页面
  （连同页面里的 token）拿走。所以流程是「带 `?token=` 打开 → 下发 HttpOnly + `SameSite=Strict`
  的会话 cookie → 之后静态资源与 WS 升级都凭 cookie」，token 不进 JS、也不留在地址栏。
- **校验 `Host` 与 `Origin`**：前者挡 DNS rebinding（恶意域名解析到 `127.0.0.1`），
  后者挡住「别家页面拿你的浏览器当跳板」。
- CSP、`nosniff`、`no-store`，静态路径做目录穿越检查。

两个小差异：① 「选择私钥文件」弹的对话框在**运行后端这台机器**上（因为要给的正是这台机器上的路径）；
② 状态栏会显示当前载体（`就绪 · ipc` 或 `就绪 · web`），排查问题时先看这个。

### 受限环境里会自己站起来

有些环境（CI 容器、被宿主沙箱包裹的会话）里 Chromium 的**进程沙箱**初始化不了，
窗口永远出不来。坑在于它的表象是 GPU 崩溃——`GPU process exited unexpectedly` →
`FATAL: GPU process isn't usable. Goodbye.`——因为 GPU 进程本身也在沙箱里跑，
于是极容易被误判成「这台机器没有显卡」，然后一直在 `--disable-gpu` 这个错误方向上折腾。

应用不等你猜：一旦发现页面在渲染进程起来之前就失败（崩溃 / `did-fail-load` / 20 秒超时），
它会打一段说明并**自动以 `--no-sandbox` 重启一次**。重启走 `electron/relaunch.ts`：
新进程继承 stdio（不用 `app.relaunch()`，那个会把重启后的日志从终端里弄丢），
而且**等它确实起来了才退当前进程**——起不来就留在原地大声报错，
不会出现「既没起来新的、又把旧的关了」。

```
[main] 渲染进程起不来（渲染进程退出：killed）。
[main] 最常见的原因是 Chromium 的进程沙箱在当前受限环境里无法初始化；
[main] 将以 --no-sandbox 重启一次：渲染层仍有 contextIsolation + nodeIntegration:false +
[main] preload 白名单三重隔离，但少了操作系统级的进程隔离。
...
[main] 本次以 --no-sandbox 运行：Chromium 进程沙箱已关闭（渲染层隔离仍在）。
[shell#1] 渲染层已加载（HTML 解析完成，不代表应用可用）
[main] 渲染层就绪上报：{"ok":true,"hosts":0,"cols":133,"rows":28}
[main] 启动档案已更新（表面确认可用之后才写）：…/launch-profile.json
[main] 闸门已打开：注册在闸门上的动作现在执行。
```

**第二次启动就不必再摔一次了**：档案里记着「这台机器上次是靠 `--no-sandbox` 起来的」，
下次启动前直接带上，一次到位：

```
[main] 档案显示这台机器上次是靠「--no-sandbox」起来的，本次启动前直接带上，
[main] 读到启动档案：--no-sandbox｜放宽了进程沙箱｜终端 133x28｜主机 0 个｜记录于 …
[main] 本次以 --no-sandbox 运行：Chromium 进程沙箱已关闭（渲染层隔离仍在）。
[BOOT-OK]
```

注意档案是在**表面确认可用之后**才写的（就绪闸门，见 [ARCHITECTURE.md](ARCHITECTURE.md)）：
失败的那一代什么都不写，绝不会把「起不来的配置」记成「可用」。

「可用」在这里有明确含义，不是「页面加载完了」：preload 通了、IPC 能调、主机列表拉回来了，
而且终端**已经量准尺寸**（`settleLayout` 会等一帧再 `fit()`，之后才开始拉主机列表）。
这不是吹毛求疵——上报里的 `cols/rows` 会被写进档案当证据，
如果上报和 `fit()` 是两条互不相干的异步链，那两个数字就会时对时错，
闸门也就跟着变成装饰品。实测过：串起来之前第二次启动会报出 xterm 的默认值 `80x24`。

相关环境变量：

| 变量 | 作用 |
|---|---|
| `SSH_CORDIS_DISABLE_SANDBOX=1` | 直接关沙箱，跳过检测 |
| `SSH_CORDIS_NO_SANDBOX_FALLBACK=1` | 关掉自动重启与档案回填（想看到原始失败时用） |
| `SSH_CORDIS_NO_LAUNCH_PROFILE=1` | 完全不读也不写启动档案（需要确定性环境时用） |
| `SSH_CORDIS_DISABLE_GPU=1` | 关硬件加速（真的没有 GPU 时才需要） |
| `SSH_CORDIS_DATA_DIR` | 换数据目录 |
| `SSH_CORDIS_BOOT_CHECK=1` / `SSH_CORDIS_BOOT_SHOT=<png>` | 启动自检 / 顺便截图 |
| `SSH_CORDIS_SKIP_BUILD=1` | `start.mjs` 跳过构建，直接用 `dist/` |
| `SSH_CORDIS_LAUNCH_VERIFY=1` / `SSH_CORDIS_LAUNCH_WAIT=<秒>` | `launch.mjs` 等到日志出现终态再退出（默认 60s） |

## 三层与数据流

```
xterm.js onData ──▶ transport(选载体) ──▶ preload/ipcMain 或 WebSocket
                                        ──▶ dispatch.ts ──▶ TerminalBridge.input ──▶ ssh2 shell ──▶ 远端
远端 ──▶ ssh2 shell ──▶ TerminalBridge（16ms 合并 + 背压）──▶ RendererService.send(clientId,…)
                                                        ──▶ 载体（ipc 或 ws）──▶ xterm.write(Uint8Array)
```

渲染层与壳之间隔着一份协议（`shared/protocol.ts`）和一层载体（`electron/carrier-*.ts`）：

- **协议**只定义通道名与数据形状，**不 import 任何东西**——主进程、渲染层、测试三边共用同一份。
  字节经 `encodeWire` 打成 base64 过线（JSON 装不下字节，`JSON.stringify(new Uint8Array(...))`
  会静默变成 `{"0":1,"1":2}`）。通道名只在协议文件里写一次，谁都不许再写字面量。
- **dispatcher**（`electron/dispatch.ts`）是「协议名 → Host 调用」的唯一映射，不 import electron。
- **载体**负责搬运，并负责认定「谁在说话」：IPC 载体给 `ipc:<webContentsId>`，Web 载体给 `ws:<序号>`。
  领域层拿到的是一个**不透明字符串** `clientId`，只当句柄转手——请求类型里根本没有这个字段，
  所以客户端无法自称。
- **Electron 壳**：只建窗口、装 preload、装配载体。`nodeIntegration: false`、
  `contextIsolation: true`、`sandbox: true`，渲染层拿不到任何 Node 能力。
  壳自己不装业务逻辑，只按固定顺序调用 `platform*.ts` / `shell.ts` / `readiness.ts` 这些零件；
  窗口与其监听器的生命周期收在一个 `ElectronShellGeneration` 里，只经幂等的 `release()` 释放。
- **Cordis 宿主**：一个 Node.js 进程 + 一棵插件树。插件之间只通过 `inject` 声明依赖：
  `TerminalBridge.inject = ['ssh', 'renderer', 'sessionStore']`。服务未就绪时插件不激活，
  就绪后自动重放——不需要手写初始化顺序。对壳暴露的只有 `Host` 那一个窄接口，
  插件树本身在 `host.internals` 下，并标注「只给测试与诊断脚本」。
- **渲染层**：xterm.js 只做 ANSI 解析和渲染，通信统一走 `renderer/transport.ts`——
  有 preload 注入口就 IPC，否则 WebSocket。所以 `app.ts` 里既不出现 `window.sshAPI`
  也不出现 `WebSocket`。没有第二条 IPC 插件系统，也没有把任何 Electron API 暴露给页面。

## 从 dsh 借了什么

借的是「薄壳 + 插件树」，还有一批**去掉 agent 平面之后依然成立**的工程纪律：
平台策略启动时选一次、窗口按 generation 管理且句柄不跨代缓存、状态只在表面真正就绪后才提交、
公共契约与启动器内部细节分开、起进程的人负责那棵进程树的死活、密文与非密文分开落盘，
以及**carrier 抽象**——UI 与壳之间隔一层通道，壳不认识「UI 具体跑在哪」。

最后那条是本项目**最晚才补上**的：早先领域层的公共契约上写着 `webContentsId: number`，
Electron 的概念漏进了领域层，于是「换载体」必须改 `src/`，解耦是假的。
现在切成「协议 / 语义 / 载体」三层，验收判据很硬：**加 Web 载体时 `src/` 一行都没改**。

逐条对应到文件、以及**故意没有借**的部分（agent 平面、渲染层插件系统、
「一切都是插件」的绝对化、为 WebSocket 引第三方库）写在 [ARCHITECTURE.md](ARCHITECTURE.md)。
整个项目用到的 Cordis 能力仍然只有 Context / Service / inject / ctx.effect 四样。

## 这版相比原稿修了什么

原稿（Electron 壳 + Cordis 宿主 + 两个插件）有 3 个跑不起来的问题和 4 个跑起来也不对的问题，
这一版逐条处理：

| 原稿问题 | 这一版的做法 |
|---|---|
| `cordis: ^4.0.1` 不存在（npm 上只有 `4.0.0-rc.*`） | 锁 `cordis@4.0.0-rc.10`，node_modules 里真有这个版本 |
| ESM preload 被忽略 `type: module`，`window.sshAPI` 永远 undefined | preload 的源码是 `.ts`，用 esbuild 单独产出 **CommonJS** 的 `preload.cjs`，同时**保住** `sandbox: true`（ESM preload 必须 `.mjs` + `sandbox: false`，等于放弃隔离） |
| `loadFile` 指向不存在的 `dist/renderer/index.html` | 构建时把 HTML 复制进 `dist/renderer/`，HTML 内引用改为同目录 `./app.js` / `./app.css` |
| 用事件当 RPC：`ipcMain.handle` 不 return + `ctx.emit` 不 await → 连接错误 100% 静默 | 请求/响应改走 **服务方法**（`ctx.terminal.open()` 返回 Promise），`ipcMain.handle` 把 Promise 交还给渲染层 |
| `ctx.on('terminal:open')` 未做 `Events` 模块增强，strict 下编不过 | `declare module 'cordis' { interface Events { ... } }`，并让事件只承担广播职责（`ssh/session-opened` 等） |
| 逐块 `toString()` → 中文/emoji 乱码 | 传 `Buffer` 不传字符串；IPC 走结构化克隆变 `Uint8Array`，交给 xterm 的流式解码器 |
| 把 `getWebContents` 塞进事件参数 | 抽出「宿主 → 渲染层」的服务，插件层不再 `import electron`，可脱离 Electron 单测。后来又往前走了一步：那个服务当时叫 `ElectronService`、公共契约上写着 `webContentsId: number`——字面上没 import electron，但 Electron 的概念漏进了领域层；现在是 `RendererService` + 不透明的 `clientId` + 可替换的载体（见「从 dsh 借了什么」） |
| 无背压：`cat` 大文件会瞬间刷上万条 IPC | `TerminalBridge` 按 16ms 合并输出，队列超 512KB 就 `shell.pause()`，低于 64KB 再 `resume()` |
| `shell()` 没传 pty 参数 → 远端固定 80×24、`$TERM=vt100` | 显式 `{ term: 'xterm-256color', cols, rows }`；连接成功后渲染层再主动补一次真实尺寸 |
| 断线/退出没有任何提示 | `client` 的 `error`/`close`/`end` 与 shell 的 `close`/`error` 统一进 `drop()`，一律带 reason 通知渲染层 |
| `sessions` 只增不减 | 会话结束即从 map 移除并 `client.end()`，服务卸载时兜底 |
| 无 host key 校验 | TOFU：首次记录 SHA256 指纹，密钥变更直接硬失败并给出可操作提示 |
| 无主机列表 / 密码明文风险 | `SessionStore` 落盘，密码走 `safeStorage`（DPAPI/Keychain）加密；`list()` 不回传密文，渲染层永远拿不到明文。密文单独落 `secrets.json`（0600），`hosts.json` 里既无明文也无密文——导出主机列表不会顺带把密文带走 |
| `xterm` 包已废弃、CSS 从 CDN 拉 | 换 `@xterm/xterm` + `@xterm/addon-fit`，CSS 由 esbuild 打包进 `app.css`，页面加 CSP |
| 渲染层与壳耦合：通道名在两处各写一遍，客户端身份就是 Electron 的 `webContentsId` —— **换载体必须改 `src/`** | 切成「协议 / 语义 / 载体」三层：通道名只在 `shared/protocol.ts` 定义一次，`electron/dispatch.ts` 是唯一的语义映射，载体可替换。验收判据：**加 Web 载体时 `src/` 一行都没改**，而且它能在没有 Electron 的情况下把整条协议跑通（`test/smoke-carrier.mjs`） |
| `moduleResolution: Bundler` 配 tsc 直出 Node ESM | 用 `Bundler` 解析（`NodeNext` 会静默丢掉 cordis `.d.ts` 里没写扩展名的相对再导出，导致 `Service` 等导出「不存在」），再用 `scripts/check-esm-extensions.mjs` 在构建前强制相对导入带显式扩展名，把 Node ESM 的安全性补回来；渲染层另有一份 `tsconfig.renderer.json`，`types: []` 防止 Node 全局对象漏进渲染层 |

## 测试

这些测试都不需要你自己的服务器：`test/fake-ssh-server.mjs` 用 ssh2 起了一个本地假 SSH 服务，
会记录 pty 参数、window-change、输入，并**故意把 UTF-8 字符串切成 3 字节一块、间隔 40ms 发送**。

```bash
npm run verify          # 下面全部跑一遍
npm run typecheck       # 主进程 + 渲染层的 tsc + ESM 扩展名自检
npm run boot            # 应用能不能真的站起来（含窗口截图）
npm run smoke:runner    # 11 项：端到端 runner 的判定逻辑（纯函数，秒级）
npm run smoke:desktop   # 42 项：平台策略 / 就绪闸门 / 启动档案 / 重启 / WS 帧与线上编码（无需 Electron，秒级）
npm run smoke:host      # 32 项：宿主层（无需 Electron）
npm run smoke:sftp      # 36 项：SFTP（路径纯函数 + 真 SFTP 协议往返，无需 Electron）
npm run smoke:carrier   # 31 项：Web 载体的鉴权与完整协议（无需 Electron，秒级）
npm run smoke:profile   # 启动档案往返：真的启两次做验收（较慢）
npm run smoke:electron  # 端到端：真窗口 + 真 preload + 真 xterm 渲染（IPC 载体）
npm run smoke:web       # 端到端：真应用里的 Web 载体，外部客户端连上去开一个真会话
# 另有一条不在这个列表里（要过原生模态框，会接管真实的前台窗口，见本节最后一段）：
#   node ../termius-analysis/drive-sftp.mjs
```

`smoke:sftp` 跑在两套东西上：一半是**纯函数**（远端路径收敛、目录排序、SFTP 报错翻译表），
另一半是**真的 SFTP 协议**——`test/fake-sftp-server.mjs` 里有一个内存文件系统和一个假 `sftp-server`，
它能列目录、开句柄、读、写、建目录、删东西，并且有**三处刻意和 OpenSSH 对齐**，
因为那三处正好是客户端最容易想错的地方：

1. `READDIR` 的结果里**带上 `.` 和 `..`**（真的 OpenSSH 就会给）——于是客户端那层过滤是真的被考了，
   而不是因为服务端没给才「碰巧没问题」。
2. `REALPATH` 对**不存在的路径**回 `NO_SUCH_FILE`——于是「只 realpath 父目录再拼名字」
   那条设计被真验到了。上传新文件、新建目录的目标恰恰就是还不存在的路径。
3. 软链的目录属性是 **lstat 的结果**，看不出它指向文件还是目录——
   客户端为此在列表里补的那次 `stat`（让 isDirectory 说的是「点它会怎样」）
   与删除时的 `lstat`（删链接本身，而不是它指向的文件）才有意义。

用例断言的不只是「函数没抛错」，而是**对端的内存文件系统真的变成了那个样子**，
以及 `server.sftp.requests` 里确实出现过 `REALPATH` / `OPENDIR` / `OPEN` / `WRITE` / `CLOSE`——
只断言「内容对」是不够的，那条路可能根本不是 SFTP。

`smoke:carrier` 是**解耦带来的直接收益**：协议、dispatcher、载体这三层都不 import electron，
于是可以在普通 Node 里起一套真的东西——真 `Host`（真插件树、真 ssh2 客户端指向本地假 SSH 服务）+ 真
`carrier-http`，再用 Node 自带的 `WebSocket` 当客户端把整条路跑完（31 项，秒级）。
它覆盖：token / cookie / `Host` 头三道鉴权的正反面、目录穿越、静态资源、
请求与响应按 id 配对、单向通知、事件推送、认证失败双通道报错、
**字节过线后仍是字节**（中文无 `U+FFFD`；SFTP 上传/下载的 256 个字节值也一个不差）、
以及「不认识的报文要显式失败而不是被静默吞掉」。

SFTP 那几项放在这里而不是只放在 `smoke:sftp` 里，是有意的：`smoke:sftp` 走的是
「测试直接调 `Host`」，**没有过线**；而文件内容在线上要被打成 `{ $bytes: base64 }`，
那一步是「静默把数据搞坏」最可能发生的地方。两处都测，这条环才闭上。

`smoke:web` 回答的是另一个问题：**Web 载体是不是只活在测试里**。
它会起真的 Electron（就是 `npm start` 那条路），从日志里抠出带 token 的地址，
然后拿它当外部客户端用——HTTP 取页面、WebSocket 跑协议、开一个真终端。
它和 `smoke:electron` 用同一套退出码语义（`0/1/2`，见下表）。

`smoke:desktop` 里的 WS 帧与线上编码那 12 项是**纯函数**测试：三种长度档位、分包到达、
多帧连读、未掩码的客户端帧、超长声明、`Uint8Array` 打成 `$bytes` 的往返、
以及用**字面量**反向断言通道名（改一个就红——那才是「界面点了没反应」的来源）。

`smoke:desktop` 之所以存在，是因为这次重构刻意把「架构决策」和「碰 app 才能做的事」切开了：
`electron/platform-plan.ts` / `readiness.ts` / `launch-profile.ts` / `relaunch.ts` 都不 import electron，
于是能在普通 Node 里直接跑。它覆盖：平台开关的选择与去重、就绪闸门在 `ok:false` 时**拒绝**放行状态提交、
档案的损坏/版本不符/字段互相矛盾时一律忽略、以及重启时「新进程起不来的话绝不交出所有权」。

`smoke:profile` 是那条「状态只在表面真正就绪之后才提交」纪律的端到端验收：同一个数据目录连启两次，
断言第一次只有**成功起来的那一代**提交了档案，第二次不再走「失败一次再重启」，并且确实按档案带上了开关。

`boot` 与 `smoke:electron` 分工不同，别混：`boot` 只问「应用自己的生产代码路径能不能跑起来」
（preload 通、xterm 挂载、主机列表拉回来），`smoke:electron` 在此之上再驱动一次真实的 SSH 会话。
`boot` 默认**不施加任何 Chromium 开关**——就是 `npm start` 的真实条件——所以它会顺带走一遍
上面那条自动回退路径；成功时会把窗口截图写到 `dist/boot-check.png`。

`smoke:runner` 单独测「怎么判定通过/失败/环境不支持」这件事本身。这不是形式主义：
`smoke:electron` 在受限环境里会返回「环境不支持」，如果判定写得松，它就会把**真实的代码缺陷
也一并报成环境问题**，让 bug 悄悄溜过去。所以判定被抽成纯函数 `test/runner-decision.mjs`，
并有 11 项测试锁死「真实失败永远优先于环境限制」这条规则。

`smoke:electron` 测每个配置时会设 `SSH_CORDIS_NO_SANDBOX_FALLBACK=1`，**故意关掉**应用的自动回退：
它要逐个配置地观察真实行为，不能让第一个配置自己重启、留下孤儿进程、还把输出混进后面配置的判断里。

`smoke:host` 覆盖：pty 参数透传、分片不乱码（并反证「逐块解码必碎」）、输出合并、resize 的
rows/cols 顺序、输入回显、主动断开、认证失败、端口不通、渲染层不可用、TOFU 记录与不重复记录、
渲染层消失后会话收尾、**密文只落 secrets.json 而 hosts.json 里既无明文也无密文**、
用保存的密码连接、删主机时密文一并删除、旧版 `hosts.json` 里的 `sealedSecret` 自动迁移、
服务端踢连接、密钥被替换时硬失败、日志插件确实挂在插件树上、卸载宿主时连接归零且 `dispose()` 幂等。

**私钥认证**那 9 项值得单独说，因为它们的断言重点不是「连上了」，而是「走对了路」：
密码分支同样能让连接成功，所以只断言 `openTerminal` 没抛错的话，
「切到私钥认证之后其实还在用密码」会一路溜过去。假服务端因此会**记账**——
用例断言的是 `state.auth.accepted === 'publickey'`，并且 `attempts` 里**没有** `password`。
另外几项分别锁住：加密私钥填对口令能连、口令填错和不填给出**两种不同**的提示
（用户下一步该做的事不一样）、路径不存在时报错**带上路径**、
选了个不是私钥的文件时提示重新选（而不是让人去猜口令）、什么都没给时明说缺凭据、
记住口令后重连不用再填且明文哪都不落盘、切换认证方式时旧凭据被清掉。

这几个报错用例还有一个共同的第二断言：**底层的英文原文不许漏给用户**。
写它们的时候就是这么抓出两个真 bug 的——一个是 ssh2 的实际文案是
`Encrypted private **OpenSSH** key detected, but no passphrase given`，
正则要求那几个词紧挨着，于是永远匹配不上；另一个是 `client.connect()` 把私钥解析失败
**同步抛出**（不走 `error` 事件），那条路径当时根本没有过翻译，
用户看到的是 `Cannot parse privateKey: …` 原文。两个都只有真的去跑才看得见。

私钥夹具在 `test/fixtures/`（弃用密钥，只能连本地假服务端），provenance 见该目录的 README。

还有两项专门守**报错翻译**，因为文案是精确匹配出来的、抄错一个词就会静默失效：

- **表驱动测试**：`normalizeSshError` 被导出，用例拿**真实的 ssh2 文案**逐条过一遍
  （`Connection lost before handshake` / `Encrypted private OpenSSH key detected, …` /
  `Failed to generate information to decrypt key` / `Unsupported key format` …），
  断言每条都翻成预期的那句中文，**且译文里不残留英文原文**。
- **端到端复现**：起一个「接受 TCP 后延迟 300ms 再关闭、一个字节都不发」的裸 socket 服务，
  复现那条 `Connection lost before handshake`，断言界面说的是「没给出 SSH 横幅」
  **并且明确排除「是不是我密钥不对」这个方向**。

  延迟这一步是必须的：立刻 `destroy()` 得到的是 `read ECONNRESET`，是另一条错误，
  复现不了这条（ssh2 的判据是 `wasConnected && !sawHeader`，得先让它认为连上了）。

`smoke:electron` 证明的是最容易翻车的三件事：preload 真的加载了（`typeof window.sshAPI === 'object'`）、
HTML 路径真的对、字节流经过真实 IPC 与真实 xterm 之后**没有出现一个 U+FFFD 替换字符**。

退出码是有语义的，便于接 CI：

| 退出码 | 含义 |
|---|---|
| `0` | 通过 |
| `1` | 真实失败（渲染层已回传报告但断言没过，属代码缺陷） |
| `2` | **环境不支持**：所有开关组合都无法建立渲染进程，测试被跳过 |

`smoke:electron` 会按「默认（带沙箱）→ `--in-process-gpu` → `--no-sandbox` → …」的顺序逐套试
Chromium 开关，只有**全部**被环境挡住才返回 `2`，不会把「跑不起来的环境」误报成「代码有 bug」。
用了放宽沙箱的组合会额外打出显式警告，避免让人误以为「带沙箱的真实配置」已被验证。

**注意**：`--disable-gpu` 之类的 GPU 方向开关，很多时候是在治错的病。实测（见下）
真正卡住渲染进程的是 **Chromium 的进程沙箱**（容器/受限会话里 user namespace 不可用），
而 GPU 进程崩溃只是沙箱初始化失败的表象。所以 `--no-sandbox` 才是这类环境里的关键开关。

### 那三个原生框：只能在进程外驱动

SFTP 这条路上有三个**模态框**——上传的文件选择框、下载的保存框、删除的 `confirm`。
它们是操作系统的框（或 Chromium 自己的模态层），不是页面的一部分，所以在进程内自动化里
一点就卡死：`smoke:electron` 的钩子点一下「下载」就再也回不来了。
于是这一层单独跑，由外部程序驱动：

```bash
# 驱动脚本和分析用的 tooling 放在一起（它要复用那套 SendInput / 截屏工具）
node ../termius-analysis/drive-sftp.mjs
```

页面内的动作走 CDP（尤其是 `Input.dispatchMouseEvent`——走 Chromium 的命中测试，
而不是 `element.click()`，后者会绕过「这个元素真的在鼠标底下吗」）；框里用 SendInput
填路径、敲回车。两处判据是不靠猜的：

- **坐标**由页面自己用 `getBoundingClientRect` 量出来，不存在「估算坐标」这件事；
  换算对不对由「点下去 DOM 状态真的变了」自证。
- **「框起来了」**同时看两个互相独立的信号：顶层窗口名单里多了新 HWND（操作系统那一侧）
  与渲染进程连续两次不回应求值（页面那一侧）。两个都等不到才判失败。

它断言的方向也是两条线：**界面上说成了** 与 **对端真的变成了那个样子**
（`server.files.dataOf(...)` 的字节、`server.sftp.writes/mkdirs/removals` 的记账）。
只断言前者等于没测——界面可能只是乐观地写了句「已上传」；只断言后者也等于没测——
那条路可能根本不是 SFTP。顺带还验了一条安全边界：**删软链只删链接，指向的文件还在**。

它**不进 `smoke` 链**，因为它会接管真实的鼠标、键盘焦点和前台窗口——
一条会自动抢你前台的测试不该在 `npm run verify` 里跑。跑完它会自己收尾
（杀掉自己起的 Electron、删掉临时数据目录），并且会比对 `~/.ssh-cordis`
**跑前跑后一字未改**。

### 渲染环境诊断

不知道本机该用哪套开关时，先跑：

```bash
npm run diagnose:electron
```

它只开一个 `data:` URL 的最小窗口，逐个组合报告时间线——**窗口创建 → 页面加载 →
渲染进程是否真的执行了 JS**——并直接给出可用组合与对应的 `SSH_CORDIS_SMOKE_SWITCHES` 值。
它不依赖本项目构建产物，因此能把「Chromium 起不来」和「我们的代码有问题」彻底分开。
想试自定义组合：`node scripts/diagnose-electron.mjs -- "--no-sandbox"`。

### 当前验证状态

| 检查项 | 结果 |
|---|---|
| `tsc` 主进程 + 渲染层 | 通过 |
| ESM 扩展名自检 | 通过 |
| `boot`（应用能否起来，`npm start` 同条件） | **通过**，窗口已渲染并截图 |
| `smoke:runner` | **11/11 通过** |
| `smoke:desktop` | **42/42 通过**（纯逻辑，无需 Electron） |
| `smoke:host` | **32/32 通过**（真 socket + 真 ssh2 假服务端） |
| └ 其中私钥认证 | **9 项**：publickey 真走通（服务端记账确认）、加密私钥、口令错/未填的两种提示、坏路径、非密钥文件、缺凭据、记住口令、切方式清凭据 |
| `smoke:sftp` | **36/36 通过**（路径纯函数 + 真 SFTP 协议往返，无需 Electron） |
| `smoke:carrier` | **31/31 通过**（真 HTTP + 真 WebSocket + 真 Host，**无需 Electron**；含 SFTP 过线后字节仍是字节） |
| `smoke:profile` | **通过**（真启两次；第二次不再回退） |
| `smoke:electron` | **通过**（IPC 载体） |
| `smoke:web` | **4/4 通过**（真应用里的 Web 载体：外部客户端连上去开了一个真会话） |
| 正常桌面会话、**沙箱完好**启动 | **通过**（`switches: []`、`sandboxWeakened: false`、窗口 `SSH Cordis Client` 真实存在） |
| SFTP 界面端到端（真窗口 + 三个原生框） | **42/42 通过**（`drive-sftp.mjs`，截图在 `termius-analysis/shots/s1…s9`） |
| `npm run verify` 整体 | **退出码 0**（typecheck + boot + 8 步 smoke 串行全绿，35s） |

`boot` 的实际输出——**一次到位，没有走回退那一轮**（默认配置、沙箱完好）：

```
[platform] 非 macOS：关掉最后一个窗口即退出；不装 macOS App 菜单
[main] 没有可用的启动档案（首次运行，或档案损坏/版本不符）。
[main] 已创建 shell generation #1
[main] 宿主已就绪。数据目录：C:\Users\ausu\AppData\Local\Temp\ssh-cordis-boot-14YYuk
[shell#1] 渲染层已加载（HTML 解析完成，不代表应用可用）
[main] 渲染层就绪上报：{"ok":true,"hosts":0,"cols":133,"rows":25}
[main] 启动档案已更新（表面确认可用之后才写）：…/launch-profile.json
[main] 闸门已打开：注册在闸门上的动作现在执行。
[BOOT-OK]
```

（受限环境里的输出是另一副样子——第一代被进程沙箱挡住、自动以 `--no-sandbox` 重启、
第二代才跑通；那段日志见上面「受限环境里会自己站起来」。）

`smoke:profile` 的实际结论（第二次启动一次到位，没有回退那一轮）：

```
[profile] 本机直接用默认配置就起来了
  ok   第一次启动成功（[BOOT-OK]）
  ok   第一次启动只提交了 1 次档案（实际 1 次）
[main] 读到启动档案：(无额外开关)｜沙箱完好｜终端 133x25｜主机 0 个｜记录于 2026-09-15T…
  ok   第二次启动成功（[BOOT-OK]）
  ok   第二次不再走「先失败一次、再自动重启」那一轮

启动档案往返验证通过：状态只在表面真正就绪之后提交，且下次启动直接复用。
```

`smoke:electron` 的实际证据（`replacementChars` 为 0 是关键）：

```
[SMOKE] {"preloadType":"object","sessionId":"ssh-1","openedSize":{"cols":100,"rows":30},
         "text":"greeting: 你好，世界 🌍\nsplit: 中文字符串\necho:ls\n连接已结束：用户断开连接。",
         "replacementChars":0,"closedReason":"用户断开连接。","error":null}
[SMOKE-OK]
```

`smoke:web` 的实际证据（真应用里，外部客户端连上去开了一个真会话）：

```
[main] 载体已就绪：web（浏览器入口 http://127.0.0.1:50070/?token=…）
[ws] 客户端 #1 已连接（来自 127.0.0.1，当前 1 条）
[host] 首次记录 127.0.0.1:50069 的主机密钥指纹 SHA256:Fsy8OK1gQAieFLzB3nvSyoA/NtyHHhvEO/MDrgz/+AY
[host] ssh-1 已连接 127.0.0.1:50069
  ok   真应用 · 打印出的地址带 token、且只绑回环
  ok   真应用 · 外部 HTTP 客户端能取到页面（凭 token）
  ok   真应用 · 不带 token 取不到页面
  ok   真应用 · 外部客户端能建立 WebSocket 会话并跑通协议

4/4 通过
```

注意这条路径下 `[shell#1] 渲染层已加载` 与终端会话是**并行**的：那个 `ssh-1` 是浏览器侧客户端开的，
不是窗口里的渲染层开的——两条载体各自独立，共用同一棵插件树。

**「带沙箱的默认配置」已经端到端跑通了**（曾经是这里最后一条未验证项）。

之前一直跑不通的原因不在应用，而在**验证它的那个环境**：开发容器里 user namespace 不可用，
Chromium 的进程沙箱初始化不了，所以只验证到「自动检测并回退」。换到正常桌面会话再跑，
一次就过——`~/.ssh-cordis/launch-profile.json` 是这样写下来的：

```json
{
  "version": 1,
  "switches": [],
  "sandboxWeakened": false,
  "renderer": { "cols": 133, "rows": 28 },
  "hosts": 0,
  "savedAt": "2026-09-15T12:23:28.824Z"
}
```

`switches` 是**空的**、`sandboxWeakened` 是 **`false`**、`renderer` 有真实尺寸——
含义是：**一个开关都没加、沙箱完好、而且一次就成功**（没有走「先失败一次再重启」那一轮，
否则日志里会有回退标记，而档案也不会是这份内容）。同一时刻进程侧的证据：

```
pid=44948  handle=2036038  title='SSH Cordis Client'   ← 真实顶层窗口
```

所以：受限环境里那套 `--no-sandbox` 自动回退**不会被误触发**，健康桌面上沙箱保持开启。

## 已知限制

- 私钥认证已通（选文件 / 私钥口令 / 记住口令；见「认证方式：密码 / 私钥」），但**只支持按路径现读**。
  界面上不能把私钥内容直接粘进来（后端 `privateKey` 字段是支持的，只是没做这个输入框）。
  对 `~/.ssh` 下的密钥来说按路径读就够了，粘贴反而多一份明文留在剪贴板/界面里的风险。
- 密文槽只有一份：一台主机要么记密码、要么记私钥口令，不能两个都记。
  换认证方式时旧的那份会被清掉——这是有意的（见「认证方式」那节），代价是来回切换要重填一次。
- 主机密钥变更后需要在 `known_hosts.json` 里删除对应记录再重连（`ssh.forgetHostKey()` 已在服务里备好，还没接 UI）。
- **SFTP 单文件上限 4 MiB**，超过直接拒绝（不截断）。内容整份在内存里、
  还要过一遍 base64 + JSON，而 WebSocket 载体单条报文上限是 8 MiB
  （`electron/ws-frame.ts` 的 `MAX_MESSAGE_BYTES`）；越过那条线，Web 载体上会先断在帧解码，
  报的是「报文过大」而不是「文件太大」，用户根本查不出来。上限定义在 `shared/protocol.ts`
  的 `MAX_TRANSFER_BYTES`，**两端共用同一个常量**：渲染层在点「下载」之前就拿列表里的大小拦下来，
  后端再拦一道。大文件要真正可用得改成**分块流式**（读一段、发一段、写一段），那是另一件事。
- SFTP 传输**没有进度条**，也没有断点续传——一次请求一次响应，中间没有可报告的位置。
  小文件下没关系，这也是 4 MiB 上限的另一层理由。
- SFTP **不能重命名**（`RENAME` 没接）。同样没做的还有改权限、改属主、跟随软链建链接。
- SFTP 新建目录**不递归**（`mkdir -p` 那种）：父目录必须已经存在。
  递归建的话「失败在哪一层」说不清，而说不清的错误正是这个项目最想避免的。
- 远端删除**不进回收站**，界面上只问一句 `window.confirm`。删除是远端行为，
  我们看不到那边的回收站，所以只能这样——但也正因为不可恢复，确认框里会把完整路径写出来。
- 端口转发、多标签页未实现——它们都是增量插件，按同样的 Cordis 服务模式加即可。
- **Web 载体的 token 每次启动重新生成**，所以重启应用后旧标签页会连不上，
  控制台里那条新地址要重新打开一次（这是刻意的：token 不落盘、不复用）。
- Web 载体**不做多客户端隔离**：所有连上的浏览器看的是同一份主机列表、同一批已保存凭据，
  它们只是同一个后端的几个界面。这个载体是「换台机器也能用同一个后端」，
  不是「多用户服务」——别把它暴露到回环之外。
- Web 载体的「选择私钥文件」弹的是**运行后端那台机器**上的文件对话框
  （因为要给的正是这台机器上的路径）；如果后端跑在别的机器上，这个按钮就没意义。
- 自带的 WebSocket 服务端（`electron/ws-frame.ts` + `ws-server.ts`）只实现我们两端真的用到的
  那个子集：不协商扩展（`permessage-deflate` 等）、不校验文本帧的 UTF-8 合法性。
  鉴权在握手**之前**完成，所以未授权的连接进不到解析器；但它不是通用 WS 服务端，别拿去复用。
- ~~「带沙箱的默认配置」尚未端到端跑通~~ —— **已解决**，见上一节：正常桌面会话里
  `switches: []` + `sandboxWeakened: false` 一次成功。受限容器里仍然只会走到回退路径。
- 真实 sshd 未测过；目前的 SSH 覆盖全部打在 `test/fake-ssh-server.mjs` 上（它是真 socket、真 ssh2 协议）。
- 应用菜单被换成了最小集合（只有「编辑」；macOS 多一个 App 菜单）。
  这是有意为之——默认菜单里的 Reload 会掐掉所有会话，缩放会打乱 xterm 的行列计算——
  但也就没有了 `Ctrl+R` 重载和 DevTools 快捷键。调试时可以用 `npm run smoke:electron` 那类带开关的启动方式。
- 自动回退开的 `--no-sandbox` 只为让应用在受限环境里能用；健康桌面上不会触发，沙箱保持开启。
  想强制关掉回退与档案回填：`SSH_CORDIS_NO_SANDBOX_FALLBACK=1`。
- **档案不区分运行环境**：它记的是「这台机器上次哪套配置起来了」，不记「在哪个环境里起来的」。
  所以在受限容器 / CI 里跑过一次，档案会写下 `sandboxWeakened: true`，
  之后同一台机器上的健康桌面启动也会照着放宽沙箱——虽然那里本来不需要。
  真遇到这种串味，删掉 `~/.ssh-cordis/launch-profile.json` 即可（它只是加速手段，删了照样能启动）；
  在受控环境里跑请显式给 `SSH_CORDIS_DATA_DIR` 分开存，别和日常那份混用。
- `settleLayout` 有个 250ms 兜底：窗口万一不出帧，上报不会一直等下去，此时量到的尺寸可能不准。
  档案里的 `cols/rows` 目前只作记录，没有任何判断读它，所以这个取舍是安全的。
