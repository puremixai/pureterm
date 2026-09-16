"""通过 Python 标准库 ctypes 调用 user32，驱动 Windows 桌面应用。

坐标一律是**物理像素**：启动时先声明 per-monitor DPI aware，否则 Windows 会
把坐标虚拟化，截图上量到的点会跟实际点的地方对不上。

用法：
  python drive.py wins                      列出顶层窗口（标题 + 矩形）
  python drive.py dialogs                   只列 Win32 标准对话框（class #32770）
  python drive.py screen                    主屏物理尺寸（整屏截图用）
  python drive.py rect <标题子串>            只看一个窗口的矩形
  python drive.py focus <标题子串>           把窗口切到前台
  python drive.py click <x> <y> [double]     点击（窗口内坐标，基于 rect 的 left/top）
  python drive.py move <x> <y>               只移动鼠标
  python drive.py scroll <x> <y> <delta>     滚轮（正=向上）
  python drive.py key <组合键>               如 ctrl+shift+p / esc / enter / ctrl+a
  python drive.py type <文本>                输入文本（Unicode，逐字符）
"""

import ctypes
import ctypes.wintypes as w
import json
import sys
import time

user32 = ctypes.WinDLL('user32', use_last_error=True)

# ── DPI：必须先声明，否则坐标是虚拟化的 ──
try:
    ctypes.WinDLL('shcore').SetProcessDpiAwareness(2)  # PROCESS_PER_MONITOR_DPI_AWARE
except Exception:
    pass
try:
    user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))  # PER_MONITOR_AWARE_V2
except Exception:
    pass

SW_RESTORE = 9
MOUSEEVENTF = {'move': 0x0001, 'left_down': 0x0002, 'left_up': 0x0004,
               'right_down': 0x0008, 'right_up': 0x0010,
               'wheel': 0x0800, 'hwheel': 0x1000}
KEYEVENTF_KEYUP = 0x0002
KEYEVENTF_UNICODE = 0x0004
INPUT_KEYBOARD = 1
INPUT_MOUSE = 0


class RECT(ctypes.Structure):
    _fields_ = [('left', ctypes.c_long), ('top', ctypes.c_long),
                ('right', ctypes.c_long), ('bottom', ctypes.c_long)]


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [('wVk', w.WORD), ('wScan', w.WORD), ('dwFlags', w.DWORD),
                ('time', w.DWORD), ('dwExtraInfo', ctypes.POINTER(ctypes.c_ulong))]


class MOUSEINPUT(ctypes.Structure):
    _fields_ = [('dx', ctypes.c_long), ('dy', ctypes.c_long), ('mouseData', w.DWORD),
                ('dwFlags', w.DWORD), ('time', w.DWORD),
                ('dwExtraInfo', ctypes.POINTER(ctypes.c_ulong))]


class INPUT(ctypes.Structure):
    class _U(ctypes.Union):
        _fields_ = [('ki', KEYBDINPUT), ('mi', MOUSEINPUT)]
    _anonymous_ = ('u',)
    _fields_ = [('type', w.DWORD), ('u', _U)]


user32.SendInput.restype = w.UINT
user32.SendInput.argtypes = (w.UINT, ctypes.POINTER(INPUT), ctypes.c_int)

