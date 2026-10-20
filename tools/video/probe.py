# -*- coding: utf-8 -*-
"""只合成、不渲染：量出每页旁白的真实时长，与脚本标注时长对比。

用于决定 10:00 全片怎么排——语音富余则把差额变成停顿，语音超出则要压语速。
"""
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import build as B
import storyboard as SB


async def main():
    for d in ("tts", "wav"):
        (B.WORK / d).mkdir(parents=True, exist_ok=True)
    sem = asyncio.Semaphore(4)
    texts = [s for it in SB.SLIDES for s in (B.sentences(it["text"]) if it["text"] else [])]
    print(f"待合成 {len(texts)} 句", flush=True)
    await asyncio.gather(*[B.tts(t, sem) for t in texts])

    rows = []
    total_voice = 0.0
    for it in SB.SLIDES:
        sents = B.sentences(it["text"]) if it["text"] else []
        d = 0.0
        for s in sents:
            d += B.to_wav(B.WORK / "tts" / f"{B.key_of(s)}.mp3", B.WORK / "wav" / f"{B.key_of(s)}.wav")
        d += 0.16 * max(0, len(sents) - 1)
        total_voice += d
        rows.append({"no": it["no"], "page": it["page"], "budget": it["dur"],
                     "voice": round(d, 2), "diff": round(it["dur"] - d, 2)})

    json.dump(rows, open(B.WORK / "probe.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    over = [r for r in rows if r["diff"] < 0]
    print(f"\n语音合计 {total_voice:.1f}s / 脚本预算 600s（富余 {600 - total_voice:.1f}s）")
    print(f"超预算的页：{len(over)}")
    for r in over:
        print(f"  镜头{r['no']:>2} {r['page']:<5} 预算{r['budget']:>5.0f}s 实际{r['voice']:>6.1f}s 超{-r['diff']:>5.1f}s")


asyncio.run(main())
