# 目录结构评审：对着 deepseek-harness 该改什么

> 对象：`pureterm`（本仓库） vs [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness)（`master` @ `0d1f500`）
> 状态：**提案，待决定**。决定之后这份文件应当归档或删除——它描述的是「改动」，不是「现状」。
> 读法：第一节是事实，第二节是判据，第三、四节才是结论。

---

## 结论（先说三句）

1. **dsh 的目录结构不是设计出来的好看，是被 11239 个文件和 284 个包倒逼出来的。** 直接照抄它的目录名，对 73 个文件的 `pureterm` 是纯负担。
2. **但它的分界线是判据，判据可以照抄。** 其中一条 `pureterm` 已经在遵守（三层解耦），只是**没在目录上表达出来**——`electron/` 里 16 个文件，只有 7 个真的 `import electron`，剩下 9 个是混在一起的。
3. **最实质的一条改动不在应用里，在仓库根。** 现在是「按项目名分区」（`ssh-cordis-client/` / `ssh-cordis-review/` / `termius-analysis/`），dsh 是「按角色分区」（`apps/` / `packages/` / `docs/` / `scripts/`）。这三个名字现在掩盖了它们的关系——看仓库根看不出来 `REVIEW.md` 审的是谁。

---

## 一、dsh 的目录结构（实测事实）

`https://api.github.com/repos/deepseek-ai/deepseek-harness/git/trees/0d1f500...?recursive=1`：
**11239 个文件，1705 个目录，`truncated=false`**（树是完整的）。

顶层 82 个条目，去掉散文件后是 **11 个分区**：

| 分区 | 文件数 | 是什么 |
|---|---:|---|
| `packages/` | 6630 | 能力层。**52 个领域 × 284 个包** |
| `.agents/` | 3159 | 决策记录（`notes/{proposed,implemented,rejected,archived}/`）+ 12 个仓库自带技能 |
| `snapshots/` | 1311 | 快照语料 |
| `apps/` | 599 | 产品装配：`web` 281 / `cli` 201 / `desktop` 107 / `desktop-host` 9 |
| `docs/` | 546 | 当前有效的文档。**每个 `.md` 配 `.zh.md` + `.i18n.yaml`** |
| `scripts/` | 305 | 仓库自己的规矩与工具。**几乎每个 `x.ts` 都配一个 `x.spec.ts`** |
| `vendor/` | 94 | `cordis` / `cosmokit` / `schemastery` 等 in-repo 依赖 |
| `native/` | 92 | 原生扩展（`native/system/`，Landlock/seatbelt 沙箱） |
| `.github/` | 51 | CI、issue 管理、review ownership |
| `python/` | 46 | Python SDK 与单文件 exe 构建 |
| `benchmarks/` | 42 | 基准（它自己是一个**私有 workspace 包**） |
| `website/` | 18 | 官网 |

其余散文件：`AGENTS.md` `CLAUDE.md` `LICENSE` `README.md`（+ `.zh.md` / `.i18n.yaml`）、
9 个 `vitest.*.config.ts`、4 个 `tsconfig.*.json`、`pnpm-workspace.yaml`、`.oxlintrc.json`、
`.jscpd.json`、`lefthook.yml`、`pytest.ini`。

### 包的形状

```
packages/<领域>/<包名>/
  package.json        # private / version 与根一致 / type:module / main:lib/index.js
  tsconfig.json       # extends ../../../tsconfig.base.json, rootDir:src, outDir:lib/types
  src/index.ts        # service 默认导出，或 plugin 具名导出 name/inject/apply/Config
  src/types.ts        # 只有类型，没有运行时代码
  tests/*.spec.ts     # 包级，不在 src/__tests__/
  README.md           # 固定尾段：Model Experience + Known Limitations
  README.zh.md
  README.i18n.yaml
  tsdown.config.ts    # 需要时
```

`packages/AGENTS.md` 与 `docs/cookbook/adding-a-package.md` 把这条形状写成了**受校验的契约**
（`scripts/check-workspace-constraints.ts`）。关键一句：