VK = {
    'back': 0x08, 'tab': 0x09, 'enter': 0x0D, 'return': 0x0D, 'shift': 0x10,
    'ctrl': 0x11, 'control': 0x11, 'alt': 0x12, 'pause': 0x13, 'caps': 0x14,
    'esc': 0x1B, 'escape': 0x1B, 'space': 0x20, 'pgup': 0x21, 'pageup': 0x21,
    'pgdn': 0x22, 'pagedown': 0x22, 'end': 0x23, 'home': 0x24,
    'left': 0x25, 'up': 0x26, 'right': 0x27, 'down': 0x28,
    'insert': 0x2D, 'delete': 0x2E, 'del': 0x2E,
    'win': 0x5B, 'menu': 0x5D,
    'num0': 0x60, 'num1': 0x61, 'num2': 0x62, 'num3': 0x63, 'num4': 0x64,
    'num5': 0x65, 'num6': 0x66, 'num7': 0x67, 'num8': 0x68, 'num9': 0x69,
    'f1': 0x70, 'f2': 0x71, 'f3': 0x72, 'f4': 0x73, 'f5': 0x74, 'f6': 0x75,
    'f7': 0x76, 'f8': 0x77, 'f9': 0x78, 'f10': 0x79, 'f11': 0x7A, 'f12': 0x7B,
    '+': 0xBB, '-': 0xBD, ',': 0xBC, '.': 0xBE, '/': 0xBF, '`': 0xC0,
    '[': 0xDB, '\\': 0xDC, ']': 0xDD, "'": 0xDE,
}


def _send(*inputs):
    arr = (INPUT * len(inputs))(*inputs)
    user32.SendInput(len(inputs), arr, ctypes.sizeof(INPUT))


def _key_input(vk, up=False, unicode_char=None):
    if unicode_char is not None:
        ki = KEYBDINPUT(0, ord(unicode_char), KEYEVENTF_UNICODE | (KEYEVENTF_KEYUP if up else 0), 0, None)
    else:
        ki = KEYBDINPUT(vk, 0, KEYEVENTF_KEYUP if up else 0, 0, None)
    return INPUT(INPUT_KEYBOARD, INPUT._U(ki=ki))


def list_windows():
    out = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, w.HWND, w.LPARAM)
    def cb(hwnd, _):
        if not user32.IsWindowVisible(hwnd):
            return True
        length = user32.GetWindowTextLengthW(hwnd)
        if length == 0:
            return True
        buf = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buf, length + 1)
        cls = ctypes.create_unicode_buffer(256)
        user32.GetClassNameW(hwnd, cls, 256)
        r = RECT()
        user32.GetWindowRect(hwnd, ctypes.byref(r))
        out.append({'hwnd': hwnd, 'title': buf.value, 'class': cls.value,
                    'rect': [r.left, r.top, r.right, r.bottom],
                    'size': [r.right - r.left, r.bottom - r.top]})
        return True

    user32.EnumWindows(cb, 0)
    return out


def find(title_substr):
    hits = [x for x in list_windows() if title_substr.lower() in x['title'].lower()]
    if not hits:
        raise SystemExit(f'没找到标题含「{title_substr}」的窗口')
    # 标题完整的优先（避免 "Termius - Hosts" 被同名的后台窗口顶掉）
    hits.sort(key=lambda x: (x['title'].lower() != title_substr.lower(), x['size'][0] * x['size'][1]))
    return hits[0]


def focus(hwnd):
    user32.ShowWindow(hwnd, SW_RESTORE)
    # 轻敲 ALT：系统认为「用户刚动过键盘」，才允许抢前台
    user32.keybd_event(0x12, 0, 0, 0)
    user32.keybd_event(0x12, 0, KEYEVENTF_KEYUP, 0)
    ok = user32.SetForegroundWindow(hwnd)
    time.sleep(0.35)
    return bool(ok) or user32.GetForegroundWindow() == hwnd


def click(x, y, double=False):
    user32.SetCursorPos(int(x), int(y))
    time.sleep(0.08)
    for _ in range(2 if double else 1):
        user32.mouse_event(MOUSEEVENTF['left_down'], 0, 0, 0, 0)
        user32.mouse_event(MOUSEEVENTF['left_up'], 0, 0, 0, 0)
        time.sleep(0.09)
    time.sleep(0.25)


def move(x, y):
    user32.SetCursorPos(int(x), int(y))
    time.sleep(0.05)


def scroll(x, y, delta):
    user32.SetCursorPos(int(x), int(y))
    time.sleep(0.08)
    user32.mouse_event(MOUSEEVENTF['wheel'], 0, 0, ctypes.c_long(int(delta)).value, 0)
    time.sleep(0.2)


