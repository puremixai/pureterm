"""在截图里按颜色找矩形：给定目标底色，输出所有「够长够高」的连通块的包围盒与中心。

为什么要这么找，而不是看网格图估坐标：图像查看器会把图缩放着显示，
缩放比例每张图都不一样，肉眼读出来的偏差能到十几像素。
按颜色扫出来的坐标是像素精确的，而且点完能立刻用下一张截图验证。

用法：python probe2.py <图.png> <r,g,b> [最小宽=30] [最小高=15]
"""

import sys
from collections import defaultdict

from PIL import Image

path = sys.argv[1]
target = tuple(int(v) for v in sys.argv[2].split(','))
min_w = int(sys.argv[3]) if len(sys.argv) > 3 else 30
min_h = int(sys.argv[4]) if len(sys.argv) > 4 else 15

im = Image.open(path).convert('RGB')
W, H = im.size
px = im.load()

# 逐行取「同色的横向 run」，再把 x 区间相同的 run 在纵向上拼成块
runs = defaultdict(list)
for y in range(H):
    x = 0
    while x < W:
        if px[x, y] == target:
            x0 = x
            while x < W and px[x, y] == target:
                x += 1
            if x - x0 >= min_w:
                runs[(x0, x - 1)].append(y)
        else:
            x += 1

groups = []
for (x0, x1), ys in runs.items():
    ys.sort()
    start = prev = ys[0]
    for value in ys[1:]:
        if value - prev > 2:
            groups.append((x0, x1, start, prev))
            start = value
        prev = value
    groups.append((x0, x1, start, prev))

groups = [g for g in groups if g[3] - g[2] + 1 >= min_h]
groups.sort(key=lambda g: (g[2], g[0]))

print(f"{path}  {W}x{H}  目标色 {target}  找到 {len(groups)} 块")
for x0, x1, y0, y1 in groups:
    print(f"  x {x0:>4}..{x1:<4} y {y0:>4}..{y1:<4}  尺寸 {x1 - x0 + 1}x{y1 - y0 + 1}  中心 ({((x0 + x1) // 2)},{(y0 + y1) // 2})")