> A new group is allowed, but it is a pure container: no `package.json`, no source files,
> and packages still sit exactly one level below it.

### 能力缝（capability seam）

以 shell 为例，一个能力被拆成 **定义 / 提供者 / 消费者** 三种包：

| 角色 | 包 |
|---|---|
| 定义 | `shell/shell` |
| 提供者（机制 × 环境） | `shell/bash-local` `shell/bash-sandbox` `shell/pwsh-local` `shell/pwsh-sandbox` |
| 消费者 | `shell/tool-bash` `shell/tool-bash-persistent` `shell/tool-pwsh` `shell/tool-pwsh-persistent` |

**最反直觉的一条**：`ssh` 不是一组中心包。它是**沿能力切开的一个提供者变体**——
`fs/fs-ssh`、`subprocess/subprocess-ssh`、`sandbox/sandbox-ssh`。
传输/机制**不是**一个横切模块，而是每个能力各有一份支持它的提供者。

---

## 二、它编码的判据（六条）

| # | 判据 | 机器可查的形式 |
|---|---|---|
| 1 | 顶层分区按**角色**，不按项目名 | 11 个分区都是角色（能力 / 装配 / 文档 / 工具 / 决策记录…） |
| 2 | `apps/` 与 `packages/` 的分界是**装配 vs 能力** | `apps/desktop` 只是「挑包、连包、给入口」，`dependencies` 里几乎没有实现 |
| 3 | 领域目录是**纯容器** | `packages/<领域>/` 下没有 `package.json`、没有源码，包精确在一层之下 |
| 4 | 依赖方向是**机器可查的事实**，不是文档约定 | 包边界 + `dependencies` / `peerDependencies`；`tsconfig.*.json` 的 `references` |
| 5 | Host / Client 两个编译面必须**分开编译** | `tsconfig.host.json` / `tsconfig.client.json`。原话：*the two sides merge cordis Context under the same keys, one program cannot see both* |
| 6 | 仓库的规矩**由脚本自己检查** | `scripts/` 305 个文件里绝大多数是 `x.ts` + `x.spec.ts` 成对（`verify-package-invariants`、`verify-md-links`…） |

另外两条规模机制（不是判据，是被规模倒逼的产物）：
**pnpm workspace + project references**（284 个包不可能手工维护依赖）、
**文档三件套配对**（`.md` / `.zh.md` / `.i18n.yaml`，由 `scripts/translation-*` 校验）。

---

## 三、逐条对照 `pureterm`

### 现状（73 个在库文件）

```
pureterm/
  .gitignore                          1
  ssh-cordis-client/                 49   ← 应用本体
    ARCHITECTURE.md  README.md  package.json  package-lock.json
    tsconfig.json  tsconfig.main.json  tsconfig.renderer.json
    electron/   16   shared/    1
    renderer/    9   src/       8
    scripts/     7   test/      0（.gitignore 排除，实际 12）
  ssh-cordis-review/REVIEW.md         1   ← 文档
  termius-analysis/                  22   ← 报告 1 + GUI 工具 12 + 图片资源 8 + shots/（排除）
```

### 判据 1（角色分区）—— **不符合，这是最该改的一条**

现在顶层是**名字**，三个名字都是「什么东西」，没有一个是「它的角色」。
后果具体而不抽象：**看仓库根看不出 `ssh-cordis-review/REVIEW.md` 审的是 `ssh-cordis-client/`**，
也看不出 `termius-analysis/` 里哪些是**产物**（那份 300KB 报告）、哪些是**可复用的工具**
（`capture.cjs` / `drive.py` / `crop.py`——它们和 `ssh-cordis-client` 是两回事，却并排放着）。

### 判据 2 + 4（装配 vs 能力；依赖方向）—— **不符合同一条，但有一条硬证据**

`electron/` 16 个文件实测：

