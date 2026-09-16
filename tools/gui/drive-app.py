"""驱动 PureTerm desktop 的界面，验证「新建多个 host / 保存 / 列表 / 编辑 / 双击连接」。

坐标不靠肉眼读图：全部用按颜色扫出来的包围盒中心（见 probe2.py 的思路）。
截图与窗口 1:1（DPI=1.5），所以屏幕坐标 = 窗口原点 + 图内坐标。

用法：python drive-app.py <stage>    stage ∈ create / edit / connect
"""

import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from drive import click, find, focus, press, type_text  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
APP = os.path.join(ROOT, 'apps', 'desktop')
SHOTS = os.path.join(HERE, 'shots')
ELECTRON = os.environ.get('PURETERM_ELECTRON') or subprocess.check_output(
    ['node', '-p', "require('electron')"], cwd=APP, text=True, encoding='utf-8').strip()
TITLE = os.environ.get('PURETERM_WINDOW', 'SSH Cordis Client')

# ── 窗口内坐标（device px，DPI = 1.5，由 probe 实测）────────────────
X_HOST, X_PORT, X_USER, Y_ROW2 = 633, 902, 1096, 212
X_PASS, Y_PASS = 1000, 296
Y_ROW1, X_SAVE, X_DEL = 124, 1518, 1613
X_CONNECT, Y_CONNECT = 1518, 210
X_NEW, Y_NEW = 375, 122

win = find(TITLE)
OX, OY = win['rect'][0], win['rect'][1]
print(f"窗口「{win['title']}」{win['size'][0]}x{win['size'][1]} @ {OX},{OY}")
focus(win['hwnd'])
time.sleep(0.4)


def click_at(x, y, double=False, pause=0.35):
    click(OX + x, OY + y, double=double)
    time.sleep(pause)


def shot(name):
    env = {k: v for k, v in os.environ.items() if k != 'ELECTRON_RUN_AS_NODE'}
    result = subprocess.run(
        [ELECTRON, os.path.join(HERE, 'capture.cjs'), SHOTS, TITLE,
         str(win['size'][0]), str(win['size'][1]), name],
        capture_output=True, text=True, env=env, timeout=60,
    )
    print('   ', result.stdout.strip() or result.stderr.strip()[-300:])


def fill(host, port, user, password):
    click_at(X_HOST, Y_ROW2)
    press('ctrl+a')
    type_text(host)
    click_at(X_PORT, Y_ROW2)
    press('ctrl+a')
    type_text(port)
    click_at(X_USER, Y_ROW2)
    press('ctrl+a')
    type_text(user)
    click_at(X_PASS, Y_PASS)
    press('ctrl+a')
    type_text(password)
    print(f"    已填：{user}@{host}:{port}")


stage = sys.argv[1] if len(sys.argv) > 1 else 'create'

if stage == 'create':
    # 第一台：指向本机假 SSH 服务端
    fill('127.0.0.1', '59954', 'demo', 'demo')
    click_at(X_SAVE, Y_ROW1, pause=0.8)
    shot('a1-first-saved')

    # 第二台：必须先按「新建」——保存之后表单已经在「编辑」态，
    # 直接改地址再保存会去覆盖第一台，而不是新增
    click_at(X_NEW, Y_NEW)
    shot('a2-new-cleared')
    fill('10.0.0.9', '22', 'ops', 'hunter2')
    click_at(X_SAVE, Y_ROW1, pause=0.8)
    shot('a3-second-saved')

elif stage == 'edit':
    # 点第一行的「编辑」（行内按钮位置在列表渲染出来后由 probe 得到）
    row_edit = (int(sys.argv[2]), int(sys.argv[3]))
    click_at(*row_edit, pause=0.6)
    shot('b1-editing')

elif stage == 'connect':
    row = (int(sys.argv[2]), int(sys.argv[3]))
    # 只发一次双击：双击本身就含两下 click，外面再补一下会变成三击
    click_at(*row, double=True, pause=3.0)
    shot('c1-connected')

elif stage == 'delete':
    row_del = (int(sys.argv[2]), int(sys.argv[3]))
    click_at(*row_del, pause=1.2)
    # window.confirm 弹的是系统对话框，不属于任何窗口的内容 —— 只有整屏捕获能拍到它
    env = {k: v for k, v in os.environ.items() if k != 'ELECTRON_RUN_AS_NODE'}
    subprocess.run(
        [ELECTRON, os.path.join(HERE, 'capture.cjs'), SHOTS, '@screen', '2560', '1600', 'd1-confirm'],
        capture_output=True, text=True, env=env, timeout=60,
    )
    print('    已整屏捕获确认框')
    press('enter')
    time.sleep(0.8)
    shot('d2-deleted')

else:
    raise SystemExit(f'未知 stage {stage}')
