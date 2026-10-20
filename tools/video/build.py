# -*- coding: utf-8 -*-
"""把「分镜脚本 + 幻灯片 + 小柴」合成为 mp4。

数据源：storyboard.py（由 微课脚本.xlsx 生成，35 条镜头对应 35 张幻灯片）
    每页时长先用脚本标注值；若 TTS 比该时长更长，则以 TTS 为准并顺延，
    这样脚本里设计的停顿（如 P8 提问后 2 秒）会原样保留。

用法：
    python build.py --slides 1,10,14 --out sample.mp4
    python build.py --all --out full.mp4
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import math
import re
import subprocess
import sys
import wave
from pathlib import Path

import edge_tts
import imageio_ffmpeg
from PIL import Image, ImageDraw, ImageFont

from dog import render as render_dog
import storyboard as SB

ROOT = Path(__file__).resolve().parents[2]
SLIDES = ROOT / "app" / "public" / "slides"
WORK = ROOT / "tools" / "video" / "work"
OUT = ROOT / "out"
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

W, H, FPS, SR = 1280, 720, 25, 24000
FONT_PATH = "C:/Windows/Fonts/msyhbd.ttc"
FADE = 0.30
BAR_H = 4
BAND_H = 114
DOG_H = 118
DOG_X = 10
TEXT_X = 198

CUE_BG = (36, 26, 21, 226)
CUE_FG = (255, 246, 232, 255)
ACCENT = (244, 162, 60, 255)


# ---------------- 语音 ----------------
def key_of(text: str) -> str:
    return hashlib.md5(f"{SB.VOICE}|{SB.RATE}|{SB.VOLUME}|{text}".encode()).hexdigest()[:16]


async def tts(text: str, sem: asyncio.Semaphore) -> None:
    mp3 = WORK / "tts" / f"{key_of(text)}.mp3"
    if mp3.exists() and mp3.stat().st_size > 1000:
        return
    async with sem:
        for attempt in range(4):
            try:
                c = edge_tts.Communicate(text, SB.VOICE, rate=SB.RATE, volume=SB.VOLUME)
                await c.save(str(mp3))
                if mp3.stat().st_size > 1000:
                    return
            except Exception as e:  # noqa: BLE001
                if attempt == 3:
                    raise RuntimeError(f"TTS 失败 {text[:16]}: {e}") from e
                await asyncio.sleep(1.0 * (attempt + 1))


def to_wav(mp3: Path, wav: Path) -> float:
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", str(mp3),
                    "-ar", str(SR), "-ac", "1", "-acodec", "pcm_s16le", str(wav)], check=True)
    with wave.open(str(wav), "rb") as f:
        return f.getnframes() / f.getframerate()


SENT_SPLIT = re.compile(r"(?<=[。！？；])")


def sentences(text: str) -> list[str]:
    parts = [p.strip() for p in SENT_SPLIT.split(text) if p.strip()]
    # 过短的尾句并入上一句，避免字幕一闪而过
    out: list[str] = []
    for p in parts:
        if out and len(p) <= 6:
            out[-1] += p
        else:
            out.append(p)
    return out


class Cue:
    __slots__ = ("text", "start", "end", "slide")

    def __init__(self, text, start, slide):
        self.text, self.start, self.slide = text, start, slide
        self.end = start


class SlideSlot:
    __slots__ = ("idx", "item", "start", "end")


HEAD = 0.10      # 页首留白
TAIL_MIN = 0.15  # 每页说完至少留这么久
GAP = 0.16       # 句间停顿


def layout(items, exact_total: float | None = None) -> tuple[list[Cue], list[SlideSlot], float]:
    """排时间轴。

    语音时长是硬约束（不能被裁），停顿是可伸缩量：
    给了 exact_total 时，把所有页的富余停顿按同一比例缩放，使总时长精确等于该值，
    因此脚本里「说完停 2 秒」这类设计会原样保留、只是整体微调。
    """
    plan = []
    for it in items:
        sents = sentences(it["text"]) if it["text"] else []
        durs = [to_wav(WORK / "tts" / f"{key_of(s)}.mp3", WORK / "wav" / f"{key_of(s)}.wav") for s in sents]
        voice = sum(durs) + GAP * max(0, len(sents) - 1)
        plan.append((sents, durs, voice))

    fixed = [(HEAD + v + TAIL_MIN) if s else 0.0 for (s, _, v) in plan]
    slack = [max(0.0, it["dur"] - fx) for it, fx in zip(items, fixed)]
    k = 1.0
    if exact_total is not None and sum(slack) > 0:
        need = (exact_total - SB.LEAD_IN) - sum(fixed)
        k = max(0.0, need / sum(slack))

    cues: list[Cue] = []
    slots: list[SlideSlot] = []
    t = SB.LEAD_IN
    for i, (it, (sents, durs, voice)) in enumerate(zip(items, plan)):
        sl = SlideSlot()
        sl.idx, sl.item, sl.start = i, it, t
        cursor = t + (HEAD if sents else 0)
        for s, d in zip(sents, durs):
            c = Cue(s, cursor, i)
            c.end = cursor + d
            cues.append(c)
            cursor = c.end + GAP
        sl.end = t + fixed[i] + slack[i] * k
        if sents and cues[-1].end + 0.05 > sl.end:   # 语音绝不越页
            sl.end = cues[-1].end + 0.05
        slots.append(sl)
        t = sl.end

    if exact_total is not None:
        slots[-1].end = exact_total
        t = slots[-1].end
    return cues, slots, t


def assemble_audio(cues, total: float, out: Path) -> None:
    buf = bytearray(b"\x00\x00" * int(SR * total))
    for c in cues:
        wav = WORK / "wav" / f"{key_of(c.text)}.wav"
        with wave.open(str(wav), "rb") as f:
            frames = f.readframes(f.getnframes())
        off = int(c.start * SR) * 2
        buf[off:off + len(frames)] = frames
    with wave.open(str(out), "wb") as f:
        f.setnchannels(1); f.setsampwidth(2); f.setframerate(SR)
        f.writeframes(bytes(buf))


# ---------------- 画面 ----------------
def font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_PATH, size, index=0)


PUNCT = "，。？！、；：—…"


def wrap(text: str, f, maxw: float) -> list[str]:
    lines, cur = [], ""
    for ch in text:
        if f.getlength(cur + ch) <= maxw or not cur:
            cur += ch
            continue
        cut = -1
        for p in PUNCT:
            i = cur.rfind(p)
            if i > len(cur) * 0.4:
                cut = max(cut, i)
        if cut > 0:
            lines.append(cur[:cut + 1]); cur = cur[cut + 1:] + ch
        else:
            lines.append(cur); cur = ch
    if cur:
        lines.append(cur)
    return lines


def build_band(text: str) -> Image.Image:
    maxw = W - TEXT_X - 28
    for size in (32, 28, 24):
        f = font(size)
        lines = wrap(text, f, maxw)
        if len(lines) <= 2:
            break
    img = Image.new("RGBA", (W, BAND_H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, BAND_H], fill=CUE_BG)
    d.rectangle([0, 0, W, 3], fill=ACCENT)
    lh = int(size * 1.42)
    top = (BAND_H - lh * len(lines)) / 2
    for i, ln in enumerate(lines):
        d.text((TEXT_X, top + i * lh), ln, font=f, fill=CUE_FG)
    return img


def load_slide(name: str) -> Image.Image:
    im = Image.open(SLIDES / name).convert("RGB")
    return im if im.size == (W, H) else im.resize((W, H), Image.LANCZOS)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--slides", default="", help="逗号分隔的镜号，如 1,10,14")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--out", default="sample.mp4")
    ap.add_argument("--seconds", type=float, default=0, help="强制总时长（秒）")
    args = ap.parse_args()

    if args.all:
        items = SB.SLIDES
    else:
        want = [int(x) for x in args.slides.split(",") if x.strip()]
        items = [s for s in SB.SLIDES if s["no"] in want]
    if not items:
        raise SystemExit("没有选中任何镜头")

    for d in ("tts", "wav"):
        (WORK / d).mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    print(f"[1/5] 合成语音 · {SB.VOICE} · {len(items)} 个镜头", flush=True)

    all_text = [s for it in items for s in (sentences(it["text"]) if it["text"] else [])]
    async def run():
        sem = asyncio.Semaphore(4)
        await asyncio.gather(*[tts(t, sem) for t in all_text])
    asyncio.run(run())

    print("[2/5] 排时间轴", flush=True)
    cues, slots, total = layout(items, args.seconds or (600.0 if args.all else None))
    print(f"      视频 {total:.1f}s · 字幕 {len(cues)} 条", flush=True)

    print("[3/5] 拼音轨", flush=True)
    audio = WORK / "master.wav"
    assemble_audio(cues, total, audio)

    print("[4/5] 渲染", flush=True)
    frames_total = int(total * FPS)
    bases = [load_slide(s["slide"]) for s in items]
    bands: dict[str, Image.Image] = {c.text: build_band(c.text) for c in cues}
    band_top = H - BAR_H - BAND_H
    slide_has_cues = {i: any(c.slide == i for c in cues) for i in range(len(items))}
    dog_shadow = Image.new("RGBA", (DOG_H + 30, 20), (0, 0, 0, 0))
    ImageDraw.Draw(dog_shadow).ellipse([0, 0, DOG_H + 30, 20], fill=(62, 44, 40, 45))

    cmd = [FFMPEG, "-y", "-loglevel", "error",
           "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "pipe:0",
           "-i", str(audio),
           "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
           "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-shortest",
           str(OUT / args.out)]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    assert proc.stdin

    si, ci = 0, 0
    try:
        for i in range(frames_total):
            t = i / FPS
            while si + 1 < len(slots) and t >= slots[si + 1].start:
                si += 1
            while ci + 1 < len(cues) and t >= cues[ci + 1].start:
                ci += 1

            frame = bases[si].copy()
            since = t - slots[si].start
            if si > 0 and since < FADE:
                frame = Image.blend(bases[si - 1], bases[si], since / FADE)

            # 只认当前页自己的字幕；否则静默页会残留上一页的字
            cur = cues[ci] if (cues and cues[ci].slide == si) else None
            speaking = bool(cur and cur.start <= t < cur.end - 0.02)
            if cur and t >= cur.start:
                band = bands[cur.text]
                frame.paste(band, (0, band_top), band)
            elif slide_has_cues[si]:
                d = ImageDraw.Draw(frame)
                d.rectangle([0, band_top, W, H - BAR_H], fill=CUE_BG)
                d.rectangle([0, band_top, W, band_top + 3], fill=ACCENT)

            bob = (3.0 if speaking else 1.3) * math.sin(2 * math.pi * t / (0.55 if speaking else 3.8))
            dog = render_dog(t, speaking, DOG_H)
            dog_y = H - BAR_H - DOG_H - 6 + int(round(bob))
            if not slide_has_cues[si]:   # 静默页没有字幕条，给狗落一个影子免得悬空
                frame.paste(dog_shadow, (DOG_X - 15, dog_y + DOG_H - 12), dog_shadow)
            frame.paste(dog, (DOG_X, dog_y), dog)

            d = ImageDraw.Draw(frame)
            d.rectangle([0, H - BAR_H, W, H], fill=(62, 44, 40))
            d.rectangle([0, H - BAR_H, int(W * t / total), H], fill=ACCENT)

            proc.stdin.write(frame.tobytes())
            if i % 200 == 0 or i == frames_total - 1:
                print(f"      帧 {i + 1}/{frames_total}  {(i + 1) * 100 // frames_total}%", flush=True)
    finally:
        proc.stdin.close()
        err = proc.stderr.read().decode("utf-8", "ignore") if proc.stderr else ""
        proc.wait()
        if proc.returncode != 0:
            print("ffmpeg 失败:\n" + err[-2000:], file=sys.stderr)
            raise SystemExit(1)

    srt = OUT / (Path(args.out).stem + ".srt")
    with open(srt, "w", encoding="utf-8") as f:
        for n, c in enumerate(cues, 1):
            f.write(f"{n}\n{ts(c.start)} --> {ts(c.end)}\n{c.text}\n\n")

    print(f"[5/5] 完成 {OUT / args.out}  {total:.1f}s", flush=True)


def ts(s: float) -> str:
    h, r = divmod(s, 3600)
    m, sec = divmod(r, 60)
    return f"{int(h):02d}:{int(m):02d}:{int(sec):02d},{int((sec % 1) * 1000):03d}"


if __name__ == "__main__":
    main()
