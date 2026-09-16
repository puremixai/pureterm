"""从实测截图里裁出**不含个人数据**的片段，供报告使用。

原则：报告里不放主机名/IP/邮箱/密钥名/提示符。所以要么只裁界面外壳，
要么把文字区涂掉再裁。这里逐张说明为什么安全。
"""

import os
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SHOTS = os.path.join(HERE, 'shots')
ASSETS = os.path.join(ROOT, 'docs', 'research', 'termius', 'assets')
os.makedirs(ASSETS, exist_ok=True)


def load(name):
    return Image.open(os.path.join(SHOTS, name)).convert('RGB')


def save(im, name):
    path = os.path.join(ASSETS, name)
    im.save(path)
    print(f'{name}  {im.width}x{im.height}')


def blur(im, box, radius=10):
    x0, y0, x1, y1 = [int(v) for v in box]
    patch = im.crop((x0, y0, x1, y1)).filter(ImageFilter.GaussianBlur(radius))
    im.paste(patch, (x0, y0))


# 1) 界面外壳：标题栏（Vault 药丸 + 标签）+ 搜索条 + 左侧导航 + 工具行。
#    卡片区从 y=308 才开始，所以 y<300 里没有主机数据。
#    x 限到 1580：右侧检查器在 y>240 处是「Address（IP）」字段。
chrome = load('restored.png').crop((0, 0, 1580, 300))
save(chrome, '01_shell.png')

# 2) 左侧导航栏单独一张（六项 + 图标）
save(load('restored.png').crop((0, 68, 282, 486)), '02_rail.png')

# 3) 检查器表头：Host Details / Personal vault / ⋯ / →|，以及 "Address" 小节标题。
#    到此为止（y<238）没有值。
save(load('restored.png').crop((1436, 92, 1941, 238)), '03_inspector_head.png')

# 4) 主机卡片的形状与图标处理：取第二张卡（探列确认 y 398..506），
#    把图标右侧的文字区整块涂掉 —— 卡片左边距 323，图标 347..408，文字从 ~430 起。
card = load('restored.png').crop((315, 393, 845, 512))
blur(card, (95, 0, card.width, card.height), radius=12)
save(card, '04_host_card.png')

# 5) 凭据类型工具行：+ New key / Certificate / Windows Hello / FIDO2（无密钥名）
save(load('keychain_view.png').crop((150, 50, 1700, 100)), '05_keychain_toolbar.png')

# 6) Snippets 工具行：+ New snippet / Shell History（无内容）
save(load('snippets_view.png').crop((150, 50, 1700, 100)), '06_snippets_toolbar.png')

# 7) 端口转发空状态：整页无个人数据
save(load('pf_view.png'), '07_pf_empty.png')

# 8) 快捷键表（无个人数据）
save(load('settings_shortcuts.png'), '08_shortcuts.png')

# 9) Vault 切换器下拉：只有 Personal / Team
save(load('vault_screen2.png').crop((515, 130, 1160, 310)), '09_vault_menu.png')
