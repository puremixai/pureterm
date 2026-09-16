# GUI 调研与验收工具

这些可选工具用于 Windows 桌面截图、界面操作及 Termius 调研素材处理，不属于应用构建或自动 `verify`。路径以脚本位置为基准：应用在 `apps/desktop/`，报告、模板和脱敏图片在 `docs/research/termius/`，原始截图默认写入本目录的 `shots/`。

运行前安装应用依赖并构建：

```powershell
npm --prefix apps/desktop ci
npm --prefix apps/desktop run build
python -m pip install Pillow
```

Python 工具需要 Python 3；图片处理需要 Pillow。`drive.py`、`drive-app.py`、`snap.py` 和 `drive-sftp.mjs` 使用 Windows 窗口及输入 API。`capture.cjs` 必须通过 Electron 运行。`drive-sftp.mjs` 还使用 Node 的内置 WebSocket，请使用应用要求的 Node 版本。

| 脚本 | 用途 |
| --- | --- |
| `asar.mjs` | 读取、检索或提取指定的 ASAR 包；输入、输出路径由命令行传入 |
| `capture.cjs` | 按窗口标题或整屏捕获 PNG |
| `snap.py` | 聚焦指定窗口并调用捕获工具，默认窗口为 Termius |
| `drive.py` | 枚举窗口、聚焦、鼠标与键盘输入 |
| `drive-app.py` | 按历史窗口坐标执行主机创建、编辑、连接或删除流程 |
| `drive-sftp.mjs` | 启动本机 SSH 夹具和独立测试应用，验证 SFTP 界面及原生对话框 |
| `crop.py` | 原地裁剪整屏截图 |
| `img.py` | 添加坐标网格或另存裁剪图片 |
| `probe2.py` | 按背景色定位界面矩形 |
| `redact.py` | 检查颜色分带，提供截图模糊处理函数 |
| `make_assets.py` | 从本目录 `shots/` 的指定历史截图生成报告素材 |

支持以下环境变量，无需修改脚本里的机器路径：

| 变量 | 默认值 / 用途 |
| --- | --- |
| `PURETERM_ELECTRON` | `apps/desktop/node_modules/electron` 安装的 Electron；可覆盖为本机可执行文件路径 |
| `PURETERM_PYTHON` | `python`；供 SFTP 驱动调用 Python，可覆盖为可执行文件路径 |
| `PURETERM_WINDOW` | `SSH Cordis Client`；应用窗口标题匹配字符串 |
| `TERMIUS_WINDOW` | `Termius`；`snap.py` 的窗口标题，也可用 `--title=...` 覆盖 |
| `PURETERM_GUI_FONT` | 可选字体文件；网格标签默认尝试 Windows Fonts 目录中的系统字体 |

从仓库根运行的示例：

```powershell
python tools/gui/snap.py live
node tools/gui/drive-sftp.mjs
node tools/gui/drive-sftp.mjs --keep
python tools/gui/img.py grid tools/gui/shots/live.png tools/gui/shots/grid.png
```

桌面驱动会实际移动焦点、点击和输入。`drive-app.py` 操作当前打开的应用，坐标和示例数据需与待验收界面核对；请在测试档案中使用。`drive-sftp.mjs` 自动创建本机测试 SSH 服务、临时应用数据和上传下载样本，默认结束后关闭测试应用并清理临时应用数据；`--keep` 保留应用和数据供人工检查，样本目录会在日志中打印。

原始截图与日志可能包含本机信息，默认目录已加入根 `.gitignore`，不应作为报告资源提交。旧工作副本中的 `termius-analysis/shots/` 忽略规则也保留。历史截图未随仓库提供，`make_assets.py` 只有在补齐其所列原始截图后才能重建素材。最终报告已内联图片，可直接离线打开；模板中的 `{{IMG:文件名}}` 对应报告旁的 `assets/`，需要替换为图片路径或 data URL 后使用。

本轮目录整理仅做 Python / Node 语法与资源路径静态检查，没有运行桌面控制流程；工具中的历史断言不能代替当前应用的自动测试结果。
