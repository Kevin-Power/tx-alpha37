#!/usr/bin/env python3
"""Unix 版期交所 30 日逐筆抓取（PowerShell 對照：scripts/fetch-taifex-30d.ps1）。

直鏈：
  https://www.taifex.com.tw/file/taifex/Dailydownload/DailydownloadCSV/Daily_YYYY_MM_DD.zip

寫入 data/taifex-30d/（gitignore）：
  Daily_YYYY_MM_DD.zip  原始（單人單機、不得散布）
  tx_YYYY_MM_DD.csv     TX 瘦檔，給 scripts/h01-real1m.ts 聚合

不重寫 data/tx-1min.json。聚合請跑 npx --yes tsx scripts/h01-real1m.ts。
"""
from __future__ import annotations

import datetime as dt
import zipfile
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
DIR = ROOT / "data" / "taifex-30d"
BASE = "https://www.taifex.com.tw/file/taifex/Dailydownload/DailydownloadCSV/Daily_{tag}.zip"
UA = (
    "Mozilla/5.0 (compatible; tx-alpha37-research/1.0; "
    "+https://github.com/Kevin-Power/tx-alpha37)"
)


def download_one(tag: str) -> Path | None:
    url = BASE.format(tag=tag)
    dest = DIR / f"Daily_{tag}.zip"
    if dest.exists() and dest.stat().st_size > 100_000:
        return dest
    req = Request(url, headers={"User-Agent": UA})
    try:
        with urlopen(req, timeout=90) as r:
            data = r.read()
    except Exception as e:
        print(f"skip {tag}: {e}")
        return None
    if data[:2] != b"PK":
        return None
    dest.write_bytes(data)
    print(f"GET {tag} {len(data)}")
    return dest


def slim_zip(zpath: Path) -> None:
    tag = zpath.stem.replace("Daily_", "")
    slim = DIR / f"tx_{tag}.csv"
    if slim.exists() and slim.stat().st_size > 0:
        return
    with zipfile.ZipFile(zpath) as z:
        name = z.namelist()[0]
        raw = z.read(name)
    text = raw.decode("cp950", errors="replace")
    out = []
    for ln in text.splitlines():
        parts = ln.split(",")
        if len(parts) < 2:
            continue
        if parts[1].strip() == "TX":
            out.append(ln)
    slim.write_text("\n".join(out) + "\n", encoding="latin-1", errors="replace")
    print(f"slim {slim.name} {len(out)} lines")


def main() -> None:
    DIR.mkdir(parents=True, exist_ok=True)
    today = dt.date.today()
    n_ok = 0
    for k in range(0, 50):
        d = today - dt.timedelta(days=k)
        tag = d.strftime("%Y_%m_%d")
        z = download_one(tag)
        if z:
            slim_zip(z)
            n_ok += 1
    print(f"zips+slim ready: {n_ok}")


if __name__ == "__main__":
    main()
