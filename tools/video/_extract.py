# -*- coding: utf-8 -*-
"""只读抽取 pptx / xlsx 的纯文本（stdlib，不打开 Office，不修改原文件）。"""
import re
import sys
import zipfile
from xml.etree import ElementTree as ET

NS = {
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
}


def pptx_text(path):
    out = []
    with zipfile.ZipFile(path) as z:
        names = [n for n in z.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)]
        names.sort(key=lambda n: int(re.search(r"(\d+)", n.split("/")[-1]).group(1)))
        for n in names:
            idx = int(re.search(r"(\d+)", n.split("/")[-1]).group(1))
            root = ET.fromstring(z.read(n))
            paras = []
            for sp in root.iter():
                if sp.tag.endswith("}p"):
                    txt = "".join(t.text or "" for t in sp.iter() if t.tag.endswith("}t"))
                    if txt.strip():
                        paras.append(txt.strip())
            notes = ""
            nn = f"ppt/notesSlides/notesSlide{idx}.xml"
            if nn in z.namelist():
                nr = ET.fromstring(z.read(nn))
                notes = "\n".join(
                    "".join(t.text or "" for t in p.iter() if t.tag.endswith("}t")).strip()
                    for p in nr.iter() if p.tag.endswith("}p")
                ).strip()
            out.append((idx, paras, notes))
    return out


def xlsx_text(path):
    with zipfile.ZipFile(path) as z:
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            r = ET.fromstring(z.read("xl/sharedStrings.xml"))
            for si in r:
                shared.append("".join(t.text or "" for t in si.iter() if t.tag.endswith("}t")))
        sheets = sorted(n for n in z.namelist() if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", n))
        res = []
        for sh in sheets:
            r = ET.fromstring(z.read(sh))
            rows = []
            for row in r.iter():
                if not row.tag.endswith("}row"):
                    continue
                cells = []
                for c in row:
                    if not c.tag.endswith("}c"):
                        continue
                    t = c.get("t")
                    v = c.find("s:v", NS)
                    isnode = c.find("s:is", NS)
                    if t == "s" and v is not None:
                        val = shared[int(v.text)]
                    elif t == "inlineStr" and isnode is not None:
                        val = "".join(x.text or "" for x in isnode.iter() if x.tag.endswith("}t"))
                    else:
                        val = v.text if v is not None else ""
                    cells.append((c.get("r"), (val or "").replace("\n", " ").strip()))
                if any(v for _, v in cells):
                    rows.append(cells)
            res.append((sh, rows))
        return res


if __name__ == "__main__":
    mode, path = sys.argv[1], sys.argv[2]
    if mode == "pptx":
        for idx, paras, notes in pptx_text(path):
            print(f"\n===== slide {idx} =====")
            print("\n".join(paras))
            if notes:
                print(f"--- 备注 ---\n{notes}")
    else:
        for sh, rows in xlsx_text(path):
            print(f"\n===== {sh} =====")
            for cells in rows:
                print(" | ".join(f"{v}" for _, v in cells))
