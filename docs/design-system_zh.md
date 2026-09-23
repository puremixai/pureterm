# 设计 Token 与样式表布局

[English version](design-system.md)

本文是共享界面视觉取值来源的权威文档：token 文件本身、把它们送达页面的样式表布局、主题机制、终端色板、字体排印，以及仍然早于这套体系的遗留登记簿。它描述的是当前代码树的实际状态，而不是产生它的计划；文中每个数字都按旁边标注的文件实测得出。

以下路径相对仓库根目录。进程边界见[架构说明](architecture_zh.md)，命令见[开发说明](DEVELOPMENT_zh.md)，本布局遵循的仓库规则见 `AGENTS.md`。

## 唯一规则

颜色字面量只允许出现在两个文件里。`packages/ui/src/styles/tokens.css` 是体系本身：中性明度阶梯、文字阶梯、强调色与语义色集、终端组，以及与主题无关的度量。`packages/ui/src/styles/legacy.css` 是唯一被认可的例外 —— 改版前的色板被作为一份受守卫的删除清单保存在那里，而不是放任它们重新散布回各分片。其余一切颜色的颜色都必须透过 token 解析。

`packages/ui/src/styles/fonts.css` 是唯一可以把字体族名写成字面量的文件，因为 `@font-face` 做的事就是这样：它声明一张字面，而不是向 token 索取字面。页面实际索取的三套字体栈 —— `--font-ui`、`--font-mono`、`--font-term` —— 声明在 `tokens.css` 里。

`packages/ui/tests/stylesheet-contract.test.mjs` 强制执行以上全部规则，而且豁免清单本身是被断言的，不是被声明的：

- `SANCTIONED = ['legacy', 'tokens']` 与运行时的 `EXEMPT` 集合比对，因此想豁免第三个分片必须显式改动测试里的常量。
- `EXEMPT` 的每个成员仍必须是清单导入的分片，过期的豁免会失败。
- `totalImports(manifest)` 必须等于解析出的分片数加一（外部 Tabler 那一行），这堵住了 `url(...)` 导入形式：它解析不出名字，否则一个分片就会进入级联却永远不被扫描。
- 颜色测试统计自己扫描了多少分片，并断言总数等于 `names.length - EXEMPT.size`，所以漏掉一个文件是失败而不是通过。

匹配式是 `/#[0-9a-fA-F]{3,8}\b|\brgba?\(/`，逐分片作用在去掉注释之后的文本上。注释是被抹空而不是删除的，因此违规行保留读者在文件里看到的那个行号。同一个文件还钉住了字体侧的规则：只有 `fonts.css` 可以声明字面；每个 `font-family` 与 `font` 简写必须透过 `var(--font-ui)`、`var(--font-mono)` 或 `var(--font-term)`（或 CSS 全域关键字）解析；每个 `font-weight` 必须是本应用提供的四个字重之一。这些普查所依赖的 `@font-face` 豁免之所以诚实，正是因为另一条测试断言只有恰好一个文件可以持有字面。

## 样式表布局

`packages/ui/src/style.css` 只是一份 `@import` 清单，别无其他：十一行，第一行导入 `@tabler/icons-webfont/dist/tabler-icons.min.css`，其后十行按级联顺序导入本地分片。

| # | 分片 | 字节 | 职责 |
| --- | --- | --- | --- |
| 1 | `styles/fonts.css` | 2,236 | 随包分发的字面。唯一按名字声明字体族而非向 token 索取的文件。 |
| 2 | `styles/tokens.css` | 3,530 | Token 体系与主题组。 |
| 3 | `styles/legacy.css` | 5,569 | 作为债务登记簿的改版前色板。 |
| 4 | `styles/base.css` | 3,076 | 元素默认值：重置、继承的字号、按钮与输入框、焦点环、reduced motion。 |
| 5 | `styles/chrome.css` | 8,944 | 应用外壳：`#app` 网格、顶栏、工作区与会话标签、导航栏，以及 `.app-shell` 上的状态类。 |
| 6 | `styles/hosts.css` | 8,384 | 主机面板：页面标题、搜索行、工具栏，以及卡片与列表形态。 |
| 7 | `styles/inspector.css` | 7,447 | 连接表单：抽屉外壳与标题栏、分区、字段、底栏，以及密钥库编辑器复用的共享控件。 |
| 8 | `styles/keychain.css` | 6,381 | 在共享主机卡片语言之上的密钥库与编辑器。 |
| 9 | `styles/terminal.css` | 5,294 | 终端表面：xterm 面板及其覆盖样式、会话工具栏、SFTP 抽屉。 |
| 10 | `styles/states.css` | 3,639 | 无内容与非正常：空占位、快捷键对话框、连接失败页面。 |

