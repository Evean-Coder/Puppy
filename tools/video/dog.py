# -*- coding: utf-8 -*-
"""小柴数字人：把 DogAvatar.tsx 的 SVG 用 Pillow 参数化重绘，支持逐帧动画。

坐标系统沿用 SVG 的 200x210，所有绘制按 SS 倍超采样后缩小，得到抗锯齿边缘。
动画参数（眨眼 / 摆耳 / 摇尾 / 说话张嘴 / 上下浮动）全部由时间 t 决定，无内部状态。
"""
from __future__ import annotations

import math
from PIL import Image, ImageDraw

FUR = (238, 154, 68, 255)
FUR_DARK = (224, 138, 53, 255)
CREAM = (255, 246, 232, 255)
INK = (62, 44, 40, 255)
SCARF = (139, 26, 26, 255)
BLUSH = (245, 188, 161, 255)
MUZZLE_SIDE = (253, 237, 216, 255)
GRAY = (138, 115, 104, 255)

SS = 3  # 超采样倍数


def _bez(p0, p1, p2, p3, n=18):
    pts = []
    for i in range(n + 1):
        t = i / n
        mt = 1 - t
        x = mt**3 * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t**3 * p3[0]
        y = mt**3 * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t**3 * p3[1]
        pts.append((x, y))
    return pts


def _quad(p0, p1, p2, n=14):
    pts = []
    for i in range(n + 1):
        t = i / n
        mt = 1 - t
        pts.append((mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0],
                    mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1]))
    return pts


def _rot(pts, deg, origin):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    ox, oy = origin
    return [(ox + (x - ox) * c - (y - oy) * s, oy + (x - ox) * s + (y - oy) * c) for x, y in pts]


def render(t: float, speaking: bool, height: int = 178) -> Image.Image:
    """返回一张高 height 的 RGBA 小柴，背景透明。t 为当前视频时间（秒）。"""
    k = height * SS / 210.0
    W, H = int(round(200 * k)), int(round(210 * k))

    def S(pts):
        return [(x * k, y * k) for x, y in pts]

    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # ---- 动画参数 ----
    tail_ang = (18 if speaking else 12) * math.sin(2 * math.pi * t / (0.5 if speaking else 3.0))
    ear_ang = (5 if speaking else 3.2) * math.sin(2 * math.pi * t / (0.9 if speaking else 4.2))
    # 眨眼：两个不同周期的短闪，避免机械感
    blink = (t % 4.3) < 0.13 or ((t + 2.1) % 6.7) < 0.11
    mouth_open = speaking and (int(t * 6.2) % 2 == 0)

    # ---- 尾巴（画在身体后面）----
    tip = (186, 106)
    e1 = _bez((168, 150), (192, 138), (198, 116), tip)
    e2 = _bez((164, 150), (190, 142), (194, 124), tip)
    poly = _rot(e1 + list(reversed(e2)), tail_ang, (166, 150))
    d.polygon(S(poly), fill=FUR_DARK)
    tip_white = _rot([(182, 112), (192, 104), (194, 114), (186, 118)], tail_ang, (166, 150))
    d.polygon(S(tip_white), fill=CREAM)

    # ---- 身体 ----
    d.ellipse(S(_ellipse(100, 168, 58, 40)), fill=FUR)
    d.ellipse(S(_ellipse(100, 176, 34, 26)), fill=CREAM)

    # ---- 围巾 ----
    scarf_top = _quad((58, 138), (100, 158), (142, 138))
    scarf_bot = _quad((142, 152), (100, 172), (58, 152))
    d.polygon(S(scarf_top + scarf_bot), fill=SCARF)
    d.polygon(S([(96, 158), (104, 158), (108, 186), (92, 186)]), fill=SCARF)

    # ---- 前爪 ----
    d.ellipse(S(_ellipse(72, 198, 14, 9)), fill=CREAM)
    d.ellipse(S(_ellipse(128, 198, 14, 9)), fill=CREAM)

    # ---- 耳朵（画在头后面）----
    ear_l = _rot([(52, 62), (40, 16), (86, 42)], ear_ang, (66, 50))
    inner_l = _rot([(55, 55), (49, 28), (76, 44)], ear_ang, (66, 50))
    ear_r = _rot([(148, 62), (160, 16), (114, 42)], -ear_ang, (134, 50))
    inner_r = _rot([(145, 55), (151, 28), (124, 44)], -ear_ang, (134, 50))
    d.polygon(S(ear_l), fill=FUR)
    d.polygon(S(ear_r), fill=FUR)
    d.polygon(S(inner_l), fill=(247, 217, 176, 255))
    d.polygon(S(inner_r), fill=(247, 217, 176, 255))

    # ---- 头 ----
    d.ellipse(S(_ellipse(100, 88, 54, 54)), fill=FUR)
    d.ellipse(S(_ellipse(100, 106, 34, 26)), fill=CREAM)
    d.ellipse(S(_ellipse(62, 100, 14, 12)), fill=MUZZLE_SIDE)
    d.ellipse(S(_ellipse(138, 100, 14, 12)), fill=MUZZLE_SIDE)

    # ---- 眉毛 ----
    d.ellipse(S(_ellipse(76, 66, 8, 5)), fill=CREAM)
    d.ellipse(S(_ellipse(124, 66, 8, 5)), fill=CREAM)

    # ---- 眼睛 ----
    eye_h = 1.6 if blink else 7.0
    d.ellipse(S(_ellipse(76, 82, 6, eye_h)), fill=INK)
    d.ellipse(S(_ellipse(124, 82, 6, eye_h)), fill=INK)
    if not blink:
        d.ellipse(S(_ellipse(78.5, 79, 2, 2)), fill=CREAM)
        d.ellipse(S(_ellipse(126.5, 79, 2, 2)), fill=CREAM)

    # ---- 腮红 ----
    d.ellipse(S(_ellipse(58, 102, 8, 5)), fill=BLUSH)
    d.ellipse(S(_ellipse(142, 102, 8, 5)), fill=BLUSH)

    # ---- 鼻子 ----
    d.ellipse(S(_ellipse(100, 98, 7.5, 5.5)), fill=INK)
    d.ellipse(S(_ellipse(97.5, 96.5, 1.6, 1.6)), fill=GRAY)

    # ---- 嘴 ----
    if mouth_open:
        d.polygon(S([(88, 108), (100, 122), (112, 108)]), fill=SCARF)
        d.ellipse(S(_ellipse(100, 113, 6, 3.6)), fill=(240, 145, 123, 255))
    else:
        curve = _quad((90, 108), (95, 114), (100, 108)) + _quad((100, 108), (105, 114), (110, 108))
        d.line(S(curve), fill=INK, width=max(2, int(2.6 * k)), joint="curve")

    return img.resize((int(round(W / SS)), int(round(H / SS))), Image.LANCZOS)


def _ellipse(cx, cy, rx, ry):
    """返回 Pillow 的 [(x0,y0),(x1,y1)] 包围盒。"""
    return [(cx - rx, cy - ry), (cx + rx, cy + ry)]
