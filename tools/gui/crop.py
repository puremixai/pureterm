"""把一张整屏截图裁到指定矩形，原地覆盖。

为什么需要它：原生对话框（文件打开/保存框、confirm）**不属于应用的窗口**，
所以只能整屏抓（`capture.cjs @screen`）。但整屏抓会把用户桌面上其它窗口一起拍进去——
那些内容和这次验证无关，既让截图难看清重点，也没必要留在证据里。
裁到「应用窗口 ∪ 对话框」之后，既看得到「这是系统框、浮在应用上面」，又没有多余的东西。

用法：
  python crop.py <png> <x> <y> <w> <h>
"""

import sys
from PIL import Image

path, x, y, w, h = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])
im = Image.open(path)
box = (max(0, x), max(0, y), min(im.width, x + w), min(im.height, y + h))
# 已经是目标尺寸（或更小）就不动了——免得把一张好图裁没
if box[2] - box[0] < 40 or box[3] - box[1] < 40:
    print(f'不裁：算出来的矩形太小 {box}（原图 {im.width}x{im.height}）')
    sys.exit(0)
im.crop(box).save(path)
print(f'裁到 {box[2] - box[0]}x{box[3] - box[1]}')
