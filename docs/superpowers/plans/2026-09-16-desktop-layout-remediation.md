# Desktop 目录与验证整改方案

**状态：已实施并验证，2026-09-16。** 本地分支 `chore/desktop-layout-remediation`；未提交、未推送。

**目标：** 修正 LAYOUT-PROPOSAL 的事实与执行问题，把现有 Electron 应用整理成可继续开发、可从克隆验证的 desktop 工程。

**授权与基线：** 用户已要求“出一个整改方案然后实施”。从 `907e940` 开始，在本地整改分支实施；依据为[上一轮布局评审](../../reviews/layout-review-2026-09-16.md)。修改工作目录内的现有代码，不提交或推送远程。

**技术栈：** 保留 Electron、TypeScript、Cordis、ssh2、xterm、esbuild 和 npm lockfile；测试优先使用 Node 自带测试能力和真实本机 SSH/HTTP/WS 协议，不新增测试框架。

## 设计决策

只修文案不能解决依赖约束与不可复现验证；照抄上游多包结构会引入当前没有的安装边界。本轮采用单应用、按职责整理目录、自动检查实际依赖的方案。

保留现有进程内 Host、IPC/Web 两条载体及共享协议；不改变 SSH/SFTP 产品行为和数据目录，不引入独立 Host 子进程、客户端插件系统、workspace、安装更新机制。上游与本项目的差异在架构文档明确记录。

目标目录：

```text
pureterm/
  README.md
  LAYOUT-PROPOSAL.md                 已采纳的整改决策与实施指引
  apps/desktop/
    package.json / package-lock.json / .gitignore
    README.md / tsconfig*.json
    src/                           Cordis 宿主、业务及公共 Host 门面
    shared/                        载体无关协议
    renderer/                      浏览器页面与传输适配
    electron/
      app/                         main、shell、platform：允许 Electron
      runtime/                     平台决策、就绪、档案、重启与资源路径
      bridge/                      dispatcher：只调用 Host 公共接口
      carriers/                    IPC、HTTP/WS、preload 与合成桥
      diagnostics/                 应用进程内的 boot/smoke 钩子
    scripts/                       应用构建、启动、边界检查
    tests/                         跟随代码的测试和夹具
  docs/
    architecture.md
    reviews/                       历史评审，注明基线与旧路径
    archive/                       原始布局提案
    research/termius/               报告、模板和图片资源
    superpowers/plans/              本方案与执行记录
  tools/gui/                       可选 GUI 调研与验收工具
```

约束：业务层不依赖 Electron；renderer 不导入 Node 或宿主实现；shared 不依赖任一运行侧；electron 对 src 仅通过 host.ts；纯运行时决策和 dispatcher 不导入 Electron。Electron app、IPC、preload、诊断钩子允许使用必要的 Electron API。公共 RendererBridge/Handle 从 Host 门面导出，生产壳禁止访问 Host.internals。

## 执行任务与验收

- [x] **1. 找回测试并记录原始基线。** 检索 Git 全历史及本机项目目录中的原始 smoke 文件；若无法找回，在方案中明确记录并补写有意义的替代验证，绝不沿用历史通过计数。类型检查/构建基线已在上一轮通过，复核 smoke 缺失。为后续机械迁移建立能执行的协议、启动决策、Host/SSH/SFTP/carrier 测试。
- [x] **2. 增加可执行的边界约束。** 新增 `scripts/check-boundaries.mjs`，用 TypeScript AST 识别静态/动态 import、export、require 和 internals 访问。用临时小工程测试合法依赖与禁止依赖的接受/拒绝，先验证测试能检出违规，再接入 typecheck。测试不能只搜索生产源码是否含某一行。
- [x] **3. 整理应用与 Electron 分层。** 应用整体迁入 apps/desktop，应用依赖与 scripts 留在其中；按上述分层移动文件并改所有 import。集中处理 main 的资源定位，更新 package main/start、构建 preload 输入输出、tsconfig exclude、ESM 检查例外及各启动脚本。迁移后先运行 typecheck、干净 build 和已有测试。
- [x] **4. 整理文档与工具。** 历史原提案保留归档；根提案改为准确的已采纳决策。更新根与应用 README、架构文档，删除误读与无法复现的历史通过声明。研究资源与报告同目录；GUI 工具改为按脚本位置定位仓库资源，清理旧机器绝对路径。同步截图、日志与构建产物的忽略规则。
- [x] **5. 补齐迁移回归。** 验证构建产物路径在非应用 cwd 下仍正确；验证 preload 的 CJS 产物、HTML/JS/CSS 资源存在；验证冒烟入口实际存在并运行。需要 Electron 的检查独立列出，禁止把环境限制记成通过。
- [x] **6. 完整验证与独立评审。** 执行最终 typecheck/build/Node 测试，尽可能运行真实 Electron boot、IPC、Web 检查；独立 reviewer 核查方案、diff、边界规则与迁移遗漏，修复重要发现，再报告实际结果和限制。

## 命令与通过条件

从仓库根统一使用 `npm --prefix apps/desktop ...`；应用内原命令保持可用。类型检查命令必须同时运行 Node/Electron 面、browser 面、ESM 后缀与依赖边界检查。构建必须清理本应用旧 dist 后依次生成 main、CJS preload、renderer，不能靠旧输出掩盖路径错误。

