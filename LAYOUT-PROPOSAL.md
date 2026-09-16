# Desktop 目录决策

状态：已采纳。目标是让单个桌面应用的源码、依赖、构建和验证可以从克隆复现，并用检查脚本约束依赖方向。实施步骤及实际验证结果见[整改方案](docs/superpowers/plans/2026-09-16-desktop-layout-remediation.md)。

原始提案保留在[归档](docs/archive/layout-proposal-original.md)，其事实问题与迁移风险见[2026-09-16 评审](docs/reviews/layout-review-2026-09-16.md)。历史文件继续使用当时的目录和测试描述，不作为现行执行指引。

## 目录与安装边界

```text
pureterm/
  README.md
  LAYOUT-PROPOSAL.md
  apps/desktop/
    package.json / package-lock.json / .gitignore
    README.md / tsconfig*.json
    src/
      host.ts                     Cordis 装配与公共 Host 门面
      services/ / plugins/        现有业务实现
    shared/                       载体无关协议
    renderer/                     页面、xterm 与客户端传输适配
    electron/
      app/                        main、shell、platform
      runtime/                    纯决策、就绪、档案、重启、资源路径
      bridge/                     dispatcher
      carriers/                   IPC、HTTP/WS、preload、合成桥
      diagnostics/                应用进程内的 boot/smoke 钩子
    scripts/                      应用构建、启动和边界检查
    tests/                        测试与本机夹具
  docs/
    architecture.md
    reviews/ / archive/
    research/termius/              最终报告、模板与 assets
    superpowers/plans/
  tools/gui/                      可选 GUI 调研与验收脚本
```

应用仍是一个 npm 包。package、锁文件、安装目录、scripts 和 tests 都归 `apps/desktop/`；不将依赖 esbuild/Electron 的应用脚本搬到根目录，因为模块解析以脚本位置为起点，改变 cwd 不能解决依赖归属。仓库根统一用 `npm --prefix apps/desktop ...` 调用应用命令。

`src/services/` 与 `src/plugins/` 本轮保留，以减少无关重构；这两个目录并不严格对应 Cordis 类别。是否拆模块、接口或 npm 包，按实际职责、替换需求和使用者判断，不设文件行数或载体数量阈值。

## 可执行的约束

- `src/` 不依赖 Electron、renderer 或 Electron 壳实现。
- `renderer/` 不导入 Node、Electron 或 Host 实现，通过传输适配访问共享协议。
- `shared/` 不依赖任何运行侧。
- `electron/` 访问 `src/` 时只经过 `src/host.ts`，包括所需的公共类型；生产壳不访问 `Host.internals`。
- `electron/runtime/` 和 `electron/bridge/` 不导入 Electron；`electron/app/`、IPC、preload 与必要诊断钩子可以使用 Electron API。

规则由应用内 `scripts/check-boundaries.mjs` 检查，并接入 `typecheck`；临时测试工程验证合法依赖可通过、非法依赖会失败。目录分组与导入数量本身不等于边界已经受保护。

## 构建与迁移回归

`build` 先清理应用自己的 `dist/`，再生成主进程、CommonJS preload 和 renderer：

| 资源 | 构建产物 |
| --- | --- |
| Electron 入口 | `apps/desktop/dist/electron/app/main.js` |
| preload | `apps/desktop/dist/electron/carriers/preload.cjs` |
| 页面、脚本、样式 | `apps/desktop/dist/renderer/index.html`、`app.js`、`app.css` |

主进程通过 `electron/runtime/paths.ts` 集中定位资源，使用编译模块所在位置，不依赖启动时 cwd。迁移同时调整 package main/start、各启动器、preload 构建输入输出与 TypeScript 排除项；preload 的相对导入统一使用 `.js`，ESM 扩展名检查不再保留旧路径例外。资源测试覆盖从非应用 cwd 定位产物。诊断钩子仍随主进程构建，不能因移到子目录而漏掉。

测试及 SSH 夹具纳入版本控制，删除旧的测试目录忽略规则。找不到的历史测试以本轮补写用例替代，不继承旧文档的通过次数。`verify` 覆盖类型、边界、干净构建和全部无需 Electron 窗口的测试；`verify:electron` 单列真实 boot、IPC、Web 检查。GUI 驱动留在 `tools/gui/`，原始截图和日志继续忽略。

## 对原提案依据的修正

上游比较固定在评审记录的 deepseek-harness 提交 `0d1f50007f9bca3f52b06e1c3074fa14d5fb0720`，不将本轮布局等同于上游架构。

| 原解释中的问题 | 本轮采用的事实与决策 |
| --- | --- |
| service/plugin 的导出形式等于 `services/`、`plugins/` 的目录规则 | 上游按 `packages/<group>/<package>` 组织；接口导出约定不能推出这两个目录分类。 |
| SSH 提供者分别放在 fs、subprocess、sandbox 目录 | 指定提交的物理目录是 `packages/ssh/{ssh,fs-ssh,subprocess-ssh,sandbox-ssh}`。 |
| Desktop 的薄壳意味着 apps 只接线 | 上游 desktop 还负责 Host 进程、IPC、项目、升级和运行时装配。 |
| 不另造 IPC 插件系统意味着前端没有插件树 | 上游 Web Client 是 Cordis 应用，Desktop 复用 client graph。PureTerm 暂不采用客户端插件树，是当前需求的选择。 |
| 本应用根 tsconfig 是 solution-only 聚合配置 | 它是 Node/Electron 检查与基础配置，包含源码；renderer 由独立配置检查。 |
| “7 个文件 import Electron”足以描述运行时依赖 | 历史基线的 7 个导入文件包含 1 个仅类型导入，运行时导入为 6 个；本轮按依赖规则检查，不以该计数证明解耦。 |

PureTerm 保留 Electron 主进程内的 Host，以及默认启动的本机 Web carrier。上游采用独立 Node Host 子进程和不同页面访问方式，这些取舍不会通过搬目录自动获得。本轮不引入独立 Host、安装更新机制、客户端插件系统、多包 workspace 或新 SSH 实现。