清单拥有级联顺序，因为各分片在同一特异度下相互竞争，后导入者获胜。这正是任何分片都不得 `@import` 的原因：嵌套导入会把顺序决定权分散到十个地方，而 `visual-contract.test.mjs` 会对每个分片自己的文本断言 `!/@import/`。顺序本身由同一条测试钉住：它断言的名字列表恰好是 `['fonts', 'tokens', 'legacy', 'base', 'chrome', 'hosts', 'inspector', 'keychain', 'terminal', 'states']` —— 并且这份列表是透过 `packages/ui/tests/partial-list.mjs` 从清单本身推导出来的，不是第二份拷贝，所以新增、改名或调换顺序都必须带着一份明确的意图去改动那条断言。

`style.css` 透过两道门抵达页面：`packages/ui/src/index.html:17` 链接的是 `./app.css`，即构建后的样式表；`packages/ui/src/app.ts:2` 导入的是 `./style.css`，于是 esbuild 会把每一个 `@import` —— 十个分片加上外部的 Tabler 与 xterm 表 —— 摊平成两个入口所提供的那一份 `packages/ui/dist/app.css`。

## Token

以下所有取值都读自 `packages/ui/src/styles/tokens.css`。深色列是 `:root` 组，浅色列是 `[data-theme="light"]` 组。

### 表面阶梯

六级深度。文件头的注释把色相钉在 210deg、饱和度不超过 5%；实测下来，六个表面阶梯的色相落在 210–220deg 之间，红蓝分量的最大差值是 255 中的 10（`--c-control`），而这正是那个数字背后的意图：深度表达层级，绝不表达情绪。比例一列把每一级相对 `--c-surface` 计量，而 `--c-surface` 正是下文合法性规则所依据的底面。深色组里只有 `--c-raised` 与 `--c-control` 浮在表面之上；浅色组里表面就是阶梯顶端，其余各级都沉在其下。

| Token | 深色 | 浅色 | 相对 `--c-surface` 的比例（深色 / 浅色） |
| --- | --- | --- | --- |
| `--c-inset` | `#08090a` | `#eceef1` | 1.09 更暗 / 1.16 更暗 |
| `--c-canvas` | `#0a0b0d` | `#f7f8f9` | 1.08 更暗 / 1.06 更暗 |
| `--c-chrome` | `#0e1013` | `#eef0f2` | 1.04 更暗 / 1.14 更暗 |
| `--c-surface` | `#131519` | `#ffffff` | 1.00 |
| `--c-raised` | `#191c21` | `#f4f6f8` | 1.07 更亮 / 1.08 更暗 |
| `--c-control` | `#21252b` | `#e8ebef` | 1.19 更亮 / 1.20 更暗 |

三档线色，由最弱到最强：

| Token | 深色 | 浅色 |
| --- | --- | --- |
| `--line-soft` | `#1c1f24` | `#eceef1` |
| `--line` | `#262a31` | `#dfe3e8` |
| `--line-strong` | `#3a4049` | `#c6ccd4` |

### 文字阶梯

| Token | 深色 | 浅色 | 在 `--c-surface` 上（深色 / 浅色） |
| --- | --- | --- | --- |
| `--tx-1` | `#f2f3f5` | `#16181c` | 16.46:1 / 17.77:1 |
| `--tx-2` | `#b9bec6` | `#454b54` | 9.79:1 / 8.80:1 |
| `--tx-3` | `#7d838d` | `#6b7280` | 4.79:1 / 4.83:1 |
| `--tx-4` | `#565b63` | `#9aa1aa` | 2.67:1 / 2.61:1 |

