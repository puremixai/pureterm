"""截图辅助：叠坐标网格（为了准确点中元素）+ 裁剪放大（为了看清细节）。

用法：
  python img.py grid <输入.png> <输出.png> [步长=100]
  python img.py crop <输入.png> <输出.png> <x> <y> <w> <h> [放大倍数=2]
"""

from PIL import Image, ImageDraw, ImageFont
import sys


def font(size):
    for path in (
        'C:/Windows/Fonts/msyh.ttc',
        'C:/Windows/Fonts/segoeui.ttf',
        'C:/Windows/Fonts/arial.ttf',
    ):
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    return ImageFont.load_default()


def grid(src, dst, step=100):
    im = Image.open(src).convert('RGB')
    draw = ImageDraw.Draw(im)
    f = font(16)
    w, h = im.size

    for x in range(0, w, step):
        draw.line([(x, 0), (x, h)], fill=(255, 60, 60), width=1)
    for y in range(0, h, step):
        draw.line([(0, y), (w, y)], fill=(255, 60, 60), width=1)

    # 标签：横轴标在顶部，纵轴标在左侧
    for x in range(0, w, step):
        if x:
            draw.rectangle([x + 1, 0, x + 66, 20], fill=(255, 255, 0))
            draw.text((x + 3, 2), str(x), fill=(0, 0, 0), font=f)
    for y in range(0, h, step):
        if y:
            draw.rectangle([0, y + 1, 60, y + 21], fill=(255, 255, 0))
            draw.text((3, y + 3), str(y), fill=(0, 0, 0), font=f)

    im.save(dst)
    print(f'{w}x{h} → {dst}（网格步长 {step}）')


def crop(src, dst, x, y, w, h, scale=2):
    im = Image.open(src).convert('RGB')
    box = (x, y, min(x + w, im.width), min(y + h, im.height))
    part = im.crop(box)
    if scale != 1:
        part = part.resize((part.width * scale, part.height * scale), Image.LANCZOS)
    part.save(dst)
    print(f'裁剪 {box} ×{scale} → {dst}（{part.width}x{part.height}）')


if __name__ == '__main__':
    a = sys.argv[1:]
    if a[0] == 'grid':
        grid(a[1], a[2], int(a[3]) if len(a) > 3 else 100)
    elif a[0] == 'crop':
        crop(a[1], a[2], int(a[3]), int(a[4]), int(a[5]), int(a[6]), int(a[7]) if len(a) > 7 else 2)
    else:
        print(__doc__)
