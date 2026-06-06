#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
無人航空機飛行計画データ（2025年度）を「防災・災害対応ドローン即応リソースマップ」用に集計する。

入力 : data/raw/*.geojson （月次の FeatureCollection、Polygon ジオメトリ）
出力 : data/processed/readiness.json （市区町村別の即応度集計。ジオメトリは破棄し重心点のみ保持）

設計方針（データの癖への対応）:
- フィールド名の表記ゆれ（末尾スペース・異体字・全半角）を NFKC 正規化 + strip で吸収してから参照する。
- 包括申請ノイズ（業務目的フラグが極端に多い行）は用途別分析から除外する。
- 申請（計画）ベースであり実飛行ではない点はメタ情報として明示し、UI 側で注記する。
- 座標は出発地（市区町村重心レベルの秘匿座標）を用い、粒度を上げない。
"""

import json
import os
import sys
import glob
import unicodedata
from collections import defaultdict
from datetime import datetime, timezone

import ijson  # ストリーミング JSON パーサ（巨大ファイルをメモリに載せずに処理する）

RAW_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "raw")
OUT_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "processed", "readiness.json")

# 47都道府県（前方一致で出発地を分解するための正本）。長い名前を先に並べる必要はないが
# 前方一致なので「北海道」等の特殊形も含めて網羅的に列挙する。
PREFECTURES = [
    "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
    "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
    "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県",
    "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県",
    "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県",
    "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県",
    "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
]

# 十勝管内19市町村（北海道）。spec のローカル例として速攻フィルタに使う。
TOKACHI = {
    "帯広市", "音更町", "士幌町", "上士幌町", "鹿追町", "新得町", "清水町",
    "芽室町", "中札内村", "更別村", "大樹町", "広尾町", "幕別町", "池田町",
    "豊頃町", "本別町", "足寄町", "陸別町", "浦幌町",
}

# 業務目的フラグ数がこの値以上の行は「包括申請ノイズ」とみなし用途別集計から除外する。
# 災害対応フラグ付き行のフラグ立ち数分布は flags=8 を谷とする二峰型で、
# 1〜7（個別目的）と 9〜13（ほぼ全項目=包括申請）に分かれる。谷の直後 9 を閾値にする。
COMPREHENSIVE_FLAG_THRESHOLD = 9


def norm_key(k):
    """プロパティキーを正規化（異体字・全半角・末尾空白の吸収）。"""
    return unicodedata.normalize("NFKC", k).strip()


def build_lookup(props):
    """正規化キー -> 値 のマップを作る。"""
    out = {}
    for k, v in props.items():
        out[norm_key(k)] = v
    return out


def to_int(v):
    try:
        if v is None or v == "":
            return 0
        return int(float(v))
    except (ValueError, TypeError):
        return 0


def to_float(v):
    try:
        if v is None or v == "":
            return None
        return float(v)
    except (ValueError, TypeError):
        return None


def split_pref(origin):
    """出発地テキストを (都道府県, 市区町村) に分解。失敗時は (None, origin)。"""
    if not origin:
        return None, None
    origin = unicodedata.normalize("NFKC", origin).strip()
    for pref in PREFECTURES:
        if origin.startswith(pref):
            city = origin[len(pref):].strip()
            return pref, (city or None)
    return None, origin


# 業務目的フラグ（正規化キー）。先頭スペース等は norm_key で吸収済みのキーで列挙。
BIZ_PURPOSE_KEYS = [
    "飛行目的(業務)_空撮", "飛行目的(業務)_報道取材", "飛行目的(業務)_警備",
    "飛行目的(業務)_農林水産業", "飛行目的(業務)_測量", "飛行目的(業務)_環境調査",
    "飛行目的(業務)_設備メンテナンス", "飛行目的(業務)_インフラ点検・保守",
    "飛行目的(業務)_資材管理", "飛行目的(業務)_輸送・宅配", "飛行目的(業務)_自然観測",
    "飛行目的(業務)_事故・災害対応等", "飛行目的(業務)_その他",
]
DISASTER_KEY = "飛行目的(業務)_事故・災害対応等"
NIGHT_KEY = "飛行方法_夜間"
BVLOS_KEY = "飛行方法_目視外"
ORIGIN_KEY = "出発地"
LAT_KEY = "出発地緯度"
LON_KEY = "出発地経度"
DRONE_KIND_KEY = "機体の種類"


def month_label_from_filename(fname):
    """ファイル名 01_1_hikoukeikaku_202407.geojson -> '2024-07'。"""
    base = os.path.basename(fname)
    import re
    m = re.search(r"_(\d{6})(?:_\d)?\.geojson$", base)
    if not m:
        return base
    ym = m.group(1)
    return f"{ym[:4]}-{ym[4:]}"


def main():
    files = sorted(glob.glob(os.path.join(RAW_DIR, "*.geojson")))
    if not files:
        print("ERROR: data/raw に geojson がありません。先に scripts/download.sh を実行してください。",
              file=sys.stderr)
        sys.exit(1)

    # 市区町村キー -> 集計
    muni = {}
    total_plans = 0
    total_disaster = 0
    comprehensive_skipped = 0
    month_disaster = defaultdict(int)
    month_total = defaultdict(int)
    drone_kinds_global = defaultdict(int)

    for fpath in files:
        month = month_label_from_filename(fpath)
        feats_in_file = 0
        # ジオメトリ（巨大な Polygon 座標列）は構築せず、properties だけをストリームで取り出す。
        with open(fpath, "rb") as f:
            for props in ijson.items(f, "features.item.properties"):
                feats_in_file += 1
                total_plans += 1
                month_total[month] += 1
                p = build_lookup(props or {})

                # 包括申請ノイズの判定（業務目的フラグの立ち数）
                flag_count = sum(to_int(p.get(k)) for k in BIZ_PURPOSE_KEYS)
                is_comprehensive = flag_count >= COMPREHENSIVE_FLAG_THRESHOLD

                is_disaster = to_int(p.get(DISASTER_KEY)) == 1
                if not is_disaster:
                    continue
                if is_comprehensive:
                    comprehensive_skipped += 1
                    continue

                total_disaster += 1
                month_disaster[month] += 1

                night = to_int(p.get(NIGHT_KEY)) == 1
                bvlos = to_int(p.get(BVLOS_KEY)) == 1

                pref, city = split_pref(p.get(ORIGIN_KEY))
                lat = to_float(p.get(LAT_KEY))
                lon = to_float(p.get(LON_KEY))
                kind = (p.get(DRONE_KIND_KEY) or "不明").strip() or "不明"
                drone_kinds_global[kind] += 1

                if pref is None and city is None:
                    key = "（出発地不明）"
                else:
                    key = f"{pref or ''}{city or ''}" or "（出発地不明）"

                rec = muni.get(key)
                if rec is None:
                    rec = {
                        "pref": pref,
                        "city": city,
                        "name": key,
                        "tokachi": (pref == "北海道" and city in TOKACHI),
                        "disaster": 0,
                        "night": 0,
                        "bvlos": 0,
                        "full": 0,
                        "_lat_sum": 0.0, "_lon_sum": 0.0, "_pts": 0,
                        "drones": defaultdict(int),
                        "by_month": defaultdict(int),
                    }
                    muni[key] = rec

                rec["disaster"] += 1
                if night:
                    rec["night"] += 1
                if bvlos:
                    rec["bvlos"] += 1
                if night and bvlos:
                    rec["full"] += 1
                rec["drones"][kind] += 1
                rec["by_month"][month] += 1
                if lat is not None and lon is not None and -90 <= lat <= 90 and -180 <= lon <= 180:
                    rec["_lat_sum"] += lat
                    rec["_lon_sum"] += lon
                    rec["_pts"] += 1

        print(f"processed {os.path.basename(fpath)} month={month} feats={feats_in_file}",
              file=sys.stderr)

    # 即応度スコアの確定と整形
    out_munis = []
    for key, rec in muni.items():
        full = rec["full"]
        night_only = rec["night"] - full
        bvlos_only = rec["bvlos"] - full
        basic = rec["disaster"] - full - night_only - bvlos_only
        # 即応度スコア: 夜間×目視外×災害対応の重なりを最重視。
        score = 3 * full + 2 * (night_only + bvlos_only) + 1 * basic
        lat = rec["_lat_sum"] / rec["_pts"] if rec["_pts"] else None
        lon = rec["_lon_sum"] / rec["_pts"] if rec["_pts"] else None
        out_munis.append({
            "name": rec["name"],
            "pref": rec["pref"],
            "city": rec["city"],
            "tokachi": rec["tokachi"],
            "lat": round(lat, 5) if lat is not None else None,
            "lon": round(lon, 5) if lon is not None else None,
            "disaster": rec["disaster"],
            "night": rec["night"],
            "bvlos": rec["bvlos"],
            "full": full,
            "score": score,
            "drones": dict(sorted(rec["drones"].items(), key=lambda x: -x[1])),
            "by_month": dict(sorted(rec["by_month"].items())),
        })

    out_munis.sort(key=lambda m: (-m["score"], -m["disaster"]))

    meta = {
        "generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "国土交通省 Project LINKS『無人航空機飛行計画データ（2025年度）』を加工して作成",
        "source_url": "https://www.geospatial.jp/ckan/dataset/links-mujinkoukuukihikoukeikaku-2025_",
        "license": "公共データ利用規約（第1.0版） / CC BY 4.0 互換",
        "period": "2024-07 〜 2025-06（月次）",
        "files_processed": len(files),
        "total_plans": total_plans,
        "disaster_plans": total_disaster,
        "comprehensive_skipped": comprehensive_skipped,
        "comprehensive_flag_threshold": COMPREHENSIVE_FLAG_THRESHOLD,
        "municipalities_count": len(out_munis),
        "month_total": dict(sorted(month_total.items())),
        "month_disaster": dict(sorted(month_disaster.items())),
        "drone_kinds": dict(sorted(drone_kinds_global.items(), key=lambda x: -x[1])),
        "disclaimer": "本データは飛行計画（申請）ベースであり、実飛行・実出動能力を示すものではありません。"
                      "出典資料はスキャン抽出のため完全性・正確性は保証されません。",
    }

    out = {"meta": meta, "municipalities": out_munis}
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    print(f"\nWROTE {OUT_PATH}", file=sys.stderr)
    print(f"  total_plans={total_plans} disaster_plans={total_disaster} "
          f"comprehensive_skipped={comprehensive_skipped} munis={len(out_munis)}",
          file=sys.stderr)


if __name__ == "__main__":
    main()