`--tx-1` 与 `--tx-2` 是正文和次级文字，`--tx-3` 是弱化档，`--tx-4` 是第四档。`design-tokens.test.mjs` 对两个主题下 `--c-surface` 上的 `--tx-1`、`--tx-2`、`--tx-3` 断言 AA，而把 `--tx-4` 当作排序守卫而非 AA 上限：它必须弱于 `--tx-3` 且不低于 1.5:1，因此把它抬进 AA 是进步，任它淡到不可见则不是。

### 强调色与语义色

| Token | 深色 | 浅色 | 说明 |
| --- | --- | --- | --- |
| `--ac` | `#5aaeff` | `#1f6feb` | 唯一强调色，没有渐变。 |
| `--ac-hi` | `#7cc0ff` | `#1a5fcd` | 悬停/加强档；深色组里比 `--ac` 更亮，浅色组里更暗，好让悬停状态总是增加对比。 |
| `--ac-bg` | `rgba(90, 174, 255, 0.12)` | `rgba(31, 111, 235, 0.1)` | 着色底。它的 RGB 三分量必须与同组的 `--ac` 相同；只有 alpha 是自由的。 |
| `--ac-fg` | `#05070a` | `#ffffff` | 强调色填充上的文字：深色 8.58:1，浅色 4.63:1。 |
| `--ok` | `#4ec27f` | `#1a7f4b` | 在 `--c-surface` 上 8.14:1 / 5.02:1。 |
| `--warn` | `#e0a83c` | `#9a6a0a` | 在 `--c-surface` 上 8.56:1 / 4.73:1。 |
| `--err` | `#f2555a` | `#c2363b` | 在 `--c-surface` 上 5.42:1 / 5.41:1。 |
| `--idle` | `#8b919b` | `#7e8590` | 不得读成"关闭"的状态点：在 `--c-surface` 与 `--c-chrome` 上均要求 3:1 下限，逐主题断言（深色 5.76/6.01，浅色 3.72/3.26）。 |

语义色以 11–12px 标签呈现，因此测试把它们按 4.5:1 的普通文字下限对待，而不是 3:1 的大图形下限。

### 终端组

四个 token，在两个主题组里逐字节相同，且这一点被断言：浅色外壳罩在深色画布上正是设计意图。

| Token | 取值（两个主题相同） |
| --- | --- |
| `--term-bg` | `#08090a` |
| `--term-fg` | `#c9ced6` |
| `--term-cursor` | `#5aaeff` |
| `--term-selection` | `rgba(90, 174, 255, 0.24)` |

`--term-bg` 被断言相对亮度保持在 0.02 以下（实测 0.0027），因此未来的改动无法意外把画布提亮成一个浅色终端。`--term-cursor` 与 `--term-selection` 携带的是**深色**组的 `--ac` 三分量，并且被断言必须继续携带；两者都只透过一次 `getComputedStyle` 读取，没有任何 `var()` 牵着它们，这条断言就是唯一的连线。

### 度量

与主题无关：`:root` 与 `[data-theme="light"]` 匹配同一个元素，因此浅色组继承这些值，把它们重写一遍就等于重建本体系要消除的那类手工同步债务。`design-tokens.test.mjs` 断言每个度量都声明在 `:root` 且不出现在浅色组里。

| 组 | Token |
| --- | --- |
| 圆角 | `--r-1: 3px`、`--r-2: 5px`、`--r-3: 8px`、`--r-full: 999px` |
| 间距 | `--s-1: 4px`、`--s-2: 8px`、`--s-3: 12px`、`--s-4: 16px`、`--s-5: 24px`、`--s-6: 32px` |
| 行高 | `--row-h: 38px`、`--row-h-compact: 30px` |
| 层叠 | `--z-drawer: 20`、`--z-popover: 30`、`--z-toast: 40`、`--z-dialog: 50` |
| 动效 | `--t-1: 100ms`、`--t-2: 160ms`、`--t-3: 240ms`、`--ease: cubic-bezier(0.2, 0.8, 0.2, 1)` |
| 焦点环 | `--ring: 0 0 0 2px var(--c-canvas), 0 0 0 4px var(--ac)` |
| 浮层阴影 | `--shadow-pop: 0 8px 24px -6px rgba(0, 0, 0, 0.5)`（深色），`0 8px 24px -6px rgba(16, 24, 40, 0.28)`（浅色） |