Node 测试必须覆盖：就绪后才能提交档案、Web 编码能保持二进制、Host 插件树能卸载、真实本机 SSH/终端与 SFTP 往返、Web carrier 鉴权及请求映射、非法依赖拒绝。启动验证必须观察实际 renderer-ready/boot 成功信号，不以进程存在代替成功。

变更不触碰用户 SSH 数据和真实远端主机。所有测试自建临时目录、随机回环端口，并清理自己的资源。GUI 鼠标键盘驱动属于可选工具，不纳入自动 verify。

## 执行记录

### 基线与实施结果

Git 的两个历史提交及检索的本机项目/WorkBuddy 工作目录均未找到原始 smoke 文件。迁移前 typecheck/build 可通过，但 `smoke:runner` 因入口缺失失败。因此当前 `tests/` 是本轮补写的验证基线，已加入 Git 暂存区，测试目录不再被忽略；没有恢复或沿用历史通过次数。

应用、Electron 职责分层、构建入口与资源路径已按方案迁移。依赖版本和锁文件内容不变，npm 包名仍保留 `ssh-cordis-client`，用户数据仍使用原目录。`RendererBridge` / `RendererHandle` 通过 Host 门面公开，载体不再直接引用业务内部模块。

原提案已归档；根 README、应用 README、目录决策与架构文档已重写。11 个 GUI 工具迁至 `tools/gui/`，报告、模板与 9 张图片迁至 `docs/research/termius/`。Node 工具语法检查、8 个 Python 文件语法解析和 22 个文档链接校验通过；图片与原 Git 内容一致，HTML 内容保留（仅换行格式可能不同）。GUI 工具使用脚本位置定位项目，并支持配置 Electron、Python 和窗口目标。

### 最终验证

环境：Windows / PowerShell，Node.js `v24.18.0`，npm `11.16.0`。以下命令从仓库根实际运行，退出码均为 0：

```powershell
npm --prefix apps/desktop run verify
npm --prefix apps/desktop run verify:electron
git -c core.safecrlf=false diff --cached --check
```

`verify` 完成 Node/Electron 与 renderer 类型检查、ESM 后缀检查、AST 边界检查、干净构建，以及 **70 项测试，0 失败、0 跳过**：

| 测试组 | 通过数 | 主要证据 |
| --- | ---: | --- |
| AST 依赖约束 | 26 | 合法门面导入通过，跨层导入、createRequire、内部访问被拒绝 |
| 运行资源 | 2 | 非应用 cwd 定位、package 入口、页面资源、CJS preload |
| boot CLI 回归 | 4 | 成功后失败/非零退出/未处理拒绝仍失败，超时回收父子进程与临时目录 |
| Electron runner 判定 | 7 | 成功与失败优先级、退出状态、就绪证据、环境限制 |
| desktop 纯逻辑及协议 | 13 | 平台决策、就绪、真实 Node 子进程交接、WS frame 与二进制编码 |
| 启动档案 | 6 | 持久化、无效档案、就绪门控和写入错误 |
| Host / SSH | 5 | 真实本机 SSH、UTF-8/PTY、TOFU、凭据、卸载 |
| SFTP | 4 | 路径与二进制往返、链接删除、大小限制、会话生命周期 |
| HTTP / WebSocket carrier | 3 | 访问控制、真实 Host 请求和事件、精确二进制往返 |

`verify:electron` 再次干净构建后通过 **boot、IPC、Web 三组真实 Electron 检查**。boot 观察到生产 main 的 renderer-ready；IPC 验证实际 preload 和 SSH 终端字节流；Web 在无 preload 的 Chromium 页面中使用生产 HTTP/WS 载体，验证同一 renderer 和 SSH 往返。三组均输出成功标记并正常退出，未将环境限制计为成功。结束后本应用 Electron 进程数为 0，runner 临时目录数为 0。

### 独立评审与修复

独立 reviewer 核对了迁移差异、路径、边界规则和测试断言。下列发现均已修复并复审确认：

- AST 原规则漏掉 `internals` 解构及 namespace/default/direct `createRequire` 用法；先用违规夹具复现，再补齐识别。
- 旧 boot 只检查成功标记，会忽略后续失败、非零退出和超时；改为共用严格 runner，并用真实 CLI 子进程反例验证。
- runner 未识别生产代码实际输出的 `unhandledRejection`；纯判定与 CLI 两层反例先失败，修复后通过。
- boot 超时处理可能留下后代进程或等待继承管道；新增有界进程树回收，实际启动父子 Node 进程验证回收和临时目录删除。
- 可选 GUI 驱动的 finally 可能覆盖异常退出码；异常记录为失败，最终处理只提升失败状态。

最终独立复审未发现剩余重要问题。全部修改保留在本地整改分支并已暂存，未创建提交或推送。

### 验证边界

Electron 检查使用隐藏窗口、临时应用数据和临时 Chromium 用户目录，关闭自动无沙箱回退以确保回收。已验证回退决策与 Node 子进程交接，但没有执行两代真实 Electron 的自动回退验收。`smoke:profile` 是纯档案测试，不代表真实应用连续两次启动。

本机隐藏窗口无法获取 capturePage 截图，boot 报告截图失败；实际 renderer-ready 和正常退出检查通过，没有输出不存在或旧的截图路径。测试也观察到非致命 Chromium GPU 日志，IPC/Web 的终端内容与就绪断言仍通过。

本轮未运行鼠标键盘 GUI 流程，也未验证实际远端 sshd 的兼容性、安装包或自动更新。这些能力不属于本次目录与验证整改的完成范围。
