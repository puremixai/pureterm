"""截图脱敏：把用户数据（主机名/IP/标签/邮箱/密钥名/提示符）涂掉，保留界面结构。

为什么不用「我估坐标」：这份分析要看的是**版式和结构**，不是抹得严不严；
靠肉眼估矩形容易漏。所以卡片行/列用**背景色自动分带**识别，只有少量
非规则区域（输入框的值、提示符）才手写矩形。

用法：
  python redact.py probe <png> <x> <y0> <y1>     打印某一列的颜色分带（用于校参）
  python redact.py run                           按配置批量脱敏
"""

import sys
from PIL import Image, ImageFilter


def probe(path, x, y0, y1):
    im = Image.open(path).convert('RGB')
    prev = None
    start = y0
    for y in range(y0, y1):
        px = im.getpixel((x, y))
        key = tuple(v // 8 for v in px)
        if key != prev:
            if prev is not None:
                print(f'  y {start:>5}..{y - 1:<5} len={y - start:<5} rgb={px}')
            prev = key
            start = y
    print(f'  y {start:>5}..{y1 - 1:<5} len={y1 - start:<5} rgb={im.getpixel((x, y1 - 1))}')


def band_runs(path, x, y0, y1, is_card, min_len=20):
    """按谓词把一段列切成交替的 runs，返回 (start, end, is_card) 列表"""
    im = Image.open(path).convert('RGB')
    runs = []
    cur = None
    start = y0
    for y in range(y0, y1):
        flag = is_card(im.getpixel((x, y)))
        if cur is None:
            cur, start = flag, y
        elif flag != cur:
            if y - start >= min_len:
                runs.append((start, y - 1, cur))
            else:
                # 太短：并入前一段（消除圆角/文字的干扰）
                if runs:
                    s, _e, f = runs[-1]
                    runs[-1] = (s, y - 1, f)
            cur, start = flag, y
    runs.append((start, y1 - 1, cur))
    return runs


def blur_rect(im, box, radius=9):
    x0, y0, x1, y1 = [int(v) for v in box]
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(im.width, x1), min(im.height, y1)
    if x1 <= x0 or y1 <= y0:
        return
    patch = im.crop((x0, y0, x1, y1)).filter(ImageFilter.GaussianBlur(radius))
    im.paste(patch, (x0, y0))


if __name__ == '__main__':
    a = sys.argv[1:]
    if a[0] == 'probe':
        probe(a[1], int(a[2]), int(a[3]), int(a[4]))
    elif a[0] == 'runs':
        # 判断「是不是卡片背景」：卡片比页面底色亮
        thr = int(a[5])
        runs = band_runs(a[1], int(a[2]), int(a[3]), int(a[4]),
                         lambda px: sum(px) / 3 > thr, int(a[6]) if len(a) > 6 else 20)
        for s, e, is_card in runs:
            print(f'  {"卡片" if is_card else "空白"}  y {s:>5}..{e:<5} len={e - s + 1}')
    else:
        print(__doc__)