| 真的 `import 'electron'`（7） | 不 import（9） |
|---|---|
| `main` `shell` `platform` `preload` `carrier-ipc` `boot-check` `smoke` | `dispatch` `carrier` `carrier-http` `ws-frame` `ws-server` `platform-plan` `launch-profile` `readiness` `relaunch` |

**`ARCHITECTURE.md` §三已经把三层写清楚了，而且已经做到了**——
`dispatch.ts` 不 import electron 是明确的纪律，`carrier-http.ts`（Web 载体）也不 import。
判据 4 说：这种纪律应当由**目录边界 + 可自动检查的约束**表达。
现在它只存在于文件名前缀和文档里。

### 判据 3（纯容器）—— **已经符合，但容器名有代价**

`src/services/` 与 `src/plugins/` 已经是「纯容器 + 一层」的形状，而且
**`services/` + `plugins/` 恰好就是 dsh 的分法**（见 `packages/AGENTS.md` 第一条：
service 包默认导出服务类，function plugin 具名导出 `name/inject/apply`）。
所以**不建议**把它改成领域名（`src/ssh/` `src/sftp/`…）——那会丢掉「这是个 service 还是个 plugin」这条信息。

真正缺的是：`src/services/` 里**定义与提供者融在一起**。
`ssh.ts` 474 行同时是「SSH 服务契约」和「ssh2 这一个实现」。
dsh 会拆成 `ssh`（定义）+ `ssh-local`（提供者）。**要不要拆取决于是否有第二个实现**——
现在没有，所以**不该拆**（见第四节）。

### 判据 5（双编译面）—— **已经符合**

`tsconfig.main.json` + `tsconfig.renderer.json` 就是 `tsconfig.host.json` + `tsconfig.client.json`。
根 `tsconfig.json` 已经是聚合位。

### 判据 6（脚本自检）—— **已经符合一条**

`scripts/check-esm-extensions.mjs` 正是这个形状：一条仓库自订规矩，一个自检脚本。
`scripts/` 7 个工具全部是 `.mjs`（不是 `.ts`+`.spec.ts`），这符合当前规模。

### 规模机制—— **不该照抄**

| dsh 的机制 | 在 `pureterm` 的结论 |
|---|---|
| pnpm workspace + 284 包 | 1 个 app、2 个 tsconfig。**不引入** |
| project references | 同上 |
| 文档 `.md`/`.zh.md`/`.i18n.yaml` 三件套 | 没有多语言需求。**不引入** |
| `.agents/skills/` 12 个仓库技能 | 我们已有 `~/.workbuddy/skills/`。**不重复** |
| 每个包一份 README | 9 个界面模块各写一份 README 是负担。**不引入** |

---

## 四、建议改动（按「值不值得现在做」分三档）

### A 档 —— 建议现在做（不动一行逻辑，纯目录与引用调整）

**A1. `electron/` 按三层拆子目录。** 把判据 2/4 从文档搬进目录事实：

```
electron/
  app/         main.ts  shell.ts  platform.ts  platform-plan.ts
               readiness.ts  relaunch.ts  launch-profile.ts
  bridge/      dispatch.ts                 ← 不 import electron，唯一映射
  carriers/    carrier.ts  carrier-ipc.ts
               ws-server.ts  ws-frame.ts  carrier-http.ts  preload.ts
  tools/       boot-check.ts  smoke.ts     ← 开发/验证用，不是运行时
```

为什么这比现状强：`ARCHITECTURE.md` 里「壳层只许用 `Host` 公共成员」「载体才 import electron」
这些话，从此可以加一条脚本自检（`electron/bridge/` 与 `electron/app/` 下出现 `from 'electron'`
就失败）——对齐判据 6。
**影响面**：`scripts/*.mjs`（7 个）里的路径、`package.json` 的 `main` 字段、
`test/` 里的 import。全部是相对路径，机械改。
**依据**：dsh 的 `apps/desktop/scripts/smoke-runtime.ts` + `smoke-windows.ps1` 就在 `scripts/` 下，
`boot-check` / `smoke` 归 `tools/` 是同一条判断。

