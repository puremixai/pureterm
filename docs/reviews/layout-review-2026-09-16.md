# LAYOUT-PROPOSAL 准确性评审

评审日期：2026-09-16。结论：**方向部分正确，事实依据与执行方案需要修订，不宜原样实施。**

PureTerm 基线为 `907e9404200f5e93d826d21882b473b724bb6de9`；上游对照固定到提案指定的 `0d1f50007f9bca3f52b06e1c3074fa14d5fb0720`，不混用其他版本或第三方 desktop 分支。本报告评估目录提案及其引用的 desktop 理念，不是正式 HLD 准出审查，也没有执行目录迁移。

## 1. 可以保留的判断

- 不照搬大仓库的两级 packages、数百个 workspace、文档多语言配套，符合当前项目规模。
- 现有 `shared/protocol.ts`、`electron/dispatch.ts`、两种 carrier 已分别承担协议、调用映射、消息传输；`src/` 没有 Electron 运行时依赖。这些实际边界比目录名重要。
- Cordis 的价值已体现在服务依赖、插件装配和资源随作用域卸载。`src/host.ts:88` 的 createHost 装配插件，`:113` 起的 dispose 路径卸载整棵树；SSH、TerminalBridge 和 HostLog 各自管理连接、定时器及事件监听。
- 应用、文档、研究工具分开有助于查找；采用 `apps/desktop` 是合理选择，但不是复用 Cordis 或实现 desktop 的先决条件。
- 暂不拆成多个 npm 包可以保留；是否抽出模块或接口，应另按当前使用者和变化原因判断。

## 2. 必须修正的执行问题

### F1：A1 的 Electron 导入规则与目标结构自相矛盾

提案 `LAYOUT-PROPOSAL.md:176` 将 main、shell、platform 放到 `electron/app/`，但 `:185` 又要求这个目录出现 Electron import 就失败。这三个文件目前第 1 行都导入 Electron，分别负责应用、窗口和平台菜单等职责，不能禁止。

应允许 Electron 适配层调用 Electron，限制宿主业务、dispatcher 和纯决策模块调用 Electron。如果纯决策和适配代码仍放同一目录，需要文件级规则或进一步区分目录。目录存在本身不构成依赖约束，规则还要接入实际执行的检查命令。

### F2：A1 漏列运行时路径与编译配置

提案 `:187` 的迁移影响面不完整。`ssh-cordis-client/electron/main.ts:49` 根据自己的文件位置计算 renderer 目录和 preload 路径；移动到 `electron/app/` 后，沿用原公式会定位到 `dist/electron/renderer` 及 `dist/electron/app/preload.cjs`。renderer 目录同时用于窗口 HTML 和 Web 静态服务（同文件 `:352`）。

还须同步处理：

- `tsconfig.main.json:10` 对旧 preload 路径的编译排除。
- `scripts/check-esm-extensions.mjs:34` 对 preload 的精确路径例外。
- `scripts/build-preload.mjs:18` 的输入位置和输出位置。
- `package.json:13` 的 start 命令，以及 launch、boot 等入口；不能只改 package 的 main 字段。

这仍可作为不改变产品行为的迁移，但必须列出完整的构建输出与运行时资源映射，再验证启动、preload、IPC 和 Web 加载。

### F3：A2 将应用脚本提到根目录，会改变依赖解析

提案 `:203` 将所有应用 scripts 移到仓库根。当前 `build-renderer.mjs:1`、`build-preload.mjs:1` 导入 esbuild，`boot-check.mjs:6`、`launch.mjs:6` 导入 electron；这些依赖属于应用 package。如果 package 和安装目录随应用进入 `apps/desktop`，根脚本不能向下查找到 `apps/desktop/node_modules`。调整 cwd 不会改变 ESM 裸包导入的解析起点。

这些脚本还使用 `import.meta.url` 的上一级定位应用根，例如 `build-renderer.mjs:6` 和 `boot-check.mjs:21`。只读模块解析探针也证实：从应用 scripts 位置可解析 electron/esbuild，从拟议的根 scripts 位置均返回 MODULE_NOT_FOUND。因此“全是相对路径，机械改”不能覆盖此问题。

最小修正：**应用专属脚本保留在 `apps/desktop/scripts/`，根 scripts 只承载仓库级工具或调用应用命令的入口。** 明确 package.json、lockfile、应用 .gitignore 的去向；无需为了搬脚本引入 workspace。

### F4：A3 应排在目录迁移之前