def press(combo):
    parts = [p.strip().lower() for p in combo.replace(' ', '').split('+')]
    mods, main = parts[:-1], parts[-1]
    mod_vks = [VK[m] for m in mods]
    for vk in mod_vks:
        _send(_key_input(vk))
    time.sleep(0.03)
    if main in VK:
        _send(_key_input(VK[main]), _key_input(VK[main], up=True))
    elif len(main) == 1 and main.isalnum():
        # 字母数字必须走虚拟键码：KEYEVENTF_UNICODE 注入的字符 VK=0，
        # 应用（Electron/浏览器）读 keydown 的 ctrlKey+VK 判断组合键，会认不出来
        code = ord(main.upper())
        _send(_key_input(code), _key_input(code, up=True))
    else:  # 其它单字符
        for ch in main:
            _send(_key_input(0, unicode_char=ch), _key_input(0, up=True, unicode_char=ch))
    time.sleep(0.04)
    for vk in reversed(mod_vks):
        _send(_key_input(vk, up=True))
    time.sleep(0.2)


def type_text(text):
    for ch in text:
        _send(_key_input(0, unicode_char=ch), _key_input(0, up=True, unicode_char=ch))
        time.sleep(0.012)
    time.sleep(0.2)


if __name__ == '__main__':
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(1)
    cmd = args[0]
    if cmd == 'wins':
        for x in sorted(list_windows(), key=lambda i: -i['size'][0] * i['size'][1])[:40]:
            print(f"{x['hwnd']:>10}  {x['size'][0]:>5}x{x['size'][1]:<5} @{x['rect'][0]},{x['rect'][1]:<6} {x['title'][:70]}")
    elif cmd == 'rect':
        win = find(args[1])
        print(json.dumps(win, ensure_ascii=False))
    elif cmd == 'focus':
        win = find(args[1])
        print(json.dumps({'focused': focus(win['hwnd']), **win}, ensure_ascii=False))
    elif cmd == 'click':
        win = find(args[3]) if len(args) > 3 else None
        base = win['rect'][:2] if win else (0, 0)
        click(base[0] + int(args[1]), base[1] + int(args[2]), double=(len(args) > 4 and args[4] == 'double'))
        print(f'clicked at {base[0] + int(args[1])},{base[1] + int(args[2])}')
    elif cmd == 'move':
        win = find(args[3]) if len(args) > 3 else None
        base = win['rect'][:2] if win else (0, 0)
        move(base[0] + int(args[1]), base[1] + int(args[2]))
        print('moved')
    elif cmd == 'scroll':
        win = find(args[4]) if len(args) > 4 else None
        base = win['rect'][:2] if win else (0, 0)
        scroll(base[0] + int(args[1]), base[1] + int(args[2]), int(args[3]))
        print('scrolled')
    elif cmd == 'dialogs':
        # 只列 Win32 标准对话框（class #32770）：文件打开/保存框、"另存为"都是它。
        # Chromium 自己的窗口用 Chrome_WidgetWin_1，所以这个筛选同时也就是
        # 「这是操作系统的框、而不是页面的一部分」的判据。
        for x in list_windows():
            if x['class'] == '#32770':
                print(json.dumps({'hwnd': x['hwnd'], 'title': x['title'],
                                  'rect': x['rect']}, ensure_ascii=False))
    elif cmd == 'screen':
        # 物理像素（本进程已声明 DPI aware，所以不是虚拟化后的逻辑尺寸）。
        # 整屏截图要按这个尺寸抓才是 1:1，否则 desktopCapturer 会缩放。
        print(json.dumps({'w': user32.GetSystemMetrics(0), 'h': user32.GetSystemMetrics(1)},
                         ensure_ascii=False))
    elif cmd == 'key':
        press(args[1])
        print(f'pressed {args[1]}')
    elif cmd == 'type':
        type_text(args[1])
        print('typed')
    else:
        print(__doc__)
        sys.exit(1)
