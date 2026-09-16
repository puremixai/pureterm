"""聚焦 Termius → 按窗口真实尺寸抓一张 PNG。一次调用完成「看一眼」。

用法：python snap.py <文件名> [--no-focus]
"""

import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from drive import find, focus  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ELECTRON = 'C:/Users/ausu/WorkBuddy/2026-09-15-17-39-38/ssh-cordis-client/node_modules/electron/dist/electron.exe'
OUT = os.path.join(HERE, 'shots')

TITLE = os.environ.get('TERMIUS_WINDOW', 'Termius')
name = 'live'
for a in sys.argv[1:]:
    if a.startswith('--title='):
        TITLE = a.split('=', 1)[1]
    elif not a.startswith('--'):
        name = a

win = find(TITLE)
if '--no-focus' not in sys.argv:
    ok = focus(win['hwnd'])
    print(f"聚焦「{win['title']}」: {ok}")
print(f"窗口 {win['size'][0]}x{win['size'][1]} @ {win['rect'][0]},{win['rect'][1]}")

env = {k: v for k, v in os.environ.items() if k != 'ELECTRON_RUN_AS_NODE'}
result = subprocess.run(
    [ELECTRON, os.path.join(HERE, 'capture.cjs'), OUT, TITLE, str(win['size'][0]), str(win['size'][1]), name],
    capture_output=True, text=True, env=env, timeout=60,
)
print(result.stdout.strip())
if result.returncode != 0:
    print('stderr:', result.stderr.strip()[-800:])
