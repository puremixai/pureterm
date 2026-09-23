# Token 地基实施计划

[English version](2026-09-23-token-foundation.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 让 `packages/ui` 变得 token 有据可依、并重排字体，使之后每一个视觉改动都是改 token，而不是在样式表里翻找。

**架构：** 把 581 行的 `style.css` 按职责拆成八个分片，藏在 `style.css` 清单文件后面；在 `styles/tokens.css` 里定义完整的中性石墨 token 集（深色 + 浅色）；然后把旧规则里所有硬编码字面量替换为一个具名的 legacy token 块。新增的单元测试会让任何 token 块之外的字面量直接失败，这才让这笔债变得不可再犯。外观只在若干次刻意的小步进变化；石墨配色本身的翻转属于计划二。

**技术栈：** 纯 CSS、esbuild（现有浏览器构建）、Node 内置测试运行器 `node --test`、`@fontsource-variable/inter`。

**规格：** `docs/superpowers/specs/2026-09-23-frontend-professional-redesign.md` —— 本计划实现其中的提交 1 与 2，以及文档提交里 token 那一半。

**分支：** 在 `feat/ui-redesign` 上工作，绝不在 `main` 上。

---

## 本计划范围

spec 列了六个提交。提交 1–2 在这里。提交 3–5（chrome、hosts/keychain 表格、SFTP 分栏、四态、失败诊断）需要先有计划一的成果，因为它们消费 token 块；提交 6 的 CHANGELOG 那一半在这里，`docs/architecture.md` 那一半移到计划三的末尾。

**刻意偏离 spec 的文件清单，在此记录以免变成静默改动：** spec 的 `states.css` 覆盖"skeleton, four states, toast, dialog"。连接失败相关规则（旧 `style.css:411-440`）也落进 `states.css`，因为诊断、四态和 toast 是同一个职责，把它们拆到两个文件会把一起变化的代码分开。不新增文件。

## 为什么允许 legacy token 块

`tokens.css` 会新增大约 55 个条目，按每个旧字面量*当前做什么*来命名（`--scroll-thumb`、`--tint-ok`、`--fail-log-icon`）。多数会存活到最终体系里。那些一次性的条目存在的唯一理由，是让"禁止字面量"这条测试能在本计划里就打开。计划二的配色翻转会在一个提交内删掉整块。不要往块里加东西 —— 要么引用已有条目，要么记为后续事项。

有评审建议把登记表单独放进 `styles/legacy.css`，好让计划二用一次 `git rm` 删掉。此建议被否决：它原本的动机是 `block(':root')` 会在追加了巨大 body 后解析出错，而任务 1 的加固提交已经改成锚定选择器、先剥注释、并拒绝嵌套 `{`，隐患不复存在。一个文件一份契约比两个文件更好推理，而且翻转提交本身的 `git show` 已经把删除隔离开了。

## 任务 1 与任务 2 评审后的修订

任务 1 以 `432c72e` 落地，并由 `6b89946` 加固：浅色 `--idle` 改为 `#7e8590`（`#c9ced5` 在 surface 上 1.58:1、在 chrome 上 1.385:1），`--font-term` 补回了早期草稿从 `terminal-view.ts:21` 实际使用的栈里丢掉的 `"Sarasa Mono SC"` 与 `"Microsoft YaHei Mono"` 两级回退，测试改为先剥注释、按行首锚定选择器再解析，测试数从 5 增至 9。任务 2 以 `bd50adf` 落地。对任务 2 的独立评审确认搬迁完整且行为中性，同时发现本计划有五处错误。它们记录在这里，而不是回填进各任务正文，因为任务正文才是下一位工程师读的东西。

1. **任务 2 Step 5 的比较方法无法达成。** 它要求前后 `dist/app.css` 按行排序后相等，但本提交是 `tokens.css` 第一次进入产物，且 esbuild 会重新换行被拆开的 `@media` 块。应改为解析成 `(media 上下文, 选择器, 声明)` 三元组比对，并按 `(选择器, 属性)` 检查值序列以捕捉顺序问题。
2. **任务 2 Step 4 的行号区间有四处缺口**，实施时已按判断补齐：旧 `494-495`（`body { overflow: auto }`、`#app { height: auto }`）不属于任何分片；旧 `255`（`#host-direct-key`）不属于任何分片；hosts 写的 `575-576` 差了两行 —— `575` 是 `.session-tab`、`576` 是 `#terminal`，hosts 实际拥有的是 `573-574`；states 写的 `219-222` 与下方的跨文件说明冲突，以说明为准，`.keychain-empty` 留在 `keychain.css`。
3. **"修清单顺序，不要修规则"并不总是可行，而且两处被迫搬动里有一处本可避免。** `.app-body` 的顺序环是真的 —— base 的 `278px`、`1250px` 覆盖和 `820px` 覆盖被分配到两个文件，任何线性引入序列都无法满足 chrome → hosts → chrome。但只要把 `.app-body` 的 `232px` 与 `72px` 两行都放进 `chrome.css`、紧挨 base 规则，环就消失，而这正是本计划自己那条选择器前缀规则所要求的；该摆放经 367,224 个采样胜出者验证，级联零差异。`hosts.css` 不该拥有一个外壳栅格规则。这里该避免的是把同一个 `@media` 块拆到两个文件，而不是拆分声明。
4. **`.keychain-content h1 { font-size: 20px }` 是死规则。** `index.html:85` 让 "Keys" 标题这一个元素同时带 `.keychain-content` 与 `.hosts-heading`，所以 23px 那条规则在拆分之前就一直赢。任务 2 搬迁它是为了保护一个从未生效的关系。删掉这条规则；留着它会让任务 5 的 Step 7 把一条死声明映射到 `--fs-h1`，使这个 token 看起来已被消费。
5. **清单顺序是承重的，却没有任何东西断言它。** 八个分片的顺序几乎被完全钉死：40,320 种排列里只有 56 种满足既有顺序依赖，删掉任一分片测试仍全绿，而那条名为"清单拥有层叠顺序"的测试只检查了 `@import`。应改为解析 `style.css` 得出分片列表、断言其等于预期的八个且顺序一致，并按这个派生顺序读取分片，让测试的见证不再可能与实际产物分叉。

另有三项决定被改变：

- **任务 3 既不要就地加前缀，也不要把登记表留在 `tokens.css` 里。** 它 24 条里只有四条自称是债，另外二十条读起来像永久 token，于是配色翻转得依赖一份只存在于过期文档里的删除清单。给 24 条全加 `--legacy-*` 固然能解决，代价是在约 102 处字面量替换之上再叠约 90 处机械引用改写 —— 为改而改。改为：任务 3 把整块登记表移进 `packages/ui/src/styles/legacy.css`，由清单在 `tokens.css` 之后紧接着引入。于是 `tokens.css` 只剩新体系，`var(--nav)` 之类原样继续工作，禁止字面量的测试排除两个文件而不是一个，计划二的删除变成一次 `git rm` 加一行清单。这推翻本文档早前对独立 `legacy.css` 的否决：当初否决靠的是 `block(':root')` 解析隐患，而任务 1 的加固已经关掉它，且文件给出的边界是机器可读的，不只是"写在文档里"。`--line`、`--line-soft`、`--line-strong` 仍可分辨 —— 前两者中 `--line` 的旧值在 `legacy.css`，`--line-soft` 属于新灰阶；注意它当前引用数为零。
- **计划里的测试文件归属是错的。** `design-tokens.test.mjs` 被它读取的文件钉死在 `tokens.css` 上，所以任务 3–5 不得把颜色字面量扫描、`Inter` 引入断言、`font-weight` 普查、`.ti` 钉死、以及 `terminal-view.ts` 源码检查塞进它。按主题拆开：`design-tokens.test.mjs` 保留主题一致性、对比度与登记表核算；新建 `stylesheet-contract.test.mjs` 负责清单顺序与派生的分片列表、跨分片禁止字面量、字重普查、`.ti` 钉死与 Inter 引入；新建 `terminal-theme.test.mjs` 负责 `terminal-view.ts` 的源码契约。派生出的分片列表通过一个非测试的 `.mjs` helper 共享，`client-lifecycle-entry.mjs` 已是这个模式。`test:unit` 现有通配会自动带上这些文件，无需接线。
- **任务 3 Step 3 的代码块必须一行一个 token。** 草稿里有一行塞了两条声明，而 `token()` 按行首锚定查找、`names()` 不锚定，于是这样的行上第二个名字对取值查找不可见。保持文件扁平、一行一条。

两件小事并进任务 5：它目前只把 `font-size` 字面量转成 `--fs-*`，却把六份硬编码的 `"Cascadia Mono", Consolas, monospace`（散在五个分片加 `terminal-view.ts:21`）留在原地，而 `--font-mono` 与 `--font-term` 无人使用 —— 把 `font-family` 也纳入清扫。另外给每个分片加上 `keychain.css:1` 那样的单行职责头注释，八个分片里现在只有两个有。

## 任务 5 在执行中发现的修正

任务 5 以 `9ef25b8` 落地。它的指令里有五条不成立，其中第一条逼出了一个计划未预期的结构变化：

- **`@fontsource-variable/inter` 不提供按字重或按子集切分的文件。** `5.3.0` 只有 `index.css`、`standard.css`、`wght.css`、`opsz.css` 及其斜体变体，而每一个都声明全部七个子集。Step 4 要求的 `…/latin-400.css` 引入方式不可能实现；改引入 `wght.css` 会产出 218,520 字节的希腊文、西里尔文和越南文字形，而本页面永远渲染不到它们。
- **于是字面改为在第十个分片 `styles/fonts.css` 里本地声明**，它是唯一允许把字体族名当字面量写的地方。该文件针对包内的 `inter-latin-wght-normal.woff2` 与 `inter-latin-ext-wght-normal.woff2` 声明两条 `@font-face`，产出合计 133,324 字节。有一条测试拴住这个对应关系：声明的族名必须等于 `--font-ui` 的首项 —— 因为若只引入包自带的 CSS 而名字不匹配，就会一边交付 130 KiB 字体、一边继续静默渲染 Segoe UI Variable Text。描述符用 `format('woff2')` 而非上游遗留的 `format('woff2-variations')`，字重轴由 `font-weight: 100 900` 提供；包里族名是 `Inter Variable`，这里刻意叫 `Inter`，因为不为这件事去改 `tokens.css`。
- **staging 会跳过 `@pureterm/ui` 的依赖**，所以 1.82 MiB 的包目录不会进安装包 —— 字体的 OFL 许可文本也就不会。因此必须有一段 `/*!` 归属块，因为 esbuild 保留 `/*!` 而丢弃普通注释。
- **`--font-term` 与 `terminal-view.ts` 里那段字面量从来不是逐字节相同**，早前的任务书说错了：任务 1 的加固是给 token **加上** `"Sarasa Mono SC"` 与 `"Microsoft YaHei Mono"`，而字面量本来就有。两者作为族列表相同，这才使 `read('--font-term')` 是保值的替换。该字面量的位置也从 `:21` 移到了 `:43`。
- **计划把硬编码等宽栈数少了：是七处，不是六处。** 第七处是 `terminal.css` 里 `#session-address` 的 `Consolas, monospace`，也一并清扫了。
- **`--font-mono` 首选项 `"JetBrains Mono"` 并未打包**，所以外壳等宽实际解析到机器上的 JetBrains Mono、Cascadia Mono 或 Consolas 之一。这是字体栈的正常行为而非缺陷，但它确实意味着 `--font-mono` 与 `--font-term` 目前只差在 CJK 回退上。两个名字都保留 —— 一个是外壳等宽、一个是终端等宽 —— 并记录它们今天取值相同。是否打包 JetBrains Mono 是一个后续决策，且附带体积代价。

一个供任务 6 记录而非修复的已知缺口：`#keychain-fingerprint` 是没有 `font-family` 的 `<code>`，因此它走 UA 等宽而不是 `--font-mono`。

## 转交给计划二的事项

任务 3 以 `d893346` 落地，并由 `8e7541d` 加固。`packages/ui/src/styles/legacy.css` 现在是那张登记表：100 条声明，其中 96 条是颜色，由一条声明数棘轮和一条引用活性检查（带一个条目的白名单）守着。配色翻转必须处理四件事，其中三件没有任何代码会警告：

1. **登记表里有四条不是颜色，不能直接删。** `--radius-sm` 7px、`--radius-md` 10px、`--radius-lg` 15px，而新灰阶是 3/5/8px；`--motion-standard` 是 `cubic-bezier(0.32, 0.72, 0, 1)`，而 `--ease` 是 `cubic-bezier(0.2, 0.8, 0.2, 1)`。四者合计 22 处活引用，其中 14 处只来自 `--motion-standard`。把它们安家是一次**有量测的渲染决策** —— 要么加宽灰阶，要么重调 22 个值 —— 不是搬一行。运行 `git rm` 之前，计划二必须先给出这四条的旧到新映射表。
2. **`visual-contract.test.mjs:26` 断言 `--topbar`、`--nav`、`--card`、`--text-strong`、`--accent` 存在。** 五个全是翻转要删的颜色别名，所以这条断言必须在同一个提交里改写，否则翻转会以错误的理由让测试失败。
3. **收缩登记表要改两个测试文件，这是故意的。** `stylesheet-contract.test.mjs` 钉住声明条数、被批准的豁免对、以及引用活性白名单；若新增度量层级，`design-tokens.test.mjs` 的 `GLOBAL_TOKENS` 也要跟着长。故意留两处，让删除不可能悄无声息。
4. **`.ssh-section` 的分隔线在任务 3 里丢了对比度** —— `rgba(222,226,255,.1)` 被映射到 `.05` 的 `--legacy-line-faint`，因为登记表里没有 `.10` 的发丝线条目。它在计划容忍范围内，也落在翻转本来就要去的地方附近（`--line-soft` 是 1.106:1，`--line` 是 1.269:1），但请重新量测到新的灰阶上，而不是继承它。

计划二还需知道：`legacy.css` 没有浅色组，所以 100 条在浅色模式下全是深色 —— 文件活着时这是对的，文件没了就是一处单行改动。另外 `white` 还留在三处字面量正则看不见的地方：`\bwhite\b` 同时匹配 `white-space`，而这些分片里 `white-space` 出现 13 次，所以要捕获具名颜色需要一条能识别取值位置的规则，而不是更宽的词表。

任务 4 又添了两条：

5. **`index.html:15` 仍带着 `<meta name="theme-color" content="#121426">`** —— 一处住在"没有任何守卫读取的文件"里的旧色板字面量，如今与任何实际渲染都不对应。它属于翻转欠下的那条主题同步断言。
6. **`--term-*` 组完全没有 CSS 消费者。** 它唯一的读取方是 `terminal-view.ts`，而任何 CSS 守卫都不扫描 `.ts`，所以 `terminal-theme.test.mjs` 是拴住它的唯一一根线，配色翻转无法透过样式表"看见"终端。另需知道：xterm 6 在这里只有 DOM 渲染器（`_createRenderer()` 返回 `DomRenderer`，未加载 canvas 插件），而该渲染器在构造时就把选区的 alpha 预混合了 —— `--term-selection` 声明的 `.24` 实际画出的是 `#1c3045`。在 canvas 或 gpu 渲染器落地之前，那个 alpha 只是装饰；而它一旦落地，同一个 token 会渲染成别的样子。

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `packages/ui/src/style.css` | 仅清单：Tabler 引入，然后按层叠顺序引入八个分片 |
| `packages/ui/src/styles/tokens.css` | `:root` 新灰阶 + legacy 块；`[data-theme="light"]` 只含新灰阶 |
| `packages/ui/src/styles/base.css` | reset、元素默认值、按钮/输入、焦点环、滚动条、reduced motion |
| `packages/ui/src/styles/chrome.css` | `#app` 栅格、顶栏、工作区/会话标签、导航轨道、shell 状态类 |
| `packages/ui/src/styles/hosts.css` | 主机面板：页头、搜索、主机列表、行、卡片、标签 |
| `packages/ui/src/styles/inspector.css` | 连接表单：抽屉外壳、分组、字段、页脚 |
| `packages/ui/src/styles/keychain.css` | 密钥库列表、编辑器、策略横幅、拖放区 |
| `packages/ui/src/styles/terminal.css` | 终端表面、xterm 覆盖、会话工具条、SFTP 面板 |
| `packages/ui/src/styles/states.css` | 空态、失败诊断、快捷键对话框 |
| `packages/ui/tests/design-tokens.test.mjs` | 主题一致性、对比度、禁止杂散字面量、终端色板同步 |

---

## 任务 1：建立含两套主题组的 token 文件

**文件：**
- 新建：`packages/ui/src/styles/tokens.css`
- 测试：`packages/ui/tests/design-tokens.test.mjs`

- [ ] **Step 1: 先写失败的测试**

新建 `packages/ui/tests/design-tokens.test.mjs`。它解析 token 文件而不是靠肉眼核对，这样将来给某一套主题加变量时，无法悄悄漏掉另一套，且对比度是算术而不是观点。

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const css = await readFile(new URL('../src/styles/tokens.css', import.meta.url), 'utf8')

function block(selector) {
  const start = css.indexOf(selector)
  assert.notEqual(start, -1, `missing token block ${selector}`)
  const body = css.slice(start + selector.length)
  const open = body.indexOf('{')
  const close = body.indexOf('}', open)
  return body.slice(open + 1, close)
}

function names(text) {
  return [...text.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1])
}

