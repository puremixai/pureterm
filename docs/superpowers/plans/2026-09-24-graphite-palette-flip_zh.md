# 石墨配色翻转实施计划

[English version](2026-09-24-graphite-palette-flip.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 删除 `packages/ui/src/styles/legacy.css`，用中性石墨灰阶重绘整个应用，布局、markup 与行为一律不动。

**架构：** 每个颜色都已经过 token 解析，所以翻转只有三个机械动作 —— 把登记表里四条非颜色条目安家、把 `tokens.css` 调到量测过的石墨值并补上灰阶缺少的半透明层级、然后把每一处 `var(--legacy-*)` 与旧别名引用换成新体系 token 并删除登记表。两道守卫让这件事是"可靠"而不是"祈祷"：`stylesheet-contract.test.mjs` 会对 `tokens.css` 之外的任何颜色字面量失败，它的引用方向检查会对任何指不到东西的 `var(--x)` 失败。

**技术栈：** 纯 CSS、Node 内置测试运行器、esbuild。不新增依赖。

**规格：** `docs/superpowers/specs/2026-09-23-frontend-professional-redesign.md` 的"Token 体系""主题机制"与"非目标"三节。

**前置：** 已完成的地基计划。先读 `docs/superpowers/plans/2026-09-23-token-foundation.md` —— 它的"评审后的修订""任务 5 执行中发现的修正""转交给计划二的事项"三节是本计划的输入，那份清单里的 1–8 项全部在本计划处理。

**分支：** 继续在 `feat/ui-redesign` 上。绝不在 `main` 上。

---

## 范围：本计划只做翻转

规格里的提交 3（外壳重建 —— 52px 图标轨道、顶栏标签、状态栏、品牌标记、favicon、主题开关）是**计划三**，提交 4（hosts/keychain 表格、Inspector、SFTP 分栏、四态、失败诊断）是**计划四**。在这里切一刀不是因为整洁：翻转是整个重设计中风险最高的一步，它一次改掉每一个像素却什么都不改，所以必须单独落地才可审、可回滚。而且它本身就能产出可用、可测的软件 —— 一个石墨色、布局同今天的 PureTerm。

**这一刀带来两个后果，都是故意的：**

1. **浅色主题仍不可达。** `[data-theme="light"]` 要到计划三的开关才有触发点。本计划要让浅色组*正确*，而不是*可激活*。
2. **状态栏缺的那些数据不在这里造。** 规格答应了加密算法、主机密钥类型、在线时长、延迟。这些今天在任何地方都不存在 —— `RuntimeCapabilities` 只有 `credentialPersistence` 与 `privateKeyPicker`（`packages/protocol/src/protocol.ts:244-247`），而规格在本阶段禁止改协议。不要为了让 mockup 成立去加 host 侧字段。计划三用真正拿得到的字段建状态栏，规格里那份字段清单在它自己的提交里改正。

## 非目标

- 不改布局、markup、类名、id。`#nav-toggle`、`.nav-collapsed`、`.workspace-mark`、`#primary-nav` 和 278px 栅格原样活过本计划；计划三才删它们。
- 不新增依赖、不做终端字体、不用 `@layer`。
- 不改 protocol、host、transport。
- 不做真正的 `<table>` 语义，不做安装包图标（规格的延后清单继续有效）。
- 不升版本。`VERSION.txt` 保持 `0.1.0-alpha.1`，改动记入 `[Unreleased]`。

## 这套灰阶需要新增的 token

`tokens.css` 现在每套主题有 21 个颜色 token。登记表的 96 条颜色不靠新增灰阶原有的层级是映射不进去的。往 `:root` 加下面这些，浅色值有意义的一起加进 `[data-theme="light"]`：

```css
  /* Translucent steps. Dark values are white-or-accent at an alpha; light
     values flip to black-or-accent because white-on-white does not exist. */
  --overlay-soft: rgba(255, 255, 255, 0.03);
  --overlay-hover: rgba(255, 255, 255, 0.06);
  --overlay-press: rgba(255, 255, 255, 0.09);
  --ac-line: rgba(90, 174, 255, 0.42);
  --ac-focus: rgba(90, 174, 255, 0.55);
  --ok-bg: rgba(78, 194, 127, 0.12);
  --ok-line: rgba(78, 194, 127, 0.3);
  --warn-bg: rgba(224, 168, 60, 0.12);
  --warn-line: rgba(224, 168, 60, 0.32);
  --err-bg: rgba(242, 85, 90, 0.12);
  --err-line: rgba(242, 85, 90, 0.32);
  --scrim: rgba(0, 0, 0, 0.62);
  --scroll-thumb: #33383f;
  --scroll-thumb-strong: #444a53;
```

浅色组加上：

```css
  --overlay-soft: rgba(0, 0, 0, 0.03);
  --overlay-hover: rgba(0, 0, 0, 0.055);
  --overlay-press: rgba(0, 0, 0, 0.08);
  --ac-line: rgba(31, 111, 235, 0.42);
  --ac-focus: rgba(31, 111, 235, 0.35);
  --ok-bg: rgba(26, 127, 75, 0.1);
  --ok-line: rgba(26, 127, 75, 0.28);
  --warn-bg: rgba(154, 106, 10, 0.1);
  --warn-line: rgba(154, 106, 10, 0.3);
  --err-bg: rgba(194, 54, 59, 0.1);
  --err-line: rgba(194, 54, 59, 0.3);
  --scrim: rgba(20, 24, 30, 0.38);
  --scroll-thumb: #c9ced5;
  --scroll-thumb-strong: #aab1ba;
```

不新增 `--on-solid`。`--legacy-on-solid` 是 `#ffffff`，三处调用 —— `hosts.css:41` 的 `.host-avatar`、`inspector.css:26` 的 `.connection-type`、`keychain.css:21` 的 `.keychain-avatar` —— 它们所压的填充都会被下面这张表变成 `--c-control`，即深色 `#21252b`、浅色 `#e8ebef`。所以图例在深色下要白、在浅色下要近黑，而这正是 `--tx-1` 在两组里的取值。映射成 `var(--tx-1)`，不要新增 token；给已有决策再起一个名字，正是登记表长到 96 条的原因。

灰阶新增一档圆角，因为三档刻度吸收不了 16 个不同字面值而不把面板压扁成控件：

```css
  --r-4: 12px;
```

`--r-1` 3、`--r-2` 5、`--r-3` 8 保持不变，也别再加：四档是设计，16 档是意外。

## 映射表

这是本计划的载荷。每行是 `legacy.css` 的当前值 → 取代它的新体系 token。机械执行即可。写"删除"的行，把声明去掉，让发丝线或表面去做功。两三个旧条目映射到同一个新 token 是应该的 —— 这就是目的。

| 登记条目（当前值） | 取代为 | 说明 |
| --- | --- | --- |
| `--topbar` `#121426` | `var(--c-chrome)` | `index.html:15` meta 与 `shell.ts:61,67` 在任务 5 跟进 |
| `--nav` `#272b40` | `var(--c-chrome)` | 轨道与顶栏合并为一个底 |
| `--main` `#1d2033` | `var(--c-canvas)` | |
| `--main-soft` `#22263a` | `var(--c-surface)` | |
| `--card` `#292d43` | `var(--c-surface)` | |
| `--card-hover` `#30354d` | `var(--c-raised)` | |
| `--field` `#171a2b` | `var(--c-inset)` | |
| `--field-hover` `#1d2134` | `var(--c-control)` | |
| `--text-strong` `#f5f5fb` | `var(--tx-1)` | |
| `--text` `#e5e7f2` | `var(--tx-2)` | |
| `--text-muted` `#a1a5bb` | `var(--tx-3)` | `shell.ts:68` 的 `symbolColor` 跟进 |
| `--text-faint` `#737991` | `var(--tx-4)` | 但要看合法性规则：`--tx-4` 只作装饰，所以 `chrome.css:166` 的 `.tab-state-dot` 用 `--tx-3` |
| `--accent` `#a7c4ff` | `var(--ac)` | 深底上的淡紫文字直接变成 accent 本身 |
| `--accent-strong` `#3c9ef5` | `var(--ac)` | |
| `--accent-soft` `rgba(121,169,255,.16)` | `var(--ac-bg)` | |
| `--legacy-ok` `#7bd6af` | `var(--ok)` | |
| `--legacy-err` `#ff929e` | `var(--err)` | |
| `--warning` `#f2c86f` | `var(--warn)` | |
| `--legacy-surface-sunken` `#1c2033` | 删除 | 登记表里唯一无人引用的一条 |
| `--legacy-surface-raised` / `-hover` `#24283d`/`#2d324a` | `var(--c-raised)` | |
| `--legacy-surface-active` `#323852` | `var(--c-control)` | |
| `--legacy-surface-field` `#25293d` | `var(--c-inset)` | |
| `--legacy-surface-block` / `-alt` `#30344a`/`#3b4057` | `var(--c-control)` | |
| `--legacy-surface-control` `#3b425e` | `var(--c-control)` | |
| `--legacy-surface-tool` / `-add` `#393e56`/`#3c4159` | `var(--c-control)` | |
| `--legacy-surface-action` / `-hover` `#3f435a`/`#4a506b` | `var(--c-control)` / `var(--c-raised)` | |
| `--legacy-surface-nav-active` `#41465e` | `var(--ac-bg)` | 活动导航项现在是 accent 底，而不是一块更浅的灰 |
| `--legacy-surface-input` `#262a40` | `var(--c-inset)` | |
| `--legacy-surface-log` `#2a2e44` | `var(--c-inset)` | |
| `--legacy-surface-secondary` `#2d3147` | `var(--c-surface)` | |
| `--legacy-surface-bar` `#1a1e30` | `var(--c-chrome)` | |
| `--legacy-surface-pill` / `-hover` `#20243a`/`#303650` | `var(--c-control)` / `var(--c-raised)` | |
| `--legacy-surface-tab-active` `#2b3048` | `var(--c-surface)` | |
| `--legacy-surface-tab-session` `#1c2033` | `var(--c-canvas)` | |
| `--legacy-surface-tab-active-session` `#263b43` | `var(--ok-bg)` | 活动会话标签表达"已连接"，不是一块青色 |
| `--legacy-surface-tab-failed` `#3e2939` | `var(--err-bg)` | |
| `--legacy-on-accent` / `-hover` `#081426`/`#06111f` | `var(--ac-fg)` | 一个值，不是两个 |
| `--legacy-accent-hover` `#56adff` | `var(--ac-hi)` | |
| `--legacy-danger-fill` `#a84455` | `var(--err)` | 关闭按钮 hover；红块仍然红 |
| `--legacy-danger-node` / `-title` / `-log` | `var(--err)` | 三种红合成一种 |
| `--legacy-log-glyph` `#bab3d0` | `var(--tx-3)` | |
| `--legacy-icon-on-nav` `#f5f6ff` | `var(--tx-1)` | |
| `--legacy-strong-on-dark` `#e7e9f4` | `var(--tx-1)` | |
| `--legacy-placeholder-strong` `#adb2c7` | `var(--tx-3)` | |
| `--legacy-on-solid` `#ffffff` | `var(--tx-1)` | 实测：三处填充都变成 `--c-control`，于是深色白、浅色近黑恰好就是 `--tx-1` |
| `--legacy-mark-bg` / `-fg` `#e5e8f2`/`#20243a` | `var(--c-control)` / `var(--ac)` | 计划三用 SVG 品牌标记替换文字标记 |
| `--legacy-key-avatar` / `-address-avatar` `#075a87`/`#086ba7` | `var(--c-control)` | 这两块装饰蓝就是色偏本身；头像归中性 |
| `--legacy-tone-0`…`-3` `#f15b29 #096da9 #efad18 #4b4d61` | `var(--c-control)` | 四色全部收拢；`--tone-2-fg` → `var(--tx-3)` |
| `--legacy-scroll-thumb` / `-strong` | `var(--scroll-thumb)` / `--scroll-thumb-strong` | |
| `--legacy-line-faint`/`-hair`/`-edge`/`--legacy-line`/`-mid`/`-field`/`-strong`（7 档，`.05`→`.17`） | 最淡四档用 `var(--line-soft)`，`.12`/`.13` 用 `var(--line)`，`.17` 用 `var(--line-strong)` | 七档并三档；`--line-soft` 在这里获得第一批消费者 |
| `--legacy-overlay-soft` / `-hover` / `-hover-strong` | `var(--overlay-soft)` / `--overlay-hover` / `--overlay-press` | |
| `--legacy-row-hover` `rgba(222,226,255,.055)` | `var(--overlay-hover)` | |
| `--legacy-tint-accent` `rgba(93,157,255,.13)` | `var(--ac-bg)` | |
| `--legacy-tint-accent-line` / `-line-strong` | `var(--ac-line)` | |
| `--legacy-tint-accent-focus` `rgba(167,196,255,.7)` | `var(--ac-focus)` | |
| `--legacy-tint-ok` / `-ok-line` | `var(--ok-bg)` / `var(--ok-line)` | |
| `--legacy-tint-err` / `-err-line` | `var(--err-bg)` / `var(--err-line)` | |
| `--legacy-tint-warn` / `-warn-line` | `var(--warn-bg)` / `var(--warn-line)` | |
| `--legacy-mini-bg` `rgba(20,23,42,.55)` | `var(--c-control)` | 悬浮操作不再漂在半透明黑上 |
| `--legacy-field-inset` | `var(--c-inset)` | |
| `--legacy-shadow-sm` / `-card` / `-card-hover` / `-log` | 删除 | 深色靠发丝线分层；确需边界处补 `border: 1px solid var(--line)` |
| `--legacy-shadow-drawer` / `-sheet` / `-editor` | 删除 | 抽屉与面板改用 `border-left`/`border-top`，颜色 `var(--line)` |
| `--legacy-shadow-dialog` | `var(--shadow-pop)` | |
| `--legacy-backdrop` `rgba(7,9,22,.6)` | `var(--scrim)` | |
| `--radius-sm` `7px` | `var(--r-2)` | 5px，控件收紧 |
| `--radius-md` `10px` | `var(--r-3)` | 8px |
| `--radius-lg` `15px` | `var(--r-4)` | 12px，即新增那一档 |
| `--motion-standard` `cubic-bezier(.32,.72,0,1)` | `var(--ease)` | 全应用一条曲线 |

分片里剩下的圆角字面值就近归档：`4px`→`--r-1`、`5px`→`--r-2`、`6px`→`--r-2`、`8px`→`--r-3`、`9px`→`--r-3`、`11px`→`--r-4`、`12px`→`--r-4`、`13px`→`--r-4`、`14px`→`--r-4`、`16px`→`--r-3`、`17px`/`18px`/`20px`→`--r-4`、`50%`→`--r-full`，两处 `0` 与一处 `0 10px 10px 0` 原样保留。

---

### 任务 1：扩展灰阶，并在写死之前先量

**文件：**
- 修改：`packages/ui/src/styles/tokens.css`
- 修改：`packages/ui/tests/design-tokens.test.mjs`
- 测试：`packages/ui/tests/design-tokens.test.mjs`

- [ ] **Step 1: 先写失败的测试**

追加到 `packages/ui/tests/design-tokens.test.mjs`。半透明层级里出现 hex 而不是三元组、或某个层级只在一组里存在，是这套灰阶最容易得的两种病：

```js
const TINT_TOKENS = [
  '--overlay-soft', '--overlay-hover', '--overlay-press',
  '--ac-line', '--ac-focus',
  '--ok-bg', '--ok-line', '--warn-bg', '--warn-line', '--err-bg', '--err-line',
  '--scrim',
]

test('every translucent step carries the triplet of the colour it tints', () => {
  const parents = {
    '--ac-line': '--ac', '--ac-focus': '--ac',
    '--ok-bg': '--ok', '--ok-line': '--ok',
    '--warn-bg': '--warn', '--warn-line': '--warn',
    '--err-bg': '--err', '--err-line': '--err',
  }
  for (const [tint, parent] of Object.entries(parents)) {
    for (const selector of THEMES) {
      assert.deepEqual(triplet(token(selector, tint)), triplet(token(selector, parent)),
        `${selector} ${tint} must be ${parent} at an alpha`)
    }
  }
})

test('translucent steps exist in both theme groups', () => {
  for (const selector of THEMES) {
    for (const name of TINT_TOKENS) assert.ok(names(block(selector)).includes(name), `${selector} is missing ${name}`)
  }
})
```

`THEMES`、`block`、`names`、`token`、`triplet` 用文件已有的辅助函数 —— 它内部是 `DARK` 与 `LIGHT` 常量且不导出任何东西，所以在本文件内扩作用域，不要重构它。若 `triplet` 只能从 `token-source.mjs` 拿到，就从那里 import。

- [ ] **Step 2: 运行测试，确认失败**

运行：`node --test packages/ui/tests/design-tokens.test.mjs`
预期：FAIL，`:root` 缺 `--overlay-soft`。

- [ ] **Step 3: 检查状态色压在自己半透明底上还过不过 AA**

状态文字从不落在裸表面上 —— `.tag.saved`、`#status.ok`、`.keychain-message.ok/.err`、`#sftp-hint.*` 都是把颜色画在配套的半透明底上。把每个 `--*-bg` 与它的底合成，再量它与实心状态色的比值，两套主题共九个数字全部报出来。任何一对跌破 4.5，就通过提高该主题那个文字 token 的值来修，不要靠调低半透明底的不透明度，并说明是哪一对逼出的修改。把最终数字写进提交信息，让这次翻转的可访问性主张是可审计的，而不是被声明的。

- [ ] **Step 4: 加入 token**

把"这套灰阶需要新增的 token"里的 `:root` 块插到 `--idle` 之后，浅色块插到浅色的 `--idle` 之后。`--r-4: 12px` 与其他圆角并排放，且只进 `:root` —— 它是度量，度量不按主题重复声明。

- [ ] **Step 5: 运行测试**

运行：`node --test packages/ui/tests/design-tokens.test.mjs`
预期：PASS。再跑 `node --test packages/ui/tests/stylesheet-contract.test.mjs` —— 声明数棘轮数的是 `legacy.css` 而不是 `tokens.css`，所以它保持绿。

- [ ] **Step 6: 提交**

```bash
git add packages/ui/src/styles/tokens.css packages/ui/tests/design-tokens.test.mjs
git commit -m "feat(ui): add the translucent steps the graphite ramp needs"
```

---

### 任务 2：把四条非颜色条目安家

**文件：**
- 修改：`packages/ui/src/styles/legacy.css`（删掉那四条）
- 修改：`packages/ui/src/styles/base.css`、`chrome.css`、`hosts.css`、`inspector.css`、`keychain.css`、`states.css`、`terminal.css`
- 修改：`packages/ui/tests/stylesheet-contract.test.mjs`

- [ ] **Step 1: 先写失败的测试**

棘轮当前钉在 100 条。引用方向检查已经会拒绝指不到东西的 `var(--radius-sm)`，所以不先安家就删这四条会大声失败 —— 这正是设计。改 `stylesheet-contract.test.mjs` 里的两个数：

```js
const LEGACY_DECLARATIONS = 96
```

并把计数断言的信息改成说明原因：几何与动效已经离开登记表，颜色留下了。分号等值检查跟着新数字一起调整。

- [ ] **Step 2: 运行测试，确认失败**

运行：`node --test packages/ui/tests/stylesheet-contract.test.mjs`
预期：FAIL —— 文件仍声明 100 条。

- [ ] **Step 3: 替换全部 22 处引用**

`--radius-sm` → `--r-2`，位于 `base.css:60`、`terminal.css:12`、`terminal.css:17`。`--radius-md` → `--r-3`，位于 `base.css:43`、`terminal.css:19`、`terminal.css:21`。`--radius-lg` → `--r-4`，位于 `states.css:11`、`terminal.css:9`。`--motion-standard` → `--ease`，位于 `base.css:49`（4 次）、`hosts.css:38`（4）、`hosts.css:54`、`inspector.css:49`（3）、`terminal.css:19`（2）。先数一遍再动手，因为漏掉的一处会被引用检查抓到，但重复的一行不会：

```powershell
Select-String -Path packages/ui/src/styles/*.css -Pattern 'var\(--radius-|var\(--motion-standard\)' | Group-Object Filename | Select-Object Count, Name
```
预期：共 22 处，替换后为 0。

- [ ] **Step 4: 删除四条声明与文件头的警告**

从 `legacy.css` 移除 `--radius-sm`、`--radius-md`、`--radius-lg`、`--motion-standard` 以及那句 `/* Geometry and motion, not colour … */` 注释。重写文件头：整个文件现在都是颜色债，删除是一次 `git rm` 加一行清单；关于 `--line-strong` 与 `--legacy-line-strong` 同名异值的警告留到任务 4 收拢发丝线为止。

- [ ] **Step 5: 跑守卫**

运行：`node --test "packages/ui/tests/*.test.mjs"`，然后 `npm run build:web`。
预期：全绿；引用检查通过，因为每个 `var(--r-*)` 与 `var(--ease)` 都指得到 token。

- [ ] **Step 6: 确认曲线变化不是回退**

`--ease` 是 `cubic-bezier(0.2, 0.8, 0.2, 1)`，`--motion-standard` 是 `cubic-bezier(0.32, 0.72, 0, 1)`。两者终点都是 1；新的那条起步更慢、落定更快。跑 `npm run start:desktop`，hover 主机行、按钮、标签，确认没有拖沓也没有提前咬合。报你实际看到的现象。若某个过渡现在读起来不对，那是调用处的时长问题而不是曲线问题 —— 说是哪个。

- [ ] **Step 7: 提交**

```bash
git add packages/ui/src/styles packages/ui/tests/stylesheet-contract.test.mjs
git commit -m "refactor(ui): move geometry and motion out of the debt register"
```

---

### 任务 3：逐片翻转分文件

**文件：**
- 修改：`base.css`、`chrome.css`、`hosts.css`、`inspector.css`、`keychain.css`、`terminal.css`、`states.css` 各一

- [ ] **Step 1: 定顺序与检查**

按此顺序做，因为把"不需要活会话就能看见结果"的文件排在前面：`base.css`、`chrome.css`、`hosts.css`、`inspector.css`、`keychain.css`、`states.css`、`terminal.css`。每改完一个文件跑一次：

```powershell
node --test packages/ui/tests/stylesheet-contract.test.mjs
```
预期：绿。被你替换成不存在名字的 `var(--topbar)` 会立刻让引用检查失败并指出行号。

- [ ] **Step 2: 重写 `base.css`**

把映射表套到该文件每一处登记表引用。具体地，元素默认值变成：

```css
body { overflow: hidden; background: var(--c-canvas); color: var(--tx-2); font-family: var(--font-ui); font-size: var(--fs-ui); text-rendering: optimizeLegibility; -webkit-font-smoothing: antialiased; }
button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: none; box-shadow: var(--ring); }
button { min-height: 38px; padding: 0 13px; border: 1px solid var(--line); border-radius: var(--r-3); background: var(--c-surface); color: var(--tx-2); cursor: pointer; font-size: var(--fs-ui); font-weight: 500; transition: background-color var(--t-2) var(--ease), border-color var(--t-2) var(--ease), color var(--t-2) var(--ease), transform var(--t-2) var(--ease); }
button:hover:not(:disabled) { border-color: var(--line-strong); background: var(--c-raised); color: var(--tx-1); }
button:disabled { cursor: not-allowed; opacity: 0.42; }
button.ghost { border-color: transparent; background: transparent; color: var(--tx-3); }
button.ghost:hover:not(:disabled) { border-color: var(--line); background: var(--c-surface); color: var(--tx-1); }
button.primary { border-color: transparent; background: var(--ac); color: var(--ac-fg); font-weight: 600; }
button.primary:hover:not(:disabled) { border-color: transparent; background: var(--ac-hi); color: var(--ac-fg); }
```

两处刻意偏离机械替换，且都能追溯到规格：焦点表现从 `outline` 换成 `box-shadow: var(--ring)`，因为双环是唯一一种在表面底与 accent 底上都可见的形态；`button:active` 保留它的 `transform`，而旧的卡片阴影被删除而不是重新加回。

- [ ] **Step 3: 重写 `chrome.css`**

同法。具体决定：`.app-topbar` 与 `.primary-nav` 都取 `var(--c-chrome)`，靠 `border-right: 1px solid var(--line)` 分隔；`.app-tab.is-active` 与 `.workspace-tabs > .app-tab.is-active` 收拢成一条规则用 `var(--c-control)`；`.session-tab.is-active` 取 `var(--ok-bg)` 加 `border-color: var(--ok-line)`；`.session-tab[data-state="failed"].is-active` 取 `var(--err-bg)` 与 `var(--err-line)`；`.tab-state-dot` 的默认色用 `var(--idle)` 而不是 `--tx-4`，因为它是状态指示器，而地基计划自己写的注释说装饰性 token 不得承载语义；`.nav-item.active` 取 `var(--ac-bg)`，左侧强调条留给计划三；`.icon-button, .window-control` 的 hover 用 `var(--overlay-hover)`；`.window-control.close:hover` 用 `var(--err)`；`.workspace-mark` 保持 `--c-control` 底加 `var(--ac)` 字形；`--legacy-line-hair`/`-edge`/`-faint` 全部收进 `var(--line-soft)`，`--legacy-line-strong` 收进 `var(--line-strong)`；`#app` 与 `.app-topbar` 的高度保持 `76px` —— 改几何是计划三，不是本计划。

- [ ] **Step 4: 重写 `hosts.css`**

`.host-row` 去掉 `--legacy-shadow-card` 且不补任何东西：`border: 1px solid var(--line-soft)` 加 `background: var(--c-surface)`；`.host-row:hover` 升到 `var(--c-raised)`、`border-color: var(--line)`，并且**去掉 `transform: translateY(-1px)`** —— 没有阴影的抬升看起来像故障；`.host-row.active` 变成 `background: var(--ac-bg)` 加 `border-color: var(--ac-line)`。`.host-avatar` 与四条 `.tone-*` 收拢成一条 `background: var(--c-control); color: var(--tx-3)`。`.host-search-row` 的 `--legacy-surface-block-alt` 变 `var(--c-surface)` 加 `border: 1px solid var(--line)`。`.search-icon` 用 `var(--tx-2)`，`#host-search::placeholder` 用 `var(--tx-4)`（占位符按定义就是装饰）。`.section-kicker` 与 `.host-count` 用 `var(--tx-3)`，**不是** `--tx-4`：前者标注一个分组、后者陈述共有多少台主机，两者都承载信息，而 `tokens.css` 的合法性注释禁止把 `--tx-4` 用在信息性文字上。`.hosts-heading h1` 用 `var(--tx-1)`。`.tag.saved` 用 `--ok`/`--ok-bg`/`--ok-line`。

- [ ] **Step 5: 重写 `inspector.css`**

`input, select` 取 `background: var(--c-control)`、`border: 1px solid var(--line-strong)`、`color: var(--tx-1)`，`input:focus` 改用 `--ring` 表现并把底色设为 `var(--c-inset)`。`.address-control` 与 `.connection-type` 收拢到 `var(--c-surface)` 与 `var(--c-control)` 底 —— 那块蓝方块是全应用饱和度最高的元素。`.drawer-footer` 用 `var(--c-chrome)` 加 `border-top: 1px solid var(--line)`；`#toolbar` 的 `--legacy-shadow-drawer` 变 `border-left: 1px solid var(--line)`。`.field > span` 用 `var(--tx-3)` —— 标签是文字，合法性规则禁止 `--tx-4`。`#status` 保留三种语义色，但它们是 `var(--ok)`、`var(--warn)`、`var(--ac)`。

- [ ] **Step 6: 重写 `keychain.css`**

`.keychain-card` 照 `.host-row`。`.keychain-avatar` 变 `var(--c-control)` 加 `var(--tx-3)` 字形。`.keychain-toolbar.dashboard-toolbar` 用 `var(--c-chrome)`；`#keychain-view[aria-pressed="true"]` 用 `var(--c-control)`。`.keychain-form-section` 用 `var(--c-surface)` 并去掉 `--legacy-shadow-*`。`.keychain-drop.is-dragging` 用 `var(--ac-bg)` 与 `var(--ac-line)`。`@media (max-width: 900px)` 里 `.keychain-editor` 的阴影变 `border-left: 1px solid var(--line)`。

- [ ] **Step 7: 重写 `states.css`**

失败页是旧色板最大声的地方：`.failure-route-node` 与 `.failure-route-line` 用同一个 `var(--err)` 而不是三种红；`.failure-shell > h2` 用 `var(--err)`；`.failure-log` 用 `var(--c-inset)` 并去掉 `--legacy-shadow-log`；`.failure-secondary` 用 `var(--c-surface)` 加 `border: 1px solid var(--line)`；`.shortcuts-dialog` 取 `var(--c-surface)`、`border: 1px solid var(--line-strong)`、`box-shadow: var(--shadow-pop)`，`::backdrop` 取 `var(--scrim)`。`.empty` 保持虚线 `var(--line-strong)`。

- [ ] **Step 8: 重写 `terminal.css`**

`#terminal`、`.session-workspace`、`.connection-failure` 现在取 `var(--topbar)` → `var(--c-chrome)`，而 xterm 画布自带 `--term-bg` 底，所以终端背后的表面必须与它一致：`#terminal` 用 `var(--term-bg)` 而不是 chrome 类 token，并写注释说明，因为 chrome 底色与 xterm 画布之间的色差是一条你否则会反复追的一像素缝。`.session-toolbar` 用 `var(--c-chrome)` 加 `border-bottom: 1px solid var(--line)`。`#sftp` 用 `var(--c-surface)`，去掉 `--legacy-shadow-sheet` 改用 `border-top: 1px solid var(--line)`。`.file-row:hover` 用 `var(--overlay-hover)`。`#sftp-path` 与 `.file-size`/`.file-time` 保持 `--font-mono` 并用 `var(--tx-3)`。`.tag.link` 用 `var(--warn)`/`--warn-bg`/`--warn-line`。

- [ ] **Step 9: 逐文件验证，最后整体验证**

```powershell
node --test "packages/ui/tests/*.test.mjs"
npm run typecheck
npm run build:web
```
预期：全绿，且登记表已无人引用。确认：

```powershell
Select-String -Path packages/ui/src/styles/base.css, packages/ui/src/styles/chrome.css, packages/ui/src/styles/hosts.css, packages/ui/src/styles/inspector.css, packages/ui/src/styles/keychain.css, packages/ui/src/styles/terminal.css, packages/ui/src/styles/states.css -Pattern 'var\(--(topbar|nav|main|card|field|text|accent|warning)|var\(--legacy-)'
```
预期：无匹配。

- [ ] **Step 10: 提交**

```bash
git add packages/ui/src/styles
git commit -m "feat(ui): repaint the interface in the neutral graphite ramp"
```

---

### 任务 4：删除登记表

**文件：**
- 删除：`packages/ui/src/styles/legacy.css`
- 修改：`packages/ui/src/style.css`
- 修改：`packages/ui/tests/stylesheet-contract.test.mjs`、`packages/ui/tests/visual-contract.test.mjs`、`packages/ui/tests/design-tokens.test.mjs`

- [ ] **Step 1: 先把守卫缩小**

在 `stylesheet-contract.test.mjs` 里：`EXEMPT = new Set(['tokens'])`、`SANCTIONED = ['tokens']`，并删除 `LEGACY_DECLARATIONS`、计数断言、分号等值检查、活性测试与 `UNREFERENCED_LEGACY`。保留引用方向测试 —— 它现在校验灰阶自洽，是防止 `var(--不存在的)` 上线的那道守卫。

在 `visual-contract.test.mjs` 里：从钉住的顺序数组去掉 `'legacy'`，并替换那条已退役别名循环：

```js
  for (const token of ['--c-canvas', '--c-surface', '--tx-1', '--tx-3', '--ac', '--ok', '--err', '--line']) {
    assert.match(css, new RegExp(`${token}\\s*:`), `missing design token ${token}`)
  }
```

- [ ] **Step 2: 跑测试，确认它因为正确的原因失败**

运行：`node --test packages/ui/tests/stylesheet-contract.test.mjs`
预期：FAIL —— 清单还引入 `legacy.css` 而它已不在豁免里，或豁免对断言触发。这就是守卫在起作用：删除与缩小必须同批落地。

- [ ] **Step 3: 删除**

```bash
git rm packages/ui/src/styles/legacy.css
```
从 `packages/ui/src/style.css` 移除 `@import "./styles/legacy.css";`，并更新它的文件头注释 —— 注释现在说颜色字面量允许出现在两个文件，改成一个。

- [ ] **Step 4: 跑全部**

```powershell
node --test "packages/ui/tests/*.test.mjs"
npm run typecheck
npm run build:web
npm run verify
```
预期：全绿。若引用检查指出一条悬空的 `var(--legacy-*)`，说明任务 3 漏了一处替换 —— 修调用处，永远不要修豁免清单。

- [ ] **Step 5: 提交**

```bash
git add packages/ui/src/style.css packages/ui/tests
git commit -m "refactor(ui): delete the legacy palette register"
```

---

### 任务 5：同步 CSS 之外的四处颜色持有者

**文件：**
- 修改：`packages/ui/src/index.html:15`
- 修改：`apps/desktop/electron/app/shell.ts:61,67-68`
- 测试：`packages/ui/tests/theme-sync.test.mjs`

- [ ] **Step 1: 先写失败的测试**

规格的"单一来源"规则延后到本计划。新建 `packages/ui/tests/theme-sync.test.mjs`：

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const ui = (p) => readFile(new URL(p, import.meta.url), 'utf8')
const [tokens, html, shell] = await Promise.all([
  ui('../src/styles/tokens.css'),
  ui('../src/index.html'),
  ui('../../../apps/desktop/electron/app/shell.ts'),
])

function declaration(name) {
  const match = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(tokens)
  assert.ok(match, `${name} is not declared as a hex value in tokens.css`)
  return match[1].toLowerCase()
}

test('the four out-of-CSS colour holders agree with the ramp', () => {
  const chrome = declaration('--c-chrome')
  const muted = declaration('--tx-3')
  const meta = /name="theme-color" content="(#[0-9a-fA-F]{6})"/.exec(html)
  assert.ok(meta, 'index.html lost its theme-color meta')
  assert.equal(meta[1].toLowerCase(), chrome, 'theme-color must equal --c-chrome')
  const bg = /backgroundColor:\s*'(#[0-9a-fA-F]{6})'/.exec(shell)
  assert.ok(bg, 'shell.ts lost its backgroundColor')
  assert.equal(bg[1].toLowerCase(), chrome, 'the window background must equal --c-chrome')
  const symbol = /symbolColor:\s*'(#[0-9a-fA-F]{6})'/.exec(shell)
  assert.ok(symbol, 'shell.ts lost its overlay symbolColor')
  assert.equal(symbol[1].toLowerCase(), muted, 'the overlay symbols must equal --tx-3')
})

test('the overlay height agrees with the top bar the CSS draws', async () => {
  const chrome = await ui('../src/styles/chrome.css')
  const overlay = /height:\s*(\d+),/.exec(shell)
  assert.ok(overlay, 'shell.ts lost its overlay height')
  const rows = /#app\s*\{[^}]*grid-template-rows:\s*(\d+)px/.exec(chrome)
  const fallback = /env\(titlebar-area-height,\s*(\d+)px\)/.exec(chrome)
  assert.ok(rows && fallback, 'chrome.css lost the 76px top bar geometry this must match')
  assert.equal(overlay[1], rows[1], 'the overlay height must equal the #app grid row')
  assert.equal(overlay[1], fallback[1], 'the overlay height must equal the top bar fallback height')
})
```

- [ ] **Step 2: 运行测试，确认失败**

运行：`node --test packages/ui/tests/theme-sync.test.mjs`
预期：FAIL —— 三处字面量仍是 `#121426` 与 `#a1a5bb`。

- [ ] **Step 3: 更新三处字面量**

`index.html:15` → `content="#0e1013"`。`shell.ts:61` → `backgroundColor: '#0e1013'`。`shell.ts:68` → `symbolColor: '#7d838d'`。`height: 76` 不动。`shell.ts:64` 的 `titleBarStyle: 'hidden'` 不动。

- [ ] **Step 4: 跑全部，包含 Electron 路径**

```powershell
node --test packages/ui/tests/theme-sync.test.mjs
npm run verify
npm run verify:electron
```
预期：全绿。`verify:electron` 必须在这里跑而不是延后：`apps/desktop/tests/electron-desktop-entry.mjs` 断言 `.app-topbar` 是拖拽区，而本计划动了顶栏的颜色与边框。

- [ ] **Step 5: 提交**

```bash
git add packages/ui/src/index.html apps/desktop/electron/app/shell.ts packages/ui/tests/theme-sync.test.mjs
git commit -m "fix(ui): keep the window chrome colours in sync with the ramp"
```

---

### 任务 6：补回地基留下的发丝线对比度，并写文档

**文件：**
- 修改：`packages/ui/src/styles/inspector.css`
- 修改：`packages/ui/tests/design-tokens.test.mjs`
- 修改：`docs/design-system.md`、`docs/design-system_zh.md`、`CHANGELOG.md`、`CHANGELOG_zh.md`、`docs/architecture.md`、`docs/architecture_zh.md`
- 修改：`packages/ui/src/lib/changelog.ts`（仅生成）

- [ ] **Step 1: 重新量 `.ssh-section` 的分隔线**

转交清单第 4 项：这条分隔线从 `rgba(222,226,255,.1)` 变成 `.05` 的 `--legacy-line-faint`，对 `--nav` 是 1.311:1 → 1.141:1。任务 3 把它收拢到 `--line-soft`，对 `--c-surface` 实测 1.106:1 —— 同样的亏欠。抬到 `var(--line)`（1.269:1），数字写进提交信息。并确认没有其他被收拢的发丝线跌到所压底色之下 1.2:1；列出你检查过的每一条。

- [ ] **Step 2: 加一条发丝线下限断言**

追加到 `packages/ui/tests/design-tokens.test.mjs`。发丝线不是文字，但"看不见"确实是缺陷：

```js
test('hairlines stay perceptible on the surface they sit on', () => {
  for (const selector of THEMES) {
    for (const [line, ground] of [['--line', '--c-surface'], ['--line-strong', '--c-surface'], ['--line', '--c-chrome']]) {
      const got = ratio(rgbTriplet(token(selector, line)), hex(token(selector, ground)))
      assert.ok(got >= 1.15, `${selector} ${line} on ${ground} is ${got.toFixed(3)}:1, needs 1.15:1`)
    }
  }
})
```

用文件已有的解析器；`rgba()` 的 token 值必须走同一个三元组读取路径。若现有辅助函数不做合成就直接算比值，请显式把半透明色合成到 `ground` 上并说明 —— `rgba(255,255,255,.06)` 压在 `#131519` 上，既不等于前者也不等于后者。

- [ ] **Step 3: 更新设计系统文档**

两种语言都要。`docs/design-system.md` 现在必须写：颜色字面量只允许出现在一个文件；登记表已不存在；发丝线是三级以及从旧七级的映射；`--r-4` 存在且为什么存在；深色的阴影已去除、只剩 `--shadow-pop`；`--legacy-on-solid` 归入 `--tx-1` 而没有变成新 token；任务 1 Step 3 得到的状态色压自身半透明底的比值；`.ssh-section` 分隔线用 `--line`；以及浅色组待计划三才可激活。本计划改动了哪些数字 —— 字节数、token 计数、消费者普查 —— 全部重算后再写，不要手改。

- [ ] **Step 4: 记录用户可见的变更**

`CHANGELOG.md` 与 `CHANGELOG_zh.md`，`[Unreleased]` 下：

```markdown
### Changed
- The interface now uses the neutral graphite palette: the blue-violet cast is
  gone, surfaces separate by luminance and hairlines instead of by shadows, and
  status colours, scrollbars, avatars and translucent fills were retuned to
  match. The navigation sidebar, top bar and terminal tab layout are unchanged;
  the chrome rebuild that follows will change them.
```

然后：

```powershell
node scripts/convert-changelog.js
node scripts/convert-changelog.js --sync-version
```

- [ ] **Step 5: 更新 `docs/architecture.md` 及其中文配对**

地基计划加进去的那句话把两个文件称为颜色持有者，现在是一个。两种语言都改。

- [ ] **Step 6: 验证**

```powershell
node --test "packages/ui/tests/*.test.mjs"
npm run verify
npm run verify:electron
npm run release:check
git diff --check
```
预期：全绿，`release:check` 报 `0.1.0-alpha.1` 有效。然后逐条人工确认你改过的相对链接可解析 —— 本仓库没有 Markdown 链接脚本，并说明你用的就是这个办法。

- [ ] **Step 7: 提交**

```bash
git add packages/ui/src/styles packages/ui/tests docs/ CHANGELOG.md CHANGELOG_zh.md packages/ui/src/lib/
git commit -m "docs(ui): document the graphite palette flip"
```

---

### 任务 7：看它

**文件：** 无 —— 本任务不改任何东西，也不许跳过。

- [ ] **Step 1: 两个入口都跑起来**

```powershell
npm run start:web
npm run start:desktop
```

- [ ] **Step 2: 逐项检查本次翻转可能产生的具体故障**

对运行中的应用逐条报告：(a) 100% 缩放下有没有哪条发丝线在你实际用的显示器上消失；(b) 选中的主机行能否一眼区分于 hover 行与未选中行；(c) 四种主机头像色收拢成一个中性底，是否让列表*更难*扫读 —— 那些色曾经是唯一能辅助扫读的颜色，失去它们可能是损失而不是净化；(d) 取 `--ac-bg` 的活动导航项，在没有旧灰块的情况下是否仍 Clearly 是活动项；(e) 失败页在只有一种红时是否仍读得成"出错"；(f) 去掉 `.host-row:hover` 的抬升后，hover 是否变成死手感；(g) 阴影全撤之后，抽屉、SFTP 面板、对话框是否仍与背后的内容分离。

- [ ] **Step 3: 确认终端接缝**

有非生产主机就开一次真会话；没有就直说你没开。检查 xterm 画布底与 `#terminal` 背景相接的那一条线，以及 `.terminal-pane` 内边距透出来的地方。

- [ ] **Step 4: 诚实汇报**

检查不了的，明说。上面任何一条翻转使界面变差的地方，记为计划三的输入，而不是现在偷偷调一个 token —— 在一套全绿的测试下改值，正是这套灰阶第一次长出七份手抄颜色的方式。

---

## 完成标准

- `legacy.css` 不存在，且 `tokens.css` 是项目里唯一含颜色字面量的文件，由测试强制。
- `theme-sync.test.mjs` 把 `index.html` 的 meta 与 `shell.ts` 的两处字面量拴到灰阶上，并把 overlay 高度拴到 CSS 顶栏上。
- `npm run verify` 与 `npm run verify:electron` 通过；地基新增的 ANSI 绑定会在状态色被单独调整时失败。
- 界面在每个屏都读作中性石墨，布局不变。
- `docs/design-system.md` 与其中文配对与代码一致，包括所有数字。
- 浅色组正确但仍不可达，且文档这么写。

## 不在本计划内

- 计划三：外壳重建 —— 52px 图标轨道、删除 `#nav-toggle` 与 `.nav-collapsed`、会话标签进顶栏、用真正存在的字段搭 24px 状态栏、内联 SVG 品牌标记、favicon、删除 `.window-control` 死 CSS、76px 顶栏降到 40px、让浅色可达的主题开关、以及 `data-density`。
- 计划四：各屏 —— hosts 与 keychain 表格、右固定 Inspector、可拖拽 SFTP 分栏、四态、toast、失败诊断、断点从六个合并为三个。
- 两个后续计划继承本计划的规则：`tokens.css` 之外不得有颜色字面量，每个 `var(--x)` 必须指得到已声明的 token。

---

## 执行所发现的

**任务六**落成两个提交。`666737b` 增加了 `every hairline stays perceptible against the ground it is drawn on` —— 位置在 `stylesheet-contract.test.mjs`，而不是本计划所写的 `design-tokens.test.mjs`，因为能读取各分片的那个文件，才是能看见"哪些配对真的被画了出来"的那个文件。一张 token 配对的矩阵会为三十六条没人画的组合作保，而那条唯一真实存在的组合消失时它照样通过。它从七个内容分片里收集 28 条规则，逐条在两个主题下测量，低于 1.1:1 即失败。拿它去量翻转自己的产出时，发现了映射表看不见的两处相撞：浅色的 `--line-soft` 是 `#eceef1`，与浅色的 `--c-inset` 同一个值，于是画在那个字面上的分隔线算出来恰好是 1.000；而深色的 `--line-soft` 在 `--c-raised` 上是 1.034。于是六处声明各上调一档 —— 四处分隔线由 `--line-soft` 到 `--line`（密钥库外壳的边、`terminal.css` 里的两条规则、主机卡片分隔线），以及 `.tag` 与 `.action-split` 在它们的 `--c-control` 填充上由 `--line` 到 `--line-strong`。`62d55be` 用从代码树上量来的数字重写了 `docs/design-system.md` 与它的中文配对：token 计数、字节列、消费者普查、语义色在自己着色底上的比例矩阵、完整的"逐底面逐主题"合法性矩阵，以及登记簿那一节 —— 它现在已经是历史了。

**任务七 —— 走到工具能走的地方为止，以下是那个边界。** 内置浏览器给出过一个可见表面（886×772，显示缩放 150%），随后整个会话都停在 `visibilityState=hidden`，所以截图只有一张，下面的其余内容都是从活页面上读出的计算值。页面跑在一份一次性夹具存储上 —— `SSH_CORDIS_WEB_DATA_DIR` 指向一个临时目录，里面放着六条假主机记录 —— 并且**没有向任何主机发起过连接**，两个方向都没有。该目录已删除。

- (a) *100% 缩放下的细线*：外壳的边都在 —— `.app-topbar` 下边与 `.primary-nav` 右边都画着 `--line` 压在 `--c-chrome` 上，1.323:1；搜索行 1.269:1。活页面上最弱的一对是 `.host-row` 自己的边框，**1.106:1**，恰好就是守卫那条地板：在密集的列表里，未选中的行读起来像没有边框，一行是靠长出 1.635:1 的悬停边来宣告自己的。列为计划三的输入，此刻不重调。
- (b) *选中 / 悬停 / 未选中*：是三种不同的信号，而不是三种强度 —— `rgb(19, 21, 25)` 配 1.106 的边、`rgb(25, 28, 33)` 配 `--line-strong` 的 1.635 边、`rgb(28, 39, 53)` 配蓝色的 `--ac-line` 边。三者里有两个会改色相，因此一眼可分。
- (c) *四个头像色调*：六行全部算成同一块底，`--c-control` 的 `rgb(33, 37, 43)`，上面是 13.87:1 的 `--tx-1` 字形。色调区分没有替代品，于是扫列表完全由文字带着走。这是那七项里唯一移除信息而不只是移除颜料的一项，答案归计划三。
- (d) *`--ac-bg` 的活动导航项*：压在 `--c-chrome` 上合成出 `rgb(23, 35, 47)`，相对轨道 1.196:1；而兄弟项悬停时拿到 `--overlay-hover` 的 1.140:1 —— 亮度只差 0.05，仅靠色相分开。那张截图里活动项确实读得出是活动项，而规格里承诺的强调色左缘标记才是让它毫无歧义的东西。
- (e) *一抹红的失败页*：**没有实机走过**，因为那需要一次被拒的连接。改从活页样式表读取：`--err` 承担四个角色 —— `.failure-route-node`、实心的 `.failure-route-line`、外壳的 `h2`、`.failure-log-entry.is-error i` —— 而标题仍是压在 `--c-canvas` 上的 `--tx-1`，日志面板是 `--c-inset` 配 `--line`。这一页是靠位置读成错误的，不是靠饱和度。
- (f) *去掉抬升之后的悬停*：`.host-row` 用 180ms 的 `--ease` 过渡 `background-color` 与 `border-color`，于是状态变化仍有动画，只是落在边上而不是落在几何上。这读起来是不是"发死"，是本次会话没能完成的眼力判断。它另外给出一个该写进文档的事实：时长是手写的 `180ms`/`160ms`，离 `--t-*` 刻度差 20ms，而紧挨着它的曲线是 token。
- (g) *没有阴影时的分隔*：`.drawer-footer` 是 `--c-chrome` 配 `--line`，`#sftp` 是 `--c-surface` 配 `--line`，而 `.shortcuts-dialog` 保留 `--shadow-pop` 罩在 `--scrim` 之上 —— 唯一浮起来的表面，正是设计想要的形状。SFTP 面板始终没能被打开看到。
- *终端接缝*：**没有检查。** 没有打开过任何会话，所以 DOM 渲染器底色与 `#terminal` 的 `--term-bg` 相接处，在两个入口上都未经检验。

因此 (c)、(d)、(f)、(g) 四项成为计划三的第一个检查点，而不是现在就去重调某个取值：在一套全绿的测试下面改值，正是当年那份登记簿长出自己的第二套手工拷贝颜色的方式。

**一个值得记下的事实。** 构建出的 `packages/ui/dist/app.css` 携带 56 个十六进制字面量：50 个在两个主题块之内，另外六个属于 `@xterm/xterm/css/xterm.css` 里的 `.composition-view` 及其同族。没有任何测试读取摊平后的那张表；这个数是手工量出来的，如今写进 `docs/design-system.md`，好让下一位读者不必重新推算那六个从何而来。
