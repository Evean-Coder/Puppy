# -*- coding: utf-8 -*-
"""从「微课脚本.xlsx」生成 storyboard.py（只读，不改原表）。

表结构：A 序号 | B 对应PPT页 | C 画面及文字 | D 设计意图 | E 字幕（旁白） | F 时长(s) | G 备注
第 35 行之后是【附录】控时表，遇到即停。
"""
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

XLSX = Path("C:/Users/Yifan/Desktop/微课脚本-那只放弃挣扎的狗.xlsx")
OUT = Path(__file__).with_name("storyboard.py")
NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def read_rows(path):
    z = zipfile.ZipFile(path)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        r = ET.fromstring(z.read("xl/sharedStrings.xml"))
        shared = ["".join(t.text or "" for t in si.iter() if t.tag.endswith("}t")) for si in r]
    r = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
    rows = []
    for row in r.iter():
        if not row.tag.endswith("}row"):
            continue
        cells = {}
        for c in row:
            if not c.tag.endswith("}c"):
                continue
            col = re.match(r"([A-Z]+)", c.get("r", "")).group(1)
            t = c.get("t")
            v = c.find("s:v", NS)
            node = c.find("s:is", NS)
            if t == "s" and v is not None:
                val = shared[int(v.text)]
            elif t == "inlineStr" and node is not None:
                val = "".join(x.text or "" for x in node.iter() if x.tag.endswith("}t"))
            else:
                val = v.text if v is not None else ""
            cells[col] = (val or "").strip()
        rows.append(cells)
    return rows


# 以「（」开头的都是制作批注（无旁白 / 画面口播出题…），不是要念的旁白
SILENT = ("（", "无旁白")


def main():
    rows = read_rows(XLSX)
    items = []
    for cells in rows:
        a, b, e = cells.get("A", ""), cells.get("B", ""), cells.get("E", "")
        if "附录" in a or "附录" in b:
            break
        m = re.fullmatch(r"P(\d+)", b or "")
        if not m or not re.fullmatch(r"\d+", a or ""):
            continue
        dur = cells.get("F", "0")
        try:
            dur = float(re.sub(r"[^\d.]", "", dur) or 0)
        except ValueError:
            dur = 0.0
        silent = any(e.startswith(s) for s in SILENT) or not e
        items.append({
            "no": int(a),
            "page": f"P{m.group(1)}",
            "slide": f"slide-{int(a):02d}.png",
            "text": "" if silent else e,
            "dur": dur,
            "note": cells.get("G", ""),
        })

    assert len(items) == 35, f"解析到 {len(items)} 行，预期 35"
    assert abs(sum(i["dur"] for i in items) - 600) < 1, sum(i["dur"] for i in items)

    with open(OUT, "w", encoding="utf-8") as f:
        f.write("# -*- coding: utf-8 -*-\n")
        f.write('"""由「微课脚本.xlsx」自动生成，请勿手改。第 N 行 -> slide-NN.png。"""\n\n')
        f.write("VOICE = 'zh-CN-YunxiNeural'\nRATE = '-4%'\nVOLUME = '+0%'\n")
        f.write("LEAD_IN = 0.5\nTAIL = 0.6\n\nSLIDES = [\n")
        for i in items:
            f.write("    %r,\n" % (i,))
        f.write("]\n")
    total = sum(i["dur"] for i in items)
    print(f"OK {len(items)} 条 · 脚本总时长 {total:.0f}s · 静默页 {sum(1 for i in items if not i['text'])}")
    for i in items[:4]:
        print(f"  {i['no']:>2} {i['page']:<5} {i['slide']}  {i['dur']:>4.0f}s  {i['text'][:26]}")


if __name__ == "__main__":
    main()