`--shadow-pop` 是度量不可变性唯一被认可的例外：它由主题色派生，因此必须逐主题重算而非继承。测试同时断言它是颜色和终端类别之外浅色组里唯一的声明，并且它的浅色值不同于深色值。

`[data-density="compact"]` 是与主题正交的另一个维度，只重映射一个 token：`--row-h: var(--row-h-compact)`。

### 字号阶梯

| Token | 取值 | 当前消费者 |
| --- | --- | --- |
| `--font-ui` | `Inter, "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", system-ui, sans-serif` | 1 处 `var()`：`base.css` 的 `body` |
| `--font-mono` | `"JetBrains Mono", "Cascadia Mono", Consolas, monospace` | 7 处 `var()`，分布于 `base`、`hosts`、`inspector`、`terminal`、`states` |
| `--font-term` | `"Cascadia Mono", Consolas, "Sarasa Mono SC", "Microsoft YaHei Mono", monospace` | `terminal-view.ts` 里 1 处 `read()` |
| `--fs-micro` | `11px` | 11 处 `var()` |
| `--fs-meta` | `12px` | 18 处 `var()` |
| `--fs-ui` | `13px` | 7 处 `var()` |
| `--fs-em` | `14px` | 6 处 `var()` |
| `--fs-h2` | `16px` | 4 处 `var()` |
| `--fs-h1` | `20px` | 1 处 `var()` |
| `--fs-term` | `13.5px` | 无 —— 见[已知缺口](#已知缺口) |

文件里其余所有 token —— 21 个主题色（含三档线色）、20 个度量、`--ring` 与 `--shadow-pop` —— 目前在任何分片里都没有 `var()` 消费者。这就是地基当前的状态，不是本表的疏漏：各分片读取的仍是遗留登记簿，把它们重新接线的配色翻转是下一个计划。

### 合法性是按底面、按主题判定的

对比度是一对取值之间的属性，不是单个 token 的属性。实测数值：

| 前景色 | 深色在 `--c-surface` | 浅色在 `--c-surface` | 浅色在 `--c-control` | 浅色在 `--c-chrome` |
| --- | --- | --- | --- | --- |
| `--tx-1` | 16.46 | 17.77 | 14.86 | 15.56 |
| `--tx-2` | 9.79 | 8.80 | 7.36 | 7.70 |
| `--tx-3` | 4.79 | 4.83 | **4.04** | **4.23** |
| `--ac` | 7.77 | 4.63 | **3.88** | **4.06** |

这些数值逼出的规则是：**在浅色主题里，弱化文字与强调色文字只属于 `--c-surface`。** `--tx-3` 与 `--ac` 在那里越过 4.5:1（4.83 与 4.63），到了 `--c-control` 与 `--c-chrome` 就跌到 3.88–4.23。深色组宽松得多，但也不是无条件：`--ac` 在每个深色底面上都过关（最差 6.55:1，在 `--c-control` 上），而 `--tx-3` 自己会在 `--c-raised` 上落到 4.48、在 `--c-control` 上落到 4.03。需要指出，`tokens.css` 自己的注释把深色情形表述为"每个底面都过 AA"，这对 `--ac` 和 `--tx-1`/`--tx-2` 成立，对 `--tx-3` 在最亮两档深色底面上并不成立；上表才是实测结论，那句注释是本文与源码唯一的分歧处。

`design-tokens.test.mjs` 断言的是 `--c-surface` 的那些配对，加上 `--c-chrome` 上的 `--tx-1` 与 `--idle`，以及 `--ac` 上的 `--ac-fg`。它并不断言本表的每个格子，所以只用于外壳的底面一旦改动，必须对照本表手工核查。

细线被有意排除在这套纪律之外：它们不是文字。`--line` 在深色组的 `--c-surface` 上测得 1.27:1（浅色组 1.29:1），而这个接近 1.27:1 的目标是刻意的 —— 用一道几乎察觉不到的边来承载深度，正如上面的阶梯在相邻两级之间只以 1.04–1.19 承载深度。被它替换掉的 `rgba(222, 226, 255, 0.085)` 在当前描边的六个遗留底色上（`--topbar`、`--nav`、`--main`、`--main-soft`、`--card`、`--field`）合成后是 1.21:1–1.25:1，所以新 token 只是略微更显眼，而不是对分隔线的重新设计。让一根细线去通过文字对比度测试才是这段说明要防的错误。

## 主题机制

- `:root` 声明 `color-scheme: dark`，`[data-theme="light"]` 声明 `color-scheme: light`。`color-scheme` 才是告知用户代理用哪套表单控件与滚动条色板去绘制的那个属性，所以它是主题的一部分，不是装饰。
- 解析顺序：两个选择器匹配同一个元素（`<html>`），特异度相同，浅色块在文件里更靠后，于是它恰好在自己重声明的颜色组、终端组和 `--shadow-pop` 上获胜。度量、字体与字号都从 `:root` 继承。因此浅色组只重声明颜色，而任何只在浅色组里出现的 token 都会触发 `no token is declared only in the light theme` 失败。
- 终端在两个主题里都保持深色，做法是把同样四个值声明两遍，并被断言逐字节相同。
- **开关还不存在。** `packages/ui/src`、`apps/desktop/`、`apps/web/` 里没有任何代码设置 `data-theme` 属性；源码中该字符串唯一出现的位置就是 `tokens.css` 里那个选择器以及解释它的注释。因此浅色组今天不可达，在改版后的外壳交出写这个属性的控件之前会一直不可达。但它处于测试之下 —— `design-tokens.test.mjs` 在每条断言里都测量两个组 —— 所以这些取值不会在无人触及时悄悄漂移。
- `[data-density="compact"]` 与主题无关，只重映射 `--row-h`。

## 终端色板

`packages/ui/src/terminal-view.ts` 用六次 `read()` 覆盖五个 token 来构造 xterm 主题：

```ts
const probe = document.documentElement
const read = (name: string) => getComputedStyle(probe).getPropertyValue(name).trim()
```

`theme:` 持有 `background`、`foreground`、`cursor`、`cursorAccent` 与 `selectionBackground`，每一项都只是一次 `read()`；`terminal-theme.test.mjs` 会扫描这个对象里的十六进制字面量，发现即失败。`cursorAccent: read('--term-bg')` 保留下来，因为 xterm 用它来反转光标之下的字形，而块状光标下的那一格就是画布。`fontFamily: read('--font-term')` 取代了第五份手工拷贝的字体栈，于是 CJK 回退如今只活在一处。

`read()` 不带回退值是刻意的。`app.ts:2` 导入 `style.css`，而 `index.html:17` 以构建后的 `app.css` 把它送达，因此构造任何终端之前自定义属性早已解析完毕；一个回退字符串只会增加一条未经测试的路径，把改了名的 token 藏起来，并且会把颜色字面量塞回守卫所读取的那个文件。真正拴住这些名字的是 `terminal-theme.test.mjs`，它断言四个 `--term-*` 名字逐一出现在源码里。

十六个 ANSI 条目，按 `ANSI` 数组顺序，并给出每条在 `--term-bg` 上的实测比例：

| # | 取值 | 比例 | # | 取值 | 比例 |
| --- | --- | --- | --- | --- | --- |
| 0 black | `#101317` | 1.07 | 8 brightBlack | `#5f656e` | 3.39 |
| 1 red | `#f2555a` | 5.90 | 9 brightRed | `#ff7b81` | 7.97 |
| 2 green | `#4ec27f` | 8.87 | 10 brightGreen | `#7ddba8` | 11.93 |
| 3 yellow | `#e0a83c` | 9.33 | 11 brightYellow | `#f2c86f` | 12.59 |
| 4 blue | `#5aaeff` | 8.48 | 12 brightBlue | `#7cc0ff` | 10.29 |
| 5 magenta | `#c58aff` | 8.02 | 13 brightMagenta | `#d9a8ff` | 10.43 |
| 6 cyan | `#57c8d0` | 10.04 | 14 brightCyan | `#7fe0e8` | 13.03 |
| 7 white | `#b9bec6` | 10.67 | 15 brightWhite | `#f2f3f5` | 17.95 |

xterm 的 `ITheme` 逐个命名这十六项 —— `black`、`red`…… `brightWhite` —— 它的 `ThemeService` 再把命名键折进自己那张 0–15 数组，所以这份列表是按位置交付的：0–7 常规、8–15 亮色，顺序为黑/红/绿/黄/蓝/品红/青/白。给中性集用字面颜色名会有误导性，因此数组保留为可读的那份列表，`palette: ITheme` 对象只做折叠。

第 0 条**故意不是** `--term-bg`。早期草稿里两者都是 `#08090a`，那会让终端上的黑字按构造恰好是 1.00:1：`printf '\e[30mhidden\e[0m'` 将不是"暗"，而是"不存在"。`#101317` 抬到 1.07:1，作为可辨颜色仍然几乎不可见，而这是正确的 —— 它是画布的阴影档。第 8 条亮黑才是这条约束真正咬合之处：提示符用它表示*弱化*而非隐藏的文字，而初稿的 `#565b63` 测得 2.92:1，低于 3:1 下限。`#5f656e` 以 3.39:1 通过。

`@xterm/xterm` 6.0.0 的 `ITheme` 并不提供 `ANSI` 键；唯一的数组是覆盖第 16–255 项的 `extendedAnsi`。把 `ANSI,` 写进主题对象会编译失败：`TS2353: Object literal may only specify known properties, and 'ANSI' does not exist in type 'ITheme'`。这个失败是好结果：一次类型断言反而能通过编译，xterm 会忽略那个未知键，出厂的终端就会渲染 xterm 自己的 `DEFAULT_ANSI_COLORS` —— 即 Tango 集，黑为 `#2e3436`、红为 `#cc0000` —— 而任何地方都不会报错来告诉你这件事。上面那次按位置的折叠，才是让中性集真正落到屏幕上的原因。

## 字体排印

`Inter` 在 `packages/ui/src/styles/fonts.css` 里本地声明，而不是从它的包导入，有两个彼此独立的理由。

`@fontsource-variable/inter` 5.3.0 是一个可变字体包：它根本没有按字重切分的文件，因为每个子集一个文件就服务了整条 100–900 轴。于是子集是唯一可选项，而该包发布的每一个 CSS 文件 —— `index.css`、`standard.css`、`wght.css`、`opsz.css` 及其斜体变体 —— 都一次声明全部七个子集。`stylesheet-contract.test.mjs` 断言清单里绝不出现 `@fontsource`，因为导入其中任何一个入口都会把希腊文、西里尔文和越南文塞进每个安装包，而本页面一个也渲染不到：七个可变 woff2 文件合计 218,512 字节（213 KiB），其中页面无法触及的五个子集占 85,188 字节（83 KiB）。随包只发两个 latin 文件。

第二个理由是一个名字。该包把自己的字体族命名为 `Inter Variable`，而 `--font-ui` 索取的是 `Inter`。一张不应答 token 所索取之名的字面会把字节发出去、却照样渲染 Segoe UI，而且是静默的 —— 找不到任何条目的字体栈只会向下穿透。所以字面在这里以那个确切名字声明，描述符与 unicode-range 沿用包内原值；测试会从 `--font-ui` 里读出被索取的族名，并要求每张字面都携带它 —— 外加每块的 `font-weight: 100 900`、`font-style: normal` 与 `unicode-range`。这里使用 `format('woff2')` 而非旧的 `woff2-variations` 写法，因为后者可能被用户代理跳过；真正解锁权重轴的是同一块里的权重范围描述符。

四个字重，不再多：普查允许 400、500、600、700（以及 `normal`/`bold` 关键字）。今天各分片声明 400 三次、600 五次、700 十二次；500 合法但未被使用。Inter 是可变的，能渲染 650 或 750，而这恰恰是问题：`--font-ui` 里的 CJK 与系统回退不能，于是越界的取值是在向一张回退字体索要它并不拥有的字重，浏览器只好合成一个。13px 界面文字上的合成粗体正是这份清单要防的那种糊。改动之前分片里确实有 650、750 和 800；如今这 20 处声明都落在四档刻度上。

`.ti` 在 `base.css` 里被钉为 `font-weight: 400`，而不是任其继承。Tabler 只拥有一档字重，它周围的外壳索取 600–700，而定义 `.ti` 的外部导入排在级联第一位，所以任何后续分片都能撤销厂商自带的钉子。测试断言这颗钉子以及配套的 `font-style: normal` 和 `-webkit-font-smoothing: antialiased`，因为图标上的合成斜体是变形的字形，不是样式。

`--font-term` 在拉丁等宽字面与通用关键字之间保留 `"Sarasa Mono SC"` 和 `"Microsoft YaHei Mono"`。终端必须能画出制表符号和宽字符，而 Cascadia Mono 与 Consolas 并不覆盖它们；删掉这两个回退会把中文输出丢给用户代理默认等宽，并破坏对齐。它与 `terminal-view.ts` 曾经硬编码的那份列表完全一致，所以改用 `read('--font-term')` 是取值不变的。

构建产物如下，来自 `scripts/build-ui.mjs`，其中 `assetNames: 'fonts/[name]-[hash]'`：

| 文件 | 字节 |
| --- | --- |
| `packages/ui/dist/fonts/inter-latin-wght-normal-NRMW37G5.woff2` | 48,256 |
| `packages/ui/dist/fonts/inter-latin-ext-wght-normal-HA22NDSG.woff2` | 85,068 |

两个入口共用 133,324 字节字面，且没有远程字体请求：页面的 Content-Security-Policy 保持 `font-src 'self'`。

OFL 声明必须是一个 `/*!` 块，不能是 `/*` 注释，也不能只是一条指向包内许可证的路径。esbuild 在把级联摊平成单个文件时会保留法律注释 —— 即以 `/*!` 开头的那些 —— 于是这份署名会抵达 `packages/ui/dist/app.css`，与 Tabler 自己的文件头并列；而 `scripts/stage-desktop.mjs` 在 staging 时刻意跳过 `@pureterm/ui` 的依赖，理由是浏览器包已经内嵌了页面所需的一切。因此安装器发出字面却不会发出它指向的那个 `node_modules/@fontsource-variable/inter/LICENSE`。能跟着走的只有那条注释。

## 遗留登记簿

`packages/ui/src/styles/legacy.css` 是债务，它自己的文件头就是这么写的。它把改版前的色板 —— 深蓝紫表面、`#a7c4ff` 强调色、半透明的 `rgba(222, 226, 255, .0xx)` 细线 —— 保存为 100 个按角色命名的自定义属性，而各分片今天仍读取其中 99 个。它不是第二套 token 体系，也不是往颜色里添加东西的地方。

两道守卫让这件事从愿望变成事实。**计数棘轮**是一条精确等式：`LEGACY_DECLARATIONS = 100` 与去掉注释后文件中实际声明的条目数比对，并且分号数量也被断言为同一个数，于是那里除登记条目之外不能声明任何东西。新增一行就会让测试套件失败 —— 这也是唯一的原因，使一个对颜色规则豁免的文件无法悄悄生长。配色翻转 —— 测试注释里称作 "Plan 2" —— 在删除条目时同步缩小这个常量。**引用活性白名单**是另一半：每个 `--legacy-*` 条目都必须被某个分片读取，或者被写进 `UNREFERENCED_LEGACY`；而白名单是双向断言的 —— 一个离开登记簿的条目，或一个新获得调用点的条目，都会失败，直到它的名字从清单里删除。今天这张清单恰好只含一个条目 `--legacy-surface-sunken`，它的 `#1c2033` 由映射表路由到了 `--legacy-surface-tab-session`；保留它是为了让登记簿在翻转时仍然完整。

有四条不是颜色，也不会随色板一同死去：`--radius-sm: 7px`、`--radius-md: 10px`、`--radius-lg: 15px` 和 `--motion-standard: cubic-bezier(0.32, 0.72, 0, 1)`。它们在 `base.css`、`hosts.css`、`inspector.css`、`states.css` 和 `terminal.css` 里共有 22 个引用，且没有别的声明。文件删除**之前**必须先把它们迁回 `tokens.css` —— 映射到 `--r-*` 与 `--ease`，或者以新名字保留 —— 否则 `git rm legacy.css` 会把几何和缓动曲线一起带走。另需知道：`legacy.css` 没有浅色组，所以只要这个文件还在，100 条在浅色模式下全是深色。

配色翻转欠下的远不止一次查找替换：

- `visual-contract.test.mjs` 断言合并后的级联仍然声明 `--topbar`、`--nav`、`--card`、`--text-strong` 与 `--accent`。这五个名字只存在于 `legacy.css`，所以删掉该文件会弄挂一条与颜色归属毫无关系的测试。翻转必须把这些断言迁移到新的阶梯上。
- `.ssh-section` 用 `1px solid var(--legacy-line-faint)` 分隔连接表单，那是抽屉 `--nav` 底面上的一层 `rgba(222, 226, 255, 0.05)`：实测 1.14:1。它只是一条名字上叫分隔线的东西，翻转必须决定它究竟是变成可见的 `--line`，还是停止假装自己是一条分隔线。
- `packages/ui/src/index.html:15` 仍带着 `<meta name="theme-color" content="#121426">`，一处退休色板的字面量，住在一个没有任何守卫读取的文件里，如今与屏幕上任何真实渲染都不再对应。它属于翻转欠下的那条主题同步断言。
- `--term-*` 组完全没有 CSS 消费者：唯一的读取方是 `terminal-view.ts`，而 CSS 守卫不扫描它。`terminal-theme.test.mjs` 是拴住它的唯一一根线，所以配色翻转无法透过样式表"看见"终端，必须要在测试里被告知这件事。

## 已知缺口

- `#keychain-fingerprint` —— 页面里唯一的 `<code>` 元素（`index.html:101`）—— 没有 `font-family` 规则。`keychain.css:45` 给它定尺寸、给颜色，然后就此收手，于是密钥指纹以用户代理的默认等宽渲染，而不是 `--font-mono`。族名普查看不见这件事：它拒绝的是"写了字体栈而没走 token"的声明，而一条缺席的声明算不上声明。
- `--fs-term: 13.5px` 没有消费者。`terminal-view.ts` 向 `Terminal` 构造器传的是 `fontSize: 14`，那里的注释记录了原因：13.5px 会在没有重新度量的情况下改变 xterm 的单元格度量。这个 token 是意图的陈述，不是生效的取值。
- 具名颜色对字面量规则是不可见的。匹配式是 `/#[0-9a-fA-F]{3,8}\b|\brgba?\(/`，只命中十六进制与函数式 `rgb()`/`rgba()`，所以今天 `color: white` 或 `color: tomato` 能通过守卫。这是一个潜伏的洞，而不是现行的缺陷：`white` 一词在各分片里出现 13 次，每一次都在 `white-space` 属性内部，而 `transparent` 是被有意用在边框与填充上的。要补这个洞需要一条能识别取值位置的规则，而不是一张更宽的词表 —— 因为 `\bwhite\b` 作为模式同样会匹配 `white-space`，那会把 13 行清白代码报成违规。
- 主题色与度量 token 至今没有一个消费者。各分片里每一处 `var()` 目前都解析到 `legacy.css` 或字号类 token，因此中性阶梯是被 `design-tokens.test.mjs` 孤立验证的，而不是被屏幕上的任何东西验证的。把它们接通的是外壳重建。
- 生成的 `packages/ui/src/lib/changelog.ts` 与 `packages/ui/src/lib/version.ts` 没有任何导入方。`packages/`、`apps/`、`scripts/` 下都没有代码导入它们，构建出的 `packages/ui/dist/app.js` 里也找不到任何变更日志字符串。`npm run release:check` 会解析这两个文件并与 `CHANGELOG.md`、`VERSION.txt` 比对，因此它们不会悄悄过期，但今天它们是构建期的发布元数据，而不是页面内容。
- `--font-mono` 以 `"JetBrains Mono"` 开头，而它并未随包发布；本机只安装了 `@fontsource-variable/inter`。因此界面里的等宽文字会按机器落到 Cascadia Mono 或 Consolas。这是普通字体栈行为，不是缺陷，但它意味着 `--font-mono` 与 `--font-term` 今天的差别只是终端那两个 CJK 回退加上缺席的 JetBrains Mono。
