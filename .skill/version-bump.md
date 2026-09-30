# version-bump

真正的 skill 在 **`.codebuddy/skills/version-bump/`**，这里只是指路。

## 为什么不放在本目录

CodeBuddy Code 只从下面两处加载 skill：

- **项目级**：`.codebuddy/skills/<name>/SKILL.md`
- **用户级**：`~/.codebuddy/skills/<name>/SKILL.md`

`.skill/` 不在扫描路径里。放在这里的文件既不会被自动加载，也不会出现在 `/` 菜单里 —— 所以
可执行的那份放在 `.codebuddy/skills/`，本目录保留这份说明，方便按 `.skill/` 这个名字去找。

## 内容

| 文件 | 作用 |
| --- | --- |
| `.codebuddy/skills/version-bump/SKILL.md` | skill 正文（英文，遵循仓库「维护性 Markdown 英文优先」的约定） |
| `.codebuddy/skills/version-bump/SKILL_zh.md` | 完整中文镜像 |
| `.codebuddy/skills/version-bump/bump-version.mjs` | 机械部分：同步 `VERSION.txt` + 七个 manifest + lockfile，再跑两个生成器与 `release:check` |

## 一句话用法

```bash
node .codebuddy/skills/version-bump/bump-version.mjs 0.1.0-alpha.2 --dry-run   # 先看要改什么
node .codebuddy/skills/version-bump/bump-version.mjs 0.1.0-alpha.2             # 真正执行
```

手工的部分（把 `[Unreleased]` 条目搬进带日期的版本段、写 `_zh` 镜像、打 tag）仍然要人来做，
SKILL.md 里逐条列了。