function hex(text) {
  const value = text.trim().replace('#', '')
  const full = value.length === 3 ? [...value].map((c) => c + c).join('') : value.slice(0, 6)
  return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16))
}

function luminance(color) {
  const channel = color.map((byte) => {
    const srgb = byte / 255
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channel[0] + 0.7152 * channel[1] + 0.0722 * channel[2]
}

function ratio(foreground, background) {
  const [a, b] = [luminance(foreground), luminance(background)].sort((x, y) => y - x)
  return (a + 0.05) / (b + 0.05)
}

function token(selector, name) {
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(block(selector))
  assert.ok(match, `missing ${name} in ${selector}`)
  return match[1].trim()
}

const THEME_TOKENS = [
  '--c-inset', '--c-canvas', '--c-chrome', '--c-surface', '--c-raised', '--c-control',
  '--line', '--line-soft', '--line-strong',
  '--tx-1', '--tx-2', '--tx-3', '--tx-4',
  '--ac', '--ac-hi', '--ac-bg', '--ac-fg',
  '--ok', '--warn', '--err', '--idle',
  '--term-bg', '--term-fg', '--term-cursor', '--term-selection',
]

// Metrics are theme-invariant: `:root` and `[data-theme="light"]` match the
// same element, so the light group inherits them. Repeating them would
// recreate the hand-synced duplicate debt this plan exists to remove.
const GLOBAL_TOKENS = [
  '--r-1', '--r-2', '--r-3', '--r-full',
  '--s-1', '--s-2', '--s-3', '--s-4', '--s-5', '--s-6',
  '--row-h', '--row-h-compact',
  '--z-drawer', '--z-popover', '--z-toast', '--z-dialog',
  '--t-1', '--t-2', '--t-3', '--ease',
]

test('both theme groups declare the same colour tokens', () => {
  for (const selector of [':root', '[data-theme="light"]']) {
    const declared = new Set(names(block(selector)))
    for (const name of THEME_TOKENS) {
      assert.ok(declared.has(name), `${selector} is missing ${name}`)
    }
  }
  const dark = new Set(names(block(':root')))
  const light = new Set(names(block('[data-theme="light"]')))
  for (const name of light) assert.ok(dark.has(name), `${name} exists only in the light theme`)
})

test('theme-invariant metrics are declared once, in :root only', () => {
  const dark = new Set(names(block(':root')))
  const light = new Set(names(block('[data-theme="light"]')))
  for (const name of GLOBAL_TOKENS) {
    assert.ok(dark.has(name), `:root is missing ${name}`)
    assert.ok(!light.has(name), `${name} must not be duplicated into the light theme`)
  }
})

test('text and accent tokens clear WCAG AA on their surfaces', () => {
  const pairs = [
    ['--tx-1', '--c-surface', 4.5],
    ['--tx-2', '--c-surface', 4.5],
    ['--tx-3', '--c-surface', 4.5],
    ['--tx-1', '--c-chrome', 4.5],
    ['--ac-fg', '--ac', 4.5],
    ['--ok', '--c-surface', 3],
    ['--warn', '--c-surface', 3],
    ['--err', '--c-surface', 3],
  ]
  for (const selector of [':root', '[data-theme="light"]']) {
    for (const [fg, bg, minimum] of pairs) {
      const got = ratio(hex(token(selector, fg)), hex(token(selector, bg)))
      assert.ok(got >= minimum, `${selector} ${fg} on ${bg} is ${got.toFixed(2)}:1, needs ${minimum}:1`)
    }
  }
})

test('--tx-4 stays decorative-only and is expected to fail AA', () => {
  for (const selector of [':root', '[data-theme="light"]']) {
    const got = ratio(hex(token(selector, '--tx-4')), hex(token(selector, '--c-surface')))
    assert.ok(got < 4.5, `--tx-4 measured ${got.toFixed(2)}:1; it must not be used for real text`)
  }
})

test('terminal tokens exist in both themes and stay dark', () => {
  for (const selector of [':root', '[data-theme="light"]']) {
    assert.ok(luminance(hex(token(selector, '--term-bg'))) < 0.02, `${selector} must keep a dark terminal`)
  }
})
```

- [ ] **Step 2: 运行测试，确认它失败**

运行：`node --test packages/ui/tests/design-tokens.test.mjs`
预期：FAIL —— `ENOENT` 或 `missing token block :root`，因为 `src/styles/tokens.css` 还不存在。

- [ ] **Step 3: 写 token 文件**

新建 `packages/ui/src/styles/tokens.css`，内容完全如下。此刻 `:root` 只有新 token；legacy 块在任务 3 的 Step 3 才加入。

```css
:root {
  color-scheme: dark;

  /* Neutral ramp. Hue is pinned to 210deg at <=5% saturation: depth is
     hierarchy, never mood. */
  --c-inset: #08090a;
  --c-canvas: #0a0b0d;
  --c-chrome: #0e1013;
  --c-surface: #131519;
  --c-raised: #191c21;
  --c-control: #21252b;
  --line: #262a31;
  --line-soft: #1c1f24;
  --line-strong: #3a4049;
  --tx-1: #f2f3f5;
  --tx-2: #b9bec6;
  --tx-3: #7d838d;
  --tx-4: #565b63;
  --ac: #5aaeff;
  --ac-hi: #7cc0ff;
  --ac-bg: rgba(90, 174, 255, 0.12);
  --ac-fg: #05070a;
  --ok: #4ec27f;
  --warn: #e0a83c;
  --err: #f2555a;
  --idle: #8b919b;

  /* Terminal keeps one dark group in both themes. A light shell over a
     dark canvas is the point, not an oversight. */
  --term-bg: #08090a;
  --term-fg: #c9ced6;
  --term-cursor: #5aaeff;
  --term-selection: rgba(90, 174, 255, 0.24);

  --r-1: 3px;
  --r-2: 5px;
  --r-3: 8px;
  --r-full: 999px;
  --s-1: 4px;
  --s-2: 8px;
  --s-3: 12px;
  --s-4: 16px;
  --s-5: 24px;
  --s-6: 32px;
  --row-h: 38px;
  --row-h-compact: 30px;
  --z-drawer: 20;
  --z-popover: 30;
  --z-toast: 40;
  --z-dialog: 50;
  --t-1: 100ms;
  --t-2: 160ms;
  --t-3: 240ms;
  --ease: cubic-bezier(0.2, 0.8, 0.2, 1);

  --font-ui: Inter, "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", "Cascadia Mono", Consolas, monospace;
  --font-term: "Cascadia Mono", Consolas, monospace;
  --fs-micro: 11px;
  --fs-meta: 12px;
  --fs-ui: 13px;
  --fs-em: 14px;
  --fs-h2: 16px;
  --fs-h1: 20px;
  --fs-term: 13.5px;
  --ring: 0 0 0 2px var(--c-canvas), 0 0 0 4px var(--ac);
  --shadow-pop: 0 8px 24px -6px rgba(0, 0, 0, 0.5);
}

[data-theme="light"] {
  color-scheme: light;

  --c-inset: #eceef1;
  --c-canvas: #f7f8f9;
  --c-chrome: #eef0f2;
  --c-surface: #ffffff;
  --c-raised: #f4f6f8;
  --c-control: #e8ebef;
  --line: #dfe3e8;
  --line-soft: #eceef1;
  --line-strong: #c6ccd4;
  --tx-1: #16181c;
  --tx-2: #454b54;
  --tx-3: #6b7280;
  --tx-4: #9aa1aa;
  --ac: #1f6feb;
  --ac-hi: #1a5fcd;
  --ac-bg: rgba(31, 111, 235, 0.1);
  --ac-fg: #ffffff;
  --ok: #1a7f4b;
  --warn: #9a6a0a;
  --err: #c2363b;
  --idle: #c9ced5;

  /* Identical to dark on purpose; asserted by design-tokens.test.mjs. */
  --term-bg: #08090a;
  --term-fg: #c9ced6;
  --term-cursor: #5aaeff;
  --term-selection: rgba(90, 174, 255, 0.24);

  --shadow-pop: 0 8px 24px -6px rgba(16, 24, 40, 0.28);
}

[data-density="compact"] {
  --row-h: var(--row-h-compact);
}
```

- [ ] **Step 4: 运行测试，确认它通过**

运行：`node --test packages/ui/tests/design-tokens.test.mjs`
预期：PASS，5 个测试。若某条 AA 测试失败，先重新量测再考虑改值 —— 目标比值是深色 `--tx-1` ≈16.46:1、`--tx-3` ≈4.79:1、`--ac-fg` 压在 `--ac` 上 ≈8.58:1；浅色 `--tx-1` ≈17.77:1、`--tx-3` ≈4.83:1、`--ac-fg` 压在 `--ac` 上 ≈4.63:1。

- [ ] **Step 5: 提交**

```bash
git add packages/ui/src/styles/tokens.css packages/ui/tests/design-tokens.test.mjs
git commit -m "feat(ui): define the neutral graphite token system"
```

---

## 任务 2：拆分样式表且不改变行为

**文件：**
- 修改：`packages/ui/src/style.css`（变成清单）
- 新建：`packages/ui/src/styles/base.css`、`chrome.css`、`hosts.css`、`inspector.css`、`keychain.css`、`terminal.css`、`states.css`
- 修改：`packages/ui/tests/visual-contract.test.mjs`
- 修改：`packages/ui/src/app.ts:2`（import 路径不变，只做确认）

- [ ] **Step 1: 让契约测试读取所有分片**

现有测试读的是 `src/style.css`，而它马上要变成九行的清单，所以必须改成读取展平后的层叠。把 `packages/ui/tests/visual-contract.test.mjs:4-7` 替换为：

```js
const PARTIALS = ['tokens', 'base', 'chrome', 'hosts', 'inspector', 'keychain', 'terminal', 'states']

const [html, ...partials] = await Promise.all([
  readFile(new URL('../src/index.html', import.meta.url), 'utf8'),
  ...PARTIALS.map((name) => readFile(new URL(`../src/styles/${name}.css`, import.meta.url), 'utf8')),
])
const css = partials.join('\n')
const manifest = await readFile(new URL('../src/style.css', import.meta.url), 'utf8')
```

旧第 24 行那条 Tabler 断言读的是 `css`；改成读 `manifest`，因为引入现在住在清单里：

```js
  assert.match(manifest, /@import\s+"@tabler\/icons-webfont\/dist\/tabler-icons\.min\.css"/)
```

再加一条断言：任何分片都不得引入另一个分片（顺序由清单独占，否则层叠意图不可知）：

```js
test('each partial is a leaf and the manifest owns cascade order', () => {
  for (const [name, text] of PARTIALS.map((n, i) => [n, partials[i]])) {
    assert.ok(!/@import/.test(text), `styles/${name}.css must not @import; put it in style.css`)
  }
})
```

- [ ] **Step 2: 运行测试，确认它失败**

运行：`node --test packages/ui/tests/visual-contract.test.mjs`
预期：FAIL —— `ENOENT ... styles/base.css`。

- [ ] **Step 3: 建立清单**

覆盖 `packages/ui/src/style.css`：

```css
@import "@tabler/icons-webfont/dist/tabler-icons.min.css";
@import "./styles/tokens.css";
@import "./styles/base.css";
@import "./styles/chrome.css";
@import "./styles/hosts.css";
@import "./styles/inspector.css";
@import "./styles/keychain.css";
@import "./styles/terminal.css";
@import "./styles/states.css";
```

- [ ] **Step 4: 把每段行号区间原样移入对应分片**

只做移动，不要重写，并保持每条规则像今天一样写在同一行。空行和分段注释跟着规则一起走。区间是当前 `style.css` 的行号；每次移动前先读文件。

**旧 `:root` 块（旧 `3-29`）是唯一不能原样移动的部分。** 它的 25 条声明里有四处与新灰阶撞名，而层叠中后出现的 `:root` 会静默胜出：`--line`、`--line-strong`、`--ok`、`--err` 已经有了新含义。在同一个提交里按下面处理：

- 其余 21 条（`--topbar`、`--nav`、`--main`、`--main-soft`、`--card`、`--card-hover`、`--field`、`--field-hover`、`--text-strong`、`--text`、`--text-muted`、`--text-faint`、`--accent`、`--accent-strong`、`--accent-soft`、`--warning`、`--radius-sm`、`--radius-md`、`--radius-lg`、`--motion-standard`，以及 `color-scheme: dark` 那一行）移入 `tokens.css` 已有的 `:root`，追加在新 token 之后，并在前面加上任务 3 里那段 `/* ── Legacy aliases: debt register ── */` 注释。不要重复声明 `color-scheme`。
- 把撞名的四条改名保留旧值，加进同一块：

```css
  --legacy-line: rgba(222, 226, 255, 0.085);
  --legacy-line-strong: rgba(222, 226, 255, 0.17);
  --legacy-ok: #7bd6af;
  --legacy-err: #ff929e;
```

- 重写各分片里对旧裸名的每一个引用：`var(--line)`→`var(--legacy-line)`（11 处）、`var(--line-strong)`→`var(--legacy-line-strong)`（7 处）、`var(--ok)`→`var(--legacy-ok)`（7 处）、`var(--err)`→`var(--legacy-err)`（8 处）。然后 grep 证明已无残留：

```powershell
Select-String -Path packages/ui/src/styles/*.css -Pattern 'var\(--line\)|var\(--line-strong\)|var\(--ok\)|var\(--err\)'
```
预期：无匹配 —— 这四个裸名此后只能解析到石墨灰阶。`var(--line-soft)` 是另一个名字，不受影响。

**`styles/base.css`** —— 旧 `31-83`，加 `232-235`（textarea）和 `527-529`（reduced motion）：

```css
* { box-sizing: border-box; }
html, body { height: 100%; min-height: 100%; margin: 0; }
body { overflow: hidden; background: var(--main); color: var(--text); font-family: "Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", system-ui, sans-serif; font-size: 13px; text-rendering: optimizeLegibility; }
button, input, select { font: inherit; -webkit-tap-highlight-color: transparent; }
button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--accent-strong); outline-offset: 2px; }
button { min-height: 38px; padding: 0 13px; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--card); color: var(--text); cursor: pointer; font-size: 13px; font-weight: 600; transition: background-color 180ms var(--motion-standard), border-color 180ms var(--motion-standard), color 180ms var(--motion-standard), transform 180ms var(--motion-standard); }
button:hover:not(:disabled) { border-color: var(--line-strong); background: var(--card-hover); color: var(--text-strong); }
button:active:not(:disabled) { transform: translateY(1px) scale(0.99); }
button:disabled { cursor: not-allowed; opacity: 0.42; }
button.ghost { border-color: transparent; background: transparent; color: var(--text-muted); }
button.ghost:hover:not(:disabled) { border-color: var(--line); background: var(--card); color: var(--text-strong); }
button.primary { border-color: transparent; background: var(--accent-strong); color: #081426; font-weight: 750; }
button.primary:hover:not(:disabled) { border-color: transparent; background: #56adff; color: #06111f; }
button.small { min-height: 30px; padding: 0 10px; border-radius: var(--radius-sm); font-size: 12px; }
[hidden] { display: none !important; }
textarea { width: 100%; min-width: 0; min-height: 100px; padding: 13px; resize: vertical; border: 1px solid var(--line-strong); border-radius: 14px; background: var(--field); color: var(--text-strong); font: 12px/1.6 "Cascadia Mono", Consolas, monospace; }
textarea::placeholder { color: var(--text-faint); }
textarea:focus-visible { outline: 2px solid var(--accent-strong); outline-offset: 2px; }
textarea:disabled { opacity: .6; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; transition-duration: 0.01ms !important; }
}
```

**`styles/chrome.css`** —— 旧 `85-187`、`278-286`、`411-416`、`531-548`、`563`，加上旧 `476-485`、`496-503`、`564-568`、`569-575` 中属于 chrome 的媒体查询部分。这些区间里所有以 `.app-`、`#app`、`.topbar`、`.workspace`、`.icon-button`、`.window-control`、`.update-pill`、`.primary-nav`、`.nav-`、`.session-tab`、`.tab-`、`.app-shell` 开头的规则都归它。

**`styles/hosts.css`** —— 旧 `273-277`、`288-339`、`467-474`，加上旧 `486-490`、`504-510`、`514`、`575-576` 中的主机/媒体规则。

**`styles/inspector.css`** —— 旧 `252-254`、`341-405`，加上旧 `490`、`511-513`、`515-518` 中的表单规则。

**`styles/keychain.css`** —— 旧 `189-251`、`256-265`。

**`styles/terminal.css`** —— 旧 `406-410`、`442-465`、`549-562`，加上旧 `519`、`523-524`、`576-581` 中的终端/SFTP 规则。

**`styles/states.css`** —— 旧 `219-222` 与 `266-272`（密钥库与快捷键对话框）、`317`（`.empty`）、`417-440`（连接失败），加上旧 `520-522` 中的失败规则。

注意两处刻意而非机械的跨文件移动：
- `.empty`（旧 `317`）进 `states.css`，因为空态是一个组件，不是主机的附属细节。
- `.keychain-empty`（旧 `219-222`）留在 `keychain.css`，尽管它也是空态；因为计划三会连同该屏其余部分整体替换它，拆开会把即将一起重写的单元割裂。

- [ ] **Step 5: 确认拆分没有丢规则**

把展平产物与拆分前的构建对比。在仓库根目录：

```powershell
npm run build:web
Select-String -Path packages/ui/dist/app.css -Pattern '^\s*[.#\[a-z]' | Measure-Object
```
预期：选择器行数等于在 `main` 上跑同一命令得到的行数（把拆分 `git stash` 掉、重新构建、比对、再 `git stash pop`）。数目不符说明移动时丢了或重复了规则。

- [ ] **Step 6: 跑检查**

```powershell
npm run build:web
npm run typecheck
node --test packages/ui/tests/visual-contract.test.mjs
```
预期：构建产出 `dist/app.css`；typecheck 与边界检查通过；契约测试通过，包含新增的分片叶子测试。

- [ ] **Step 7: 目视确认外观一致**

```powershell
npm run start:web
```
打开打印出的回环地址。预期：主机面板、连接表单、密钥库、终端会话均与 `main` 视觉等价。若有差异，说明某条规则被移到了一个层叠位置不同的分片 —— 修清单顺序，不要修规则本身。

- [ ] **Step 8: 提交**

```bash
git add packages/ui/src/style.css packages/ui/src/styles packages/ui/tests/visual-contract.test.mjs
git commit -m "refactor(ui): split the stylesheet into role-based partials"
```

---

## 任务 3：淘汰所有硬编码字面量

**文件：**
- 修改：`packages/ui/src/styles/tokens.css`（追加 legacy 块）
- 修改：其余七个分片
- 测试：`packages/ui/tests/design-tokens.test.mjs`

- [ ] **Step 1: 先写失败的"禁止字面量"测试**

追加到 `packages/ui/tests/design-tokens.test.mjs`：

```js
const STYLED_PARTIALS = ['base', 'chrome', 'hosts', 'inspector', 'keychain', 'terminal', 'states']

test('no partial hard-codes a colour', async () => {
  const { readFile } = await import('node:fs/promises')
  const LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(/
  for (const name of STYLED_PARTIALS) {
    const text = await readFile(new URL(`../src/styles/${name}.css`, import.meta.url), 'utf8')
    const offenders = text.split('\n')
      .map((line, index) => [index + 1, line])
      .filter(([, line]) => !line.trim().startsWith('/*') && LITERAL.test(line))
    assert.deepEqual(offenders, [], `styles/${name}.css must consume tokens:\n` + offenders.map(([n, l]) => `  ${n}: ${l.trim()}`).join('\n'))
  }
})
```

命名为 `STYLED_PARTIALS` 而不是 `PARTIALS`，并注意它刻意排除了 `tokens.css`：那个文件是唯一允许字面量的地方，这正是整条规则的意义。

- [ ] **Step 2: 运行测试，确认失败并数清债务**

运行：`node --test packages/ui/tests/design-tokens.test.mjs`
预期：FAIL，列出每一处违规行。记下总数 —— 它就是 legacy 块必须吸收的数量，spec 的估计约为 140。

- [ ] **Step 3: 把 legacy 块追加到 tokens.css 的 `:root`**

插入到 `:root` 的收尾 `}` 之前。这些是旧规则的当前值配上角色名，因此本任务最多改变一两个色阶。计划二会删掉整块。

任务 2 已经把 21 个不撞名的旧名和 `--legacy-line`/`--legacy-ok`/`--legacy-err` 那几条移进了这个块，所以注释头可能已存在 —— 不要重复添加。只追加下面的角色条目。

```css
  /* ── Legacy aliases: debt register ────────────────────────────────
     Values are the pre-redesign palette, named by role. Reference an
     entry here only when nothing above fits. Plan 2's palette flip
     removes this entire block. */
  --legacy-surface-sunken: #1c2033;
  --legacy-surface-raised: #24283d;
  --legacy-surface-raised-hover: #2d324a;
  --legacy-surface-active: #323852;
  --legacy-surface-field: #25293d;
  --legacy-surface-block: #30344a;
  --legacy-surface-block-alt: #3b4057;
  --legacy-surface-control: #3b425e;
  --legacy-surface-tool: #393e56;
  --legacy-surface-tool-add: #3c4159;
  --legacy-surface-action: #3f435a;
  --legacy-surface-action-hover: #4a506b;
  --legacy-surface-nav-active: #41465e;
  --legacy-surface-input: #262a40;
  --legacy-surface-log: #2a2e44;
  --legacy-surface-secondary: #2d3147;
  --legacy-surface-tab-active: #2b3048;
  --legacy-surface-tab-session: #1c2033;
  --legacy-surface-tab-active-session: #263b43;
  --legacy-surface-tab-failed: #3e2939;
  --legacy-surface-bar: #1a1e30;
  --legacy-surface-pill: #20243a;
  --legacy-surface-pill-hover: #303650;
  --legacy-on-accent: #081426;
  --legacy-on-accent-hover: #06111f;
  --legacy-accent-hover: #56adff;
  --legacy-danger-fill: #a84455;
  --legacy-danger-node: #ff5962;
  --legacy-danger-title: #ff6670;
  --legacy-danger-log: #ff8a91;
  --legacy-log-glyph: #bab3d0;
  --legacy-icon-on-nav: #f5f6ff;
  --legacy-strong-on-dark: #e7e9f4;
  --legacy-placeholder-strong: #adb2c7;
  --legacy-on-solid: #ffffff;
  --legacy-mark-bg: #e5e8f2;
  --legacy-mark-fg: #20243a;
  --legacy-key-avatar: #075a87;
  --legacy-address-avatar: #086ba7;
  --legacy-tone-0: #f15b29;
  --legacy-tone-1: #096da9;
  --legacy-tone-2: #efad18;
  --legacy-tone-2-fg: #fff8da;
  --legacy-tone-3: #4b4d61;
  --legacy-scroll-thumb: #454b67;
  --legacy-scroll-thumb-strong: #4b5069;
  --legacy-line-faint: rgba(222, 226, 255, 0.05);
  --legacy-line-hair: rgba(222, 226, 255, 0.07);
  --legacy-line-edge: rgba(222, 226, 255, 0.08);
  --legacy-line-mid: rgba(222, 226, 255, 0.12);
  --legacy-line-field: rgba(222, 226, 255, 0.13);
  --legacy-overlay-soft: rgba(255, 255, 255, 0.025);
  --legacy-overlay-hover: rgba(255, 255, 255, 0.07);
  --legacy-overlay-hover-strong: rgba(255, 255, 255, 0.08);
  --legacy-row-hover: rgba(222, 226, 255, 0.055);
  --legacy-tint-accent: rgba(93, 157, 255, 0.13);
  --legacy-tint-accent-line: rgba(167, 196, 255, 0.12);
  --legacy-tint-accent-line-strong: rgba(167, 196, 255, 0.42);
  --legacy-tint-accent-focus: rgba(167, 196, 255, 0.7);
  --legacy-tint-ok: rgba(123, 214, 175, 0.1);
  --legacy-tint-ok-line: rgba(123, 214, 175, 0.25);
  --legacy-tint-err: rgba(255, 146, 158, 0.1);
  --legacy-tint-err-line: rgba(255, 146, 158, 0.25);
  --legacy-tint-warn: rgba(242, 200, 111, 0.1);
  --legacy-tint-warn-line: rgba(242, 200, 111, 0.28);
  --legacy-mini-bg: rgba(20, 23, 42, 0.55);
  --legacy-field-inset: rgba(23, 26, 43, 0.22);
  --legacy-shadow-sm: 0 8px 20px rgba(7, 8, 18, 0.08);
  --legacy-shadow-card: 0 8px 18px rgba(8, 9, 22, 0.08);
  --legacy-shadow-card-hover: 0 12px 24px rgba(8, 9, 22, 0.16);
  --legacy-shadow-log: 0 14px 32px rgba(7, 8, 18, 0.14);
  --legacy-shadow-drawer: -24px 0 42px rgba(7, 8, 18, 0.24);
  --legacy-shadow-sheet: 0 -12px 28px rgba(0, 0, 0, 0.18);
  --legacy-shadow-editor: -20px 0 40px rgba(8, 10, 27, 0.33);
  --legacy-shadow-dialog: 0 24px 80px rgba(0, 0, 0, 0.53);
  --legacy-backdrop: rgba(7, 9, 22, 0.6);
```

- [ ] **Step 4: 把每处字面量替换成它的 token**

一次只做一个分片，这样每段改动都可审、且失败清单单调缩短。用这张表，它覆盖当前文件里的每一个字面量。

| 旧字面量（旧行号） | 替换为 |
| --- | --- |
| `#081426` (79) | `var(--legacy-on-accent)` |
| `#56adff`、`#06111f` (80) | `var(--legacy-accent-hover)`、`var(--legacy-on-accent-hover)` |
| `rgba(222,226,255,.06)` (105, 291) | `var(--legacy-line-hair)` |
| `rgba(255,255,255,.08)` (130, 305) | `var(--legacy-overlay-hover-strong)` |
| `#a84455` (133) | `var(--legacy-danger-fill)` |
| `#24283d`、`#2d324a` (142, 147) | `var(--legacy-surface-raised)`、`var(--legacy-surface-raised-hover)` |
| `#e5e8f2`、`#20243a` (156, 157) | `var(--legacy-mark-bg)`、`var(--legacy-mark-fg)` |
| `#20243a` (180, 182) | `var(--legacy-surface-pill)` |
| `#303650` (183) | `var(--legacy-surface-pill-hover)` |
| `#4b5069` (198, 356) | `var(--legacy-scroll-thumb-strong)` |
| `#075a87` (210) | `var(--legacy-key-avatar)` |
| `#393e56` (218, 277, 308) | `var(--legacy-surface-tool)` |
| `#3b425e` (243) | `var(--legacy-surface-control)` |
| `#080a1b55` (263) | `var(--legacy-shadow-editor)` |
| `#0008`、`#07091699` (266, 267) | `var(--legacy-shadow-dialog)`、`var(--legacy-backdrop)` |
| `rgba(222,226,255,.05)` (279) | `var(--legacy-line-faint)` |
| `rgba(222,226,255,.07)` (280, 332) | `var(--legacy-line-hair)` |
| `rgba(255,255,255,.07)` (282, 323) | `var(--legacy-overlay-hover)` |
| `#41465e`、`rgba(255,255,255,.025)` (283) | `var(--legacy-surface-nav-active)`、`var(--legacy-overlay-soft)` |
| `#f5f6ff` (284) | `var(--legacy-icon-on-nav)` |
| `rgba(123,214,175,.1)` (286, 333) | `var(--legacy-tint-ok)` |
| `#454b67` (290, 409, 448, 535) | `var(--legacy-scroll-thumb)` |
| `#3b4057` (291) | `var(--legacy-surface-block-alt)` |
| `rgba(7,8,18,.08)` (291) | `var(--legacy-shadow-sm)` |
| `#e7e9f4` (293) | `var(--legacy-strong-on-dark)` |
| `#adb2c7` (296) | `var(--legacy-placeholder-strong)` |
| `#3f435a`、`#4a506b` (301, 303, 305) | `var(--legacy-surface-action)`、`var(--legacy-surface-action-hover)` |
| `#3c4159` (309) | `var(--legacy-surface-tool-add)` |
| `rgba(8,9,22,.08)` (318) | `var(--legacy-shadow-card)` |
| `rgba(167,196,255,.12)`、`rgba(8,9,22,.16)`、`0 12px 24px …` (319) | `var(--legacy-tint-accent-line)`、`var(--legacy-shadow-card-hover)` |
| `rgba(167,196,255,.42)`、`#323852`、`rgba(93,157,255,.1)` (320) | `var(--legacy-tint-accent-line-strong)`、`var(--legacy-surface-active)`、`var(--legacy-tint-accent)` |
| `#fff` (323) | `var(--legacy-on-solid)` |
| `#f15b29`、`#096da9`、`#efad18`、`#fff8da`、`#4b4d61` (324-327) | `var(--legacy-tone-0)` … `var(--legacy-tone-3)`、`var(--legacy-tone-2-fg)` |
| `rgba(123,214,175,.25)` (333) | `var(--legacy-tint-ok-line)` |
| `rgba(20,23,42,.55)` (337) | `var(--legacy-mini-bg)` |
| `rgba(255,146,158,.25)`、`rgba(255,146,158,.1)` (339, 547) | `var(--legacy-tint-err-line)`、`var(--legacy-tint-err)` |
| `rgba(222,226,255,.08)` (344, 347, 395) | `var(--legacy-line-edge)` |
| `#272b40` (344, 395) | `var(--nav)` —— 同值，且这两处是抽屉与其页脚，不是标签规则 |
| `rgba(7,8,18,.24)` (344) | `var(--legacy-shadow-drawer)` |
| `#30344a`、`#086ba7`、`#262a40` (360-362) | `var(--legacy-surface-block)`、`var(--legacy-address-avatar)`、`var(--legacy-surface-input)` |
| `rgba(222,226,255,.12)`、`rgba(23,26,43,.22)` (364) | `var(--legacy-line-mid)`、`var(--legacy-field-inset)` |
| `rgba(222,226,255,.1)` (371) | `var(--legacy-line-faint)` |
| `rgba(222,226,255,.13)`、`#25293d` (382) | `var(--legacy-line-field)`、`var(--legacy-surface-field)` |
| `rgba(167,196,255,.7)`、`rgba(93,157,255,.13)` (385) | `var(--legacy-tint-accent-focus)`、`var(--legacy-tint-accent)` |
| `#121426` (406, 417, 549) | `var(--topbar)` |
| `#ff5962`、`#ff6670`、`#2a2e44`、`rgba(7,8,18,.14)` (428-431) | `var(--legacy-danger-node)`、`var(--legacy-danger-title)`、`var(--legacy-surface-log)`、`var(--legacy-shadow-log)` |
| `#bab3d0`、`#ff8a91` (434, 435) | `var(--legacy-log-glyph)`、`var(--legacy-danger-log)` |
| `#2d3147` (440) | `var(--legacy-surface-secondary)` |
| `rgba(0,0,0,.18)` (443) | `var(--legacy-shadow-sheet)` |
| `rgba(222,226,255,.055)` (454) | `var(--legacy-row-hover)` |
| `rgba(242,200,111,.28)`、`rgba(242,200,111,.1)` (462) | `var(--legacy-tint-warn-line)`、`var(--legacy-tint-warn)` |
| `#2b3048`、`#1c2033`、`#263b43`、`rgba(123,214,175,.22)`、`#3e2939` (537-547) | `var(--legacy-surface-tab-active)`、`var(--legacy-surface-tab-session)`、`var(--legacy-surface-tab-active-session)`、`var(--legacy-tint-ok-line)`、`var(--legacy-surface-tab-failed)` |
| `#1a1e30` (550) | `var(--legacy-surface-bar)` |

那些不等于 7/10/15 的 `border-radius` 字面量（`11px`、`12px`、`13px`、`14px`、`16px`、`17px`、`18px`、`20px`、`9px`）属于几何而非颜色，不在本任务范围内 —— 测试的正则只匹配颜色字面量。它们由计划二折进 `--r-*`。

- [ ] **Step 5: 运行测试，确认通过**

运行：`node --test packages/ui/tests/design-tokens.test.mjs`
预期：PASS，且"禁止字面量"测试的违规列表为空。

- [ ] **Step 6: 构建并比对产物**

```powershell
npm run build:web
Select-String -Path packages/ui/dist/app.css -Pattern '#[0-9a-fA-F]{3,8}\b' | Measure-Object -Property Line
```
预期：`Count` 恰好等于 `tokens.css` 内部声明的颜色数量 —— 不应有任何匹配来自其他分片的选择器。随后运行 `npm run verify`。

- [ ] **Step 7: 提交**

```bash
git add packages/ui/src/styles packages/ui/tests/design-tokens.test.mjs
git commit -m "refactor(ui): consume tokens for every colour"
```

---

## 任务 4：终端色板跟随 token

**文件：**
- 修改：`packages/ui/src/terminal-view.ts:18-33`
- 修改：`packages/ui/tests/design-tokens.test.mjs`
- 测试：`packages/ui/tests/design-tokens.test.mjs`

- [ ] **Step 1: 先写失败的测试**

追加到 `packages/ui/tests/design-tokens.test.mjs`。这是 spec"主题单一来源"规则的前半段：xterm 主题目前是四个硬编码值加一个没有任何东西与之关联的 16 项 ANSI 数组。

```js
test('the xterm theme reads its colours from the terminal tokens', async () => {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile(new URL('../src/terminal-view.ts', import.meta.url), 'utf8')
  assert.match(source, /getComputedStyle/, 'the xterm theme must be resolved from CSS custom properties')
  assert.match(source, /--term-bg/, 'the terminal background must come from --term-bg')
  assert.match(source, /--term-fg|--term-cursor|--term-selection/, 'cursor, foreground and selection must come from tokens')
  const stray = source.match(/#[0-9a-fA-F]{6}\b/g) ?? []
  assert.ok(stray.length <= 16, `only the 16 ANSI entries may carry literals, found ${stray.length}`)
})
```

- [ ] **Step 2: 运行测试，确认它失败**

运行：`node --test packages/ui/tests/design-tokens.test.mjs`
预期：FAIL —— `the xterm theme must be resolved from CSS custom properties`。

- [ ] **Step 3: 从计算样式解析主题**

在 `packages/ui/src/terminal-view.ts` 里，把 22-29 行的字面 `theme` 对象换成从文档读取的值。在构造 options 之前加入辅助代码：

```ts
const probe = document.documentElement
const read = (name: string) => getComputedStyle(probe).getPropertyValue(name).trim()

const ANSI: string[] = [
  '#08090a', '#f2555a', '#4ec27f', '#e0a83c', '#5aaeff', '#c58aff', '#57c8d0', '#b9bec6',
  '#565b63', '#ff7b81', '#7ddba8', '#f2c86f', '#7cc0ff', '#d9a8ff', '#7fe0e8', '#f2f3f5',
]
```

并在 `new Terminal({ ... })` 的 options 里：

```ts
  theme: {
    background: read('--term-bg'),
    foreground: read('--term-fg'),
    cursor: read('--term-cursor'),
    cursorAccent: read('--term-bg'),
    selectionBackground: read('--term-selection'),
    ...palette,
  },
```

**执行中发现的修正：`ANSI` 不是 xterm `ITheme` 的键。** 在 theme 对象里写 `ANSI,` 编译不过，报 `TS2353: Object literal may only specify known properties, and 'ANSI' does not exist in type 'ITheme'`；而 `@xterm/xterm` 6.0.0 根本不接受数组 —— 它的 `ThemeService` 是把十六个*具名*键折叠进自己的 0-15 数组。用类型断言强行通过的话会编译成功、然后把 xterm 的 Tango 默认色板原样交给终端（红色是 `#cc0000`），且任何地方都不会报错。实际落地的形状保留数组作为唯一可读清单，并按位置交接：

```ts
  const palette: ITheme = {
    black: ANSI[0], red: ANSI[1], green: ANSI[2], yellow: ANSI[3],
    blue: ANSI[4], magenta: ANSI[5], cyan: ANSI[6], white: ANSI[7],
    brightBlack: ANSI[8], brightRed: ANSI[9], brightGreen: ANSI[10], brightYellow: ANSI[11],
    brightBlue: ANSI[12], brightMagenta: ANSI[13], brightCyan: ANSI[14], brightWhite: ANSI[15],
  }
```

用 `...palette` 展开在五处 token 读取之后；`ANSI[0]` 取 `#101317` 而不是 `--term-bg`，以免黑字压底色按构造恰好 1.00:1；`ANSI[8]` 取 `#5f656e`，让提示符的"调暗"色过 3:1。

`cursorAccent` 必须留在对象里。它替换的那条字面量（`terminal-view.ts:23`）原本是 `cursorAccent: '#121426'`，也就是该文件自己的背景值：xterm 用它来反转光标下方字形的颜色，删掉这个键会改变光标压在文字上的观感。它解析到 `--term-bg`，因为光标下的单元格就是画布。

给任务 4 的测试再加一条断言：`--term-cursor` 必须与 `:root` 的 `--ac` 携带相同的 RGB 三元组。任务 1 的评审发现 `--term-cursor: #5aaeff` 是 accent 的第三份手抄，而三元组跟踪只覆盖了 `--ac-bg` 和 `--term-selection`，所以计划二翻转 accent 时光标会被静默地丢在原地。

`read()` 刻意不带 fallback。`style.css` 由 `index.html` 链接、并在 `app.ts:2` 引入，所以构造任何终端时自定义属性都已解析完毕；写一个 fallback 字符串只会增加没有测试覆盖的分支，并把字面量数量推过下面那条断言的上限。

`fontSize: 14` 暂时保持不变；`--fs-term` 是 13.5px，应用它属于计划二，因为不重新测量就改字号，正是 spec 里延后的那个测量竞态。

**spec 主题同步规则中被延后的一半。** spec 还要求断言 `index.html` 的 `theme-color` meta、以及 `apps/desktop/electron/app/shell.ts` 的 `backgroundColor` 与 overlay `symbolColor` 与 token 文件一致。那三处字面量目前全是 `#121426` 或 `#a1a5bb`，恰好仍等于 `--topbar` 与 `--text-muted`，所以这条断言现在会通过、只有到计划二翻转之后才开始起作用 —— 而一条必须"加了就先禁用"的测试比一条后加的测试更糟。它属于翻转那个提交，会写在 `docs/superpowers/plans/` 的后续计划里。

- [ ] **Step 4: 跑测试与客户端生命周期检查**

```powershell
node --test packages/ui/tests/design-tokens.test.mjs
npm run typecheck
node packages/ui/tests/smoke-client-lifecycle.mjs
```
预期：全部通过。生命周期冒烟测试注入的是无头终端工厂，所以还要确认真实浏览器路径仍能打开：运行 `npm run start:web`，连接一台主机，检查画布背景是 `#08090a` 且文字清晰可读。

- [ ] **Step 5: 提交**

```bash
git add packages/ui/src/terminal-view.ts packages/ui/tests/design-tokens.test.mjs
git commit -m "refactor(ui): resolve the xterm palette from tokens"
```

---

## 任务 5：采用 Inter 并收敛字重

**文件：**
- 修改：`packages/ui/package.json:9-15`
- 修改：`packages/ui/src/styles/base.css`
- 修改：`packages/ui/tests/design-tokens.test.mjs`
- 修改：根 `package-lock.json`（由 `npm install` 改动，绝不手改）

- [ ] **Step 1: 先写失败的测试**

追加：

```js
test('the stylesheet ships Inter and keeps to four weights', async () => {
  const { readFile } = await import('node:fs/promises')
  const manifest = await readFile(new URL('../src/style.css', import.meta.url), 'utf8')
  assert.match(manifest, /@import\s+"@fontsource-variable\/inter\/latin-400\.css"/, 'Inter latin must be bundled, not fetched')
  const texts = []
  for (const name of STYLED_PARTIALS) {
    texts.push(await readFile(new URL(`../src/styles/${name}.css`, import.meta.url), 'utf8'))
  }
  const weights = new Set([...texts.join('\n').matchAll(/font-weight:\s*([^;]+);/g)].map((m) => m[1].trim()))
  for (const weight of weights) {
    assert.ok(['400', '500', '600', '700', 'normal', 'bold'].includes(weight), `disallowed font-weight ${weight}`)
  }
})

test('tabler icons never inherit a synthetic bold', async () => {
  const { readFile } = await import('node:fs/promises')
  const base = await readFile(new URL('../src/styles/base.css', import.meta.url), 'utf8')
  assert.match(base, /\.ti\s*\{[^}]*font-weight:\s*400/, 'the icon font must be pinned to 400')
})
```

- [ ] **Step 2: 运行测试，确认它失败**

运行：`node --test packages/ui/tests/design-tokens.test.mjs`
预期：FAIL，卡在 Inter 引入那条断言。

- [ ] **Step 3: 从仓库根目录添加依赖**

```powershell
npm install @fontsource-variable/inter --workspace=@pureterm/ui --save-exact
```
预期：`packages/ui/package.json` 出现一条精确版本的 `@fontsource-variable/inter`，根 `package-lock.json` 更新。根 lockfile 是唯一的 lockfile —— 若出现任何嵌套 `package-lock.json`，删掉它并从根目录重跑。

- [ ] **Step 4: 只引入实际用到的字面**

加到 `packages/ui/src/style.css`，位于 Tabler 那行之后：

```css
@import "@fontsource-variable/inter/latin-400.css";
@import "@fontsource-variable/inter/latin-500.css";
@import "@fontsource-variable/inter/latin-600.css";
@import "@fontsource-variable/inter/latin-700.css";
```

如果安装到的版本只提供一个大而全、含四个 `@font-face` 的 `index.css`，那就引入那个文件并删掉上面四行；先用 `Get-ChildItem node_modules/@fontsource-variable/inter/*.css` 确认，不要凭猜测。不要引入完整 CJK 或 greek/cyrillic 子集 —— 页面从不渲染它们，却会拖进每一个安装包。

- [ ] **Step 5: 让 body 指向 token，并钉住图标字重**

在 `packages/ui/src/styles/base.css` 里，把 `body` 规则的字体族与字号换成 token，并加入图标规则：

```css
body {
  overflow: hidden;
  background: var(--main);
  color: var(--text);
  font-family: var(--font-ui);
  font-size: var(--fs-ui);
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
}

.ti { font-weight: 400; font-style: normal; -webkit-font-smoothing: antialiased; }
```

`.ti` 必须钉死，因为继承来的 600-800 字重会让图标 webfont 合成它本来没有的粗体，表现为 20-25px 图标发糊。

- [ ] **Step 6: 把所有字重收敛到允许集合**

在各分片里替换：`650`→`600`、`750`→`700`、`800`→`700`、`1000`→`700`，以及那些本该安静的标题上误用的 `500`。来自当前文件、现已散落在各分片的具体位置：`base.css` 的 `button` `600` 保留、`button.primary` `750`→`700`、`button.mini` `600` 保留；`chrome.css` 的 `.app-tab` `650`→`600`、`.workspace-mark` `800`→`700`、`.nav-item` `600` 保留、`.nav-icon` `700` 保留；`hosts.css` 的 `.section-kicker` `800`→`700`、`.hosts-heading h1` `700` 保留、`.host-label` `700` 保留、`.host-avatar` `800`→`700`、`button.mini` 保留；`inspector.css` 的 `.mode` `750`→`700`、`.drawer-section h2` `750`→`700`、`.ssh-port-row strong` `750`→`700`；`states.css` 的 `.failure-host h1` `750`→`700`、`.failure-shell > h2` `750`→`700`。

- [ ] **Step 7: 把已经与 token 等值的字号接上刻度**

在各分片里，仅当固定 `font-size` 的数值恰好相等时才替换为对应的 `--fs-*`，这样本步不可能影响布局：`13px`→`var(--fs-ui)`、`12px`→`var(--fs-meta)`、`11px`→`var(--fs-micro)`、`14px`→`var(--fs-em)`、`16px`→`var(--fs-h2)`、`20px`→`var(--fs-h1)`。保留 `10px`、`21px`、`22px`、`23px`、`25px`、`28px`、`34px`、`36px` 以及所有图标尺寸 —— 它们随计划二的 chrome 重建一起调，不在这里。

- [ ] **Step 8: 跑测试并在两个入口目视检查**

```powershell
node --test packages/ui/tests/design-tokens.test.mjs
npm run verify
npm run start:web
npm run start:desktop
```
预期：测试与 `verify` 通过。在两个窗口的 DevTools → Network 中，远程字体请求必须为 **零**，且 `getComputedStyle(document.body).fontFamily` 必须以 `Inter` 开头。确认中文标签仍然正常渲染 —— 它们必须来自 `Microsoft YaHei UI`；如果某个西文字形与中文并排时显得不协调，那是 `--font-ui` 回退顺序的 bug，不是打包 CJK 字体的理由。

- [ ] **Step 9: 提交**

```bash
git add package-lock.json packages/ui/package.json packages/ui/src/style.css packages/ui/src/styles packages/ui/tests/design-tokens.test.mjs
git commit -m "feat(ui): bundle Inter and reduce the weight set"
```

---

## 任务 6：记录设计系统文档

**文件：**
- 新建：`docs/design-system.md`、`docs/design-system_zh.md`
- 修改：`CHANGELOG.md`
- 修改：`packages/ui/src/lib/changelog.ts`、`packages/ui/src/lib/version.ts`（仅由脚本生成）

- [ ] **Step 1: 写英文设计系统文档**

`docs/design-system.md` 必须按顺序包含：链接行 `[中文版本](design-system_zh.md)`；"styles/tokens.css 是唯一允许出现颜色字面量之处"这条规则；中性灰阶表与 accent/语义表，从 `docs/superpowers/specs/2026-09-23-frontend-professional-redesign.md` 逐字复制；同节的排版与度量表；四步主题解析顺序；`terminal-view.ts` 所用顺序下的 16 项 ANSI；以及一节 **Legacy aliases**，写明该块是债务登记表、指名计划二为删除它的节点，并警告往里加条目必须先有理由。

- [ ] **Step 2: 把中文文档写成完整翻译**

`docs/design-system_zh.md` 逐节对应。按仓库规则，代码块、标识符、链接与版本号必须与英文文件保持等价 —— MIT `LICENSE` 是唯一没有译文的文档。

- [ ] **Step 3: 记录变更**

加入 `CHANGELOG.md` 的 `[Unreleased]`：

```markdown
### Changed
- The shared UI stylesheet is split into role-based partials behind a `style.css`
  manifest, and every colour now resolves through design tokens in
  `packages/ui/src/styles/tokens.css`. UI text uses bundled Inter and renders in
  four weights instead of six.

### Added
- `docs/design-system.md` documents the token system, both theme groups and the
  terminal palette, with a Chinese translation.
- New unit tests fail on any colour literal outside a token block, on a token
  present in one theme but not the other, and on any text or accent pair that
  drops below WCAG AA.
```

- [ ] **Step 4: 重新生成内嵌的 changelog 与版本**

```powershell
node scripts/convert-changelog.js
node scripts/convert-changelog.js --sync-version
npm run release:check
```
预期：`release:check` 输出 `Changelog and workspace versions are valid for 0.1.0-alpha.1.`，且 `git status` 显示 `packages/ui/src/lib/changelog.ts` 已修改。若 `version.ts` 也跟着变了，说明两条命令顺序跑错了 —— 两条都重跑一遍。

- [ ] **Step 5: 完整验证与链接检查**

```powershell
npm run verify
git diff --check
Get-ChildItem docs/*.md | ForEach-Object { (Get-Content $_.FullName -Raw) -match 'design-system_zh\.md' }
```
预期：`verify` 全绿；`git diff --check` 无输出；两份文档互相链接。

- [ ] **Step 6: 提交**

```bash
git add docs/design-system.md docs/design-system_zh.md CHANGELOG.md packages/ui/src/lib/changelog.ts packages/ui/src/lib/version.ts
git commit -m "docs(ui): document the token system"
```

---

## 本计划的完成标准

- `feat/ui-redesign` 上 `npm run verify` 与 `npm run verify:electron` 均通过。
- `design-tokens.test.mjs` 为绿，且任何在 `tokens.css` 之外新增的单个十六进制值都会让它失败。
- 每套主题组都声明了全部颜色 token，且没有任何度量被复制进浅色主题。（任务 3 加入 legacy 登记后，`:root` 合理地多出约 55 个名字；不变式是"不存在只在浅色里的 token"，而不是"两组相等"。）
- `docs/design-system.md` 与其中文配对存在且内容一致。
- 外观仍是可辨认的当前 PureTerm，只是改用 Inter 重排。**向石墨配色的翻转是计划二的第一个提交**，本计划不得提前执行。

## 不在本计划内

- 计划二：删除 legacy 别名块、翻转到石墨灰阶、重建 chrome（52px 轨道、顶栏标签、24px 状态栏、品牌 SVG 与 favicon、主题开关、清理失效的 `.window-control`），把剩余圆角折进 `--r-*`，应用 `--fs-term`，并补上 spec 主题同步规则被延后的另一半（`index.html` 的 meta 与 `shell.ts` 的两处字面量）。**注意浅色主题的 `--ac-fg` 压在 `--ac` 上只有 4.63:1**，距 AA 的 4.5 底线仅剩 0.13。翻转时把 accent 调亮一点就会跌破，`design-tokens.test.mjs` 会立刻报错 —— 那时应该调暗 accent，而不是放宽阈值。
- 计划三：hosts 与 keychain 表格、右固定 Inspector、可拖拽 SFTP 分栏、四态、toast、失败诊断、断点合并为 1100/820/620，以及 `docs/architecture.md` 的更新。
- 两个后续计划继承本计划的"禁止字面量"规则，所以它们新增的任何 CSS，从该任务的第一个提交起就必须引用 token。