**A2. 仓库根从「项目名」改成「角色」。** 这条要改的正是上一轮「父目录作仓库根」那个决定的下半程——
当时定的是「根放在哪」，没定「根里面怎么摆」：

```
pureterm/
  apps/desktop/         ← ssh-cordis-client/ 的主体（electron + renderer + src + shared + tsconfig*）
  docs/
    ARCHITECTURE.md  README.md
    review/REVIEW.md
    research/termius-design-analysis.html
  tools/gui/            ← termius-analysis/ 里的 12 个可复用脚本 + assets/
  scripts/              ← 原 apps/desktop/scripts/
```

**A3. `test/` 的命运需要你定。** 它现在被 `.gitignore` 排除（12 个文件），
但判据 6 的整套打法建立在「测试在仓库里、跟代码走」之上。
dsh 的形状是**包级 `tests/`**；`pureterm` 只有一个 app，就是 **`apps/desktop/tests/`**。
→ **要么纳入仓库，要么接受「clone 后无法复现验证状态」**（`.gitignore` 里已写明后果）。
这条是 A 档里唯一需要你拍板的。

### B 档 —— 等规模到了再做（现在做是过度工程）

- `src/services/ssh.ts` 拆成「定义 + `ssh-local` 提供者」：**等出现第二个 SSH 实现**
  （比如走 `ssh` 命令行、或走 WSL 转发）再拆。现在拆只是把 474 行分成两个文件。
- `carrier` 提升为包、`carrier-ipc` / `carrier-http` 成为两个提供者包：**等载体到 3 个**。
  现在 25 行的 `carrier.ts` 已经达成了判据（加 Web 载体时 `src/` 一字未改），
  多包化只会把这条判据埋进 import 图里。
- `renderer/app.ts` 787 行：里面确实有两件互不相干的事（主机表单/连接 vs SFTP 编排，
  后者在 524–712 行），但 `renderer/sftp-panel.ts` 已经承担了其中一半。
  **等它涨到 1000 行以上再拆。**

### C 档 —— 明确不该照抄

`packages/*/*` 的两级结构本身。注意 dsh 的第二级**不是装饰**——
`packages/ssh/` 里有 4 个包（`ssh` `fs-ssh` `sandbox-ssh` `subprocess-ssh`）。
`pureterm` 的 `src/` 只有 8 个文件，硬造一层领域目录会得到 8 个目录各装 1 个文件。

**判据 3 里真正有用的是「容器不装代码」这条纪律**，不是「一定要有这一层」。

---

## 五、要你决定的两件事

1. **A2 是否执行。** 它会改动已推送的 73 个文件的路径（`README.md` 里 3 处 `../termius-analysis/` 引用、
   `drive-sftp.mjs` 里 `../ssh-cordis-client/` 的 import 都要跟着改）。这是这次评审里唯一「有代价」的改动。
   → 若不做，仓库根继续是「三样并列的东西」，这份文件的第一条结论就只能挂着。
2. **A3：`test/` 纳不纳入仓库。** 与 A2 无关，可以单独决定。

---

## 附：判据 1 为什么值得单独强调

dsh 的 `apps/` 里有 4 个装配（web / cli / desktop / desktop-host），`packages/` 有 284 个包。
**`pureterm` 现在是 1 个装配、0 个包。** 这不是「落后」，是规模差异。

但 `apps/` 与 `packages/` 那条分界线**与规模无关**，它回答的是一个永远存在的问题：
「这一坨代码是**产品**，还是**能力**？」

`pureterm` 的 `src/` （8 个文件，2064 行）是能力：SSH 服务、TOFU 指纹、会话存储、终端桥、SFTP 桥。
`electron/` + `renderer/`（2600 行）是产品：一个 Electron 窗口 + 一份前端产物。

用两个目录把这条分界线画出来，代价是 0，收益是**任何新人第一天就能答对「新代码该放哪」**。
这才是从 dsh 值得拿走的唯一一件大东西。