`ssh-cordis-client/.gitignore:8` 排除了 test，当前克隆没有测试目录，Git 跟踪的测试文件数为 0。`package.json:15` 起的 smoke 命令依赖这些文件；GUI SFTP 验证也引用缺失的假 SSH 服务（`termius-analysis/drive-sftp.mjs:46`）。

实测 `npm run smoke:runner` 因找不到 `test/smoke-runner-decision.mjs` 退出 1。因此提案中的“本地实际 12 个”不能作为这个提交的可复现证据；删除 ignore 规则也不会让缺失文件自动回来。

应先找回并纳入测试及必要夹具，再记录迁移前基线。若原测试无法找回，需补足关键行为验证，并明确不是恢复原来的测试通过记录。`test` 改名为 `tests` 不是问题关键。

## 3. 对上游的事实与理念解读

### F5：service/plugin 的导出约定，不等于 services/plugins 目录约定

提案 `:136` 至 `:139` 由上游的 service 默认导出、function plugin 具名导出，推导出 `services/` 与 `plugins/` 就是 dsh 的目录分法。这不成立。上游以 `packages/<group>/<package>` 组织；导出形式描述的是包接口，不是要求这两个分类目录。参见 [上游 packages 规则](https://github.com/deepseek-ai/deepseek-harness/blob/0d1f50007f9bca3f52b06e1c3074fa14d5fb0720/packages/AGENTS.md)。

PureTerm 自己也不符合这种类型划分：plugins 下的 SessionStore、TerminalBridge、SftpBridge、HostLog 全部继承 Service；services 下的 HostKeyStore 则是普通类。保留现有目录可以是减少改动的选择，但不能据此否定按 SSH、SFTP 等能力组织。

### F6：SSH 的物理路径写错，且前后矛盾

提案 `:74` 至 `:76` 写成 `fs/fs-ssh`、`subprocess/subprocess-ssh`、`sandbox/sandbox-ssh`。在指定提交，实际是 `packages/ssh/{ssh,fs-ssh,subprocess-ssh,sandbox-ssh}`；提案 `:226` 反而写对了。

可以说 SSH 提供者实现不同能力的接口，但不能把逻辑能力归属当成物理目录位置，也不能据此断言上游没有集中 SSH 目录。参见 [固定提交的 SSH 目录](https://github.com/deepseek-ai/deepseek-harness/tree/0d1f50007f9bca3f52b06e1c3074fa14d5fb0720/packages/ssh)。

### F7：dsh Desktop 的“薄壳”不等于 apps 中没有实现

提案 `:85` 把 apps/desktop 概括为只挑包、连包、给入口，过于绝对。上游 apps/desktop 同时拥有 backend-controller、host-process、ipc、project-manager、update-coordinator、runtime-tree 等实现。产品壳需要拥有进程、安装、升级、窗口和恢复等职责；可复用的业务能力才应留在能力层。

指定版本的上游 Desktop 还明确采用独立的、随应用分发的 Node 子进程承载 Host，以字节管道传业务请求和数据，Node IPC 负责生命周期，`dsh-app://` 承载页面访问，desktop 组合不启动监听端口。PureTerm 当前在 Electron 主进程调用 createHost，并默认同时启动本机 Web carrier（`electron/main.ts:338`、`:374`）。这是架构取舍差异，搬目录无法使两者等价。参见 [上游 Desktop 设计](https://github.com/deepseek-ai/deepseek-harness/blob/0d1f50007f9bca3f52b06e1c3074fa14d5fb0720/apps/desktop/README.md)。

PureTerm 可以因当前规模保留进程内 Host；是否拆 Host 进程、Web carrier 是否默认开启，应明确为自身决策，不要求为模仿上游立即重构。

### F8：不能由“不另造 IPC 插件系统”推出“前端没有插件树”

这是提案引用的 `ssh-cordis-client/ARCHITECTURE.md:52` 中的相关误读，对后续 desktop 方向影响较大。dsh 的 Web Client 本身就是 Cordis 应用；Desktop 复用匹配的 client graph。Web boot 创建 Context、挂载 Loader、激活图中的插件。

直接依据：上游 `docs/subsystems/web-client.md:5`、`:24`，`docs/architecture.md:53`，`packages/client/web/src/boot.ts:77` 与 `boot-client.ts:37`。参见 [Web Client 架构](https://github.com/deepseek-ai/deepseek-harness/blob/0d1f50007f9bca3f52b06e1c3074fa14d5fb0720/docs/subsystems/web-client.md)。

正确表述应是：**PureTerm 暂不需要客户端插件树，这是产品规模选择；不向页面暴露原始 Electron 权限，与页面内部是否插件化是两件事。** 前端扩展需求出现时，可以再评估，不能用上述误读永久排除。

## 4. 其余需要修正文案的地方

上游规模的总数基本准确，但分区表混淆了文件数与树条目数。对固定提交执行 `git ls-tree -r --name-only HEAD` 和目录枚举，得到文件 11239、目录 1705、包 manifest 284；packages 的文件数是 5432，而非 6630，apps 是 491 而非 599，docs 是 530 而非 546，scripts 是 288 而非 305。提案所列后四项包含了目录条目。此外，“11 个分区”的表格自身列了 12 行。这些错误不推翻规模差异的判断，但应纠正“实测事实”的口径。

| 提案位置 | 校正 |
|---|---|
| `:148`、`:149` | 已分别检查 Node/Electron 与浏览器类型环境，这点正确；根 tsconfig 实际是 main 的检查/基础配置，包含源码，不是 solution-only 聚合配置。renderer 目前也没有上游那种同名 Cordis Context 声明合并问题。 |
| `:125` | 7 个文件含 Electron 导入语句，但 boot-check 只有类型导入；运行时导入是 6 个。直接导入统计也不等于完整依赖约束。 |
| `:181` | boot-check 与 smoke 是在应用里执行的诊断钩子：main 静态导入前者、按开关动态导入后者。可以归 diagnostics，不能因叫 tools 就从运行时构建排除。 |
| `:216`、`:221` | “载体到 3 个”“文件到 1000 行”没有给出证据。拆分依据应是独立使用者、职责变化、测试替换、发布边界或已出现的修改耦合。拆文件、拆接口、拆 npm 包也不是同一个决定。 |
| `:250` | src 并非全是能力实现，src/host.ts 本身负责装配与对外门面。职责分类需要看内容，不能只按父目录贴标签。 |
| `:253` | 创建目录成本很低，但迁移、路径修正、约束接入和回归验证有实际成本，“代价是 0”应删除。 |
| A2 工具迁移 | 根 .gitignore 当前只排除旧 termius-analysis/shots；工具移动后须更新截图排除位置。部分工具还有旧机器绝对路径，应与迁移引入的问题分开处理。 |
| 本仓库统计 | 当前 74 个跟踪文件，排除提案自身是 73；应用 49 个，研究目录 22 个。研究目录实际是 11 个脚本、2 个 HTML、9 个 PNG。最终报告图片为内联数据，移动报告本身不会造成外链图片丢失，但需交代 report_template.html 的去向。 |

## 5. 建议的决策顺序

1. **优先恢复验证基线。** 找回测试并纳入版本控制；区分本次能复现的结果与历史文档记录。
2. **修正事实和边界规则。** 明确 Electron 适配层允许项、宿主与协议层的限制；若要求壳只通过 Host 公共模块访问，也要处理 carrier 对 `src/services/renderer.ts` 的类型导入，以及 Host.internals 目前只有注释约束的问题。
3. **修订 A1 后再实施。** 补齐构建与运行时路径清单，按规则验证依赖，保留诊断产物。
4. **A2 按维护需要采用。** `apps/desktop`、docs、tools 可保留；应用 package、lockfile、scripts 和 tests 留在应用边界，根 README 提供入口。不要把全仓搬家列为最紧迫架构工作。
5. **桌面产品方案单独定义。** 若目标是可分发产品，再明确 Host 进程归属、Web 入口策略、窗口/宿主生命周期、安装与升级及数据归属。这些不是目录提案已经解决的问题，也不意味着必须复制上游全部机制。

## 6. 本次验证与范围

环境：Windows / PowerShell，UTF-8；Node `v24.18.0`，npm `11.16.0`。

在 `D:/bbs/pureterm/ssh-cordis-client` 执行：

| 命令 | 结果 |
|---|---|
| `npm ci --ignore-scripts --no-audit --no-fund` | 通过；按锁文件安装依赖，跳过安装脚本。 |
| `npm run typecheck` | 通过；两套类型检查和 ESM 扩展名检查成功。 |
| `npm run build` | 通过；main、CJS preload、renderer 产物均成功生成。 |
| `npm run smoke:runner` | 失败，退出码 1；缺少 test/smoke-runner-decision.mjs。 |

没有启动 Electron 窗口、连接真实 SSH 主机或执行 GUI 自动化，也没有宣称完整 smoke/verify 通过。上游只读取源码，未安装或运行其依赖。本次未修改现有源码或提案，新增的交付物仅为本评审报告；依赖与构建产物位于应用的 Git 忽略目录。
