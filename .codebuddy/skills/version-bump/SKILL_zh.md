---
name: version-bump
description: 推进 PureTerm 源码版本号：同步 VERSION.txt、全部 workspace manifest、lockfile 与两个 changelog，重新生成 UI 元数据并用 release:check 兜底。适用于 0.1.0-alpha.N → beta.N → rc.N → 0.1.0 的阶段推进，以及被要求准备、切出或记录一次发布时。
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
---

# PureTerm 版本号维护

PureTerm 处于 `0.x` 周期。一个版本号散落在九个地方，必须一起动，而唯一能发现遗漏的是
`npm run release:check`。这个 skill 把机械的那部分串起来，并明确说清哪些地方仍然需要判断。

权威说明在 [docs/DEVELOPMENT_zh.md](../../../docs/DEVELOPMENT_zh.md) 的「版本与 changelog」一节；
如果流程本身变了，英文版与 `_zh` 版要一起改。

## 版本号方案

`0.1.0-alpha.N` → `0.1.0-beta.N` → `0.1.0-rc.N` → `0.1.0`，然后 `0.2.0` 走同一架梯子。
数字后缀在每个阶段独立计数、从 1 开始。一个目标版本要按阶段推进；该阶段的工作没做完就不要
提前进 `beta` 或 `rc`。已发布的版本号绝不复用。源码版本不带 `v`，git tag 带（`v0.1.0-alpha.1`）。

## 版本号所在的九处

| 位置 | 数量 |
| --- | --- |
| `VERSION.txt` | 1 |
| 根 `package.json` 以及 `apps/*`、`packages/*` | 7 |
| `package-lock.json` —— 顶层 `version`、`packages[""].version`，以及每个 workspace 一条 `packages[<dir>].version` | 9 行 |
| `packages/ui/src/lib/version.ts` | 生成物，绝不手改 |
| `packages/ui/src/lib/changelog.ts` | 生成物，绝不手改 |

## 机械的那部分

```bash
node ${CODEBUDDY_SKILL_DIR}/bump-version.mjs 0.1.0-alpha.2 --dry-run   # 只报告，不写任何文件
node ${CODEBUDDY_SKILL_DIR}/bump-version.mjs 0.1.0-alpha.2             # 真正执行
```

先跑 `--dry-run` 并把将要改动的清单给用户看。脚本用与检查器同一个 `VERSION_PATTERN` 校验
新版本号，拒绝与当前版本相同或更低的版本号，拒绝已经有 changelog 段的版本号；然后写入
`VERSION.txt`、七个 manifest 和 lockfile，并依次运行 `scripts/convert-changelog.js`、
`--sync-version`、`scripts/changelog.mjs --check`。每个 JSON 文件都以
`JSON.stringify(value, null, 2) + "\n"` 回写，而这正是这八个文件当前的格式，所以 diff 里只会
有版本号本身。`--force` 可以越过守卫；只有在明确要重做某件事时才用它。

**为什么需要这个脚本。** `node scripts/convert-changelog.js --sync-version` 只做一件事：读
`VERSION.txt`，写 `packages/ui/src/lib/version.ts`。它**不碰**任何 `package.json`，也不碰
lockfile —— 尽管名字看起来像是会同步。手工同步九个地方正是版本号半途而废的原因，而最终
发现这件事的是 `release:check`。

## 仍然需要判断的部分

1. **把 `[Unreleased]` 的条目搬进** `CHANGELOG.md` 里新的 `## [<版本>] - <YYYY-MM-DD>` 段，
   并留一个空的 `[Unreleased]` 标题给后续工作。
2. **在 `CHANGELOG_zh.md` 里做同样的搬运。** 中文 changelog 是完整翻译而非摘要；小节标题保持
   英文（`### Changed`）。
3. **改完英文 changelog 后重跑 `node scripts/convert-changelog.js`**，因为 `changelog.ts` 由它生成。
4. **按仓库的行文风格写条目。** 先读相邻的条目：它们讲清改动、机制与实测证据，并且会点明哪些
   能力**尚不支持**，而不是暗示其存在。在一篇满是长段落的 changelog 里写一行短句，读起来像是疏漏。
5. **一起提交**两个 changelog、`VERSION.txt`、七个 manifest、lockfile 和两个生成产物。

## 发版闸门

三项都过之前不要打 tag：

```bash
npm run verify
npm run verify:electron
npm run dist:desktop          # 外加 Windows 包验收
```

然后 `npm run release:check -- --version <版本>` 与
`npm run release:notes -- --version <版本> --output release-notes.md`；工作流只创建 GitHub
**草稿**发布，不会自动发布。未运行的检查不算通过的检查 —— 要记为「未运行」，不要记为通过。

## 环境说明

这台开发机是 macOS 12.7.6 的 `MacBookPro11,4`，官方支持上限就是 Monterey。因为仓库把 Electron
钉在 43，`npm run verify:electron` 在这里能跑通并通过；Electron 44 及以上要求 macOS 13。在没有
keyring 的 Linux CI runner 上，`RuntimeCapabilities.credentialPersistence` 为 `'session'`，桌面端
Keychain 那一步断言的是「拒绝保存」而不是一次往返。细节见关于这台机器的 memory 记录。
