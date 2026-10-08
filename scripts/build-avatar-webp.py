#!/usr/bin/env python3
"""Fetch curated character portraits from AniList and save optimized WebP files.

Only accept characters whose identity AND anime series match the migration catalog.
Missing/ambiguous results are reported, not silently assigned to another character.
"""
import io
import json
import re
import sys
import time
from pathlib import Path

import requests
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
SQL = ROOT / "migrations/0008_avatar_library.sql"
DEST = ROOT / "public/avatars"
PATTERN = re.compile(r"\('([^']+:[^']+)','([^']+)','[^']+','anilist:([^']+)'")
ALIASES = {
    "one-piece": ("one piece",),
    "naruto": ("naruto",),
    "bleach": ("bleach",),
    "attack-on-titan": ("shingeki no kyojin", "attack on titan"),
    "demon-slayer": ("kimetsu no yaiba", "demon slayer"),
    "jujutsu-kaisen": ("jujutsu kaisen",),
    "solo-leveling": ("solo leveling", "ore dake level up"),
    "hunter-x-hunter": ("hunter x hunter", "hunter×hunter"),
    "my-hero-academia": ("boku no hero academia", "my hero academia"),
    "fullmetal-alchemist": ("fullmetal alchemist", "hagane no renkinjutsushi"),
}
SEARCH_VARIANTS = {
    "one-piece:luffy": ["Luffy Monkey"],
    "naruto:hinata": ["Hinata Hyuuga", "Hinata"],
    "bleach:uryu": ["Uryuu Ishida", "Uryuu"],
    "bleach:aizen": ["Sousuke Aizen", "Aizen"],
    "attack-on-titan:levi": ["Levi", "Rivaille"],
    "demon-slayer:tanjiro": ["Tanjirou Kamado", "Tanjirou"],
    "demon-slayer:giyu": ["Giyuu Tomioka", "Giyuu"],
    "demon-slayer:rengoku": ["Kyoujurou Rengoku", "Kyoujurou"],
    "jujutsu-kaisen:yuji": ["Yuuji Itadori", "Yuuji"],
    "jujutsu-kaisen:sukuna": ["Sukuna Ryoumen", "Sukuna"],
    "solo-leveling:jinwoo": ["Jin-Woo Sung", "Jinwoo"],
    "solo-leveling:jinho": ["Jin-Ho Yoo", "Jinho"],
    "hunter-x-hunter:chrollo": ["Kuroro Lucilfer", "Chrollo"],
}
QUERY = """query($name:String) {
  Character(search:$name) {
    id
    name { full alternative }
    image { large medium }
    media(perPage:30) { nodes { title { romaji english native } } }
  }
}"""


def norm(s):
    return re.sub(r"[^a-z0-9]+", "", (s or "").lower())


def canonical_tokens(s):
    # AniList often uses Japanese name order and doubled romanized vowels.
    tokens = re.findall(r"[a-z0-9]+", s.lower())
    return sorted(t.replace("ou", "o").replace("uu", "u") for t in tokens)


def verified_character(character, expected, variants, series):
    names = [character["name"].get("full", "")] + (character["name"].get("alternative") or [])
    expected_tokens = {tuple(canonical_tokens(n)) for n in [expected] + variants}
    if not any(tuple(canonical_tokens(n)) in expected_tokens for n in names):
        raise ValueError(f"name mismatch: {names[:5]}")
    media = [v for m in (character.get("media") or {}).get("nodes", [])
             for v in (m.get("title") or {}).values() if v]
    if not any(norm(alias) in norm(title) for alias in ALIASES[series] for title in media):
        raise ValueError(f"series mismatch: {media[:5]}")
    return character


def main():
    rows = PATTERN.findall(SQL.read_text(encoding="utf-8"))
    if len(rows) != 66 or len({row[0] for row in rows}) != 66:
        raise RuntimeError(f"Expected exactly 66 unique characters, got {len(rows)}")
    session = requests.Session()
    session.headers.update({"User-Agent": "Wany-Avatar-Builder/1.0"})
    report = []
    for index, (avatar_id, series, name) in enumerate(rows, 1):
        key = avatar_id.split(":", 1)[1]
        target = DEST / series / (key + ".webp")
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists() and target.stat().st_size > 1000:
            report.append({"id": avatar_id, "status": "existing"})
            continue
        try:
            character = None
            errors = []
            variants = SEARCH_VARIANTS.get(avatar_id, [])
            for query_name in [name] + variants:
                try:
                    for attempt in range(5):
                        response = session.post(
                            "https://graphql.anilist.co",
                            json={"query": QUERY, "variables": {"name": query_name}},
                            timeout=30,
                        )
                        if response.status_code == 429:
                            wait = int(response.headers.get("Retry-After", "15"))
                            time.sleep(min(max(wait, 15), 75))
                            continue
                        if response.status_code in (500, 502, 503, 504):
                            time.sleep(3 * (attempt + 1))
                            continue
                        if response.status_code == 404:
                            break
                        response.raise_for_status()
                        candidate = response.json().get("data", {}).get("Character")
                        if not candidate:
                            break
                        character = verified_character(candidate, name, variants, series)
                        break
                    if character:
                        break
                    errors.append(f"{query_name}: not found")
                except (ValueError, requests.RequestException) as exc:
                    errors.append(f"{query_name}: {exc}")
                time.sleep(2)
            if not character:
                raise ValueError("; ".join(errors)[:600])
            url = character["image"].get("large") or character["image"].get("medium")
            if not url or not url.startswith("https://"):
                raise ValueError("no trusted portrait URL")
            picture = session.get(url, timeout=30)
            picture.raise_for_status()
            if len(picture.content) > 5_000_000:
                raise ValueError("image too large")
            image = Image.open(io.BytesIO(picture.content)).convert("RGB")
            image = ImageOps.fit(image, (256, 256), method=Image.Resampling.LANCZOS, centering=(0.5, 0.32))
            image.save(target, "WEBP", quality=78, method=6)
            report.append({"id": avatar_id, "status": "ok", "bytes": target.stat().st_size})
            print(f"[{index}/66] OK {avatar_id}", flush=True)
        except Exception as exc:
            report.append({"id": avatar_id, "status": "failed", "reason": str(exc)})
            print(f"[{index}/66] FAILED {avatar_id}: {exc}", flush=True)
        time.sleep(2.1)
    DEST.mkdir(parents=True, exist_ok=True)
    (DEST / "manifest.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    local_ids = [item["id"] for item in report if item["status"] in ("ok", "existing")]
    generated = (
        "// Auto-generated by scripts/build-avatar-webp.py. Do not edit manually.\n"
        + "const LOCAL_AVATAR_IDS = new Set("
        + json.dumps(local_ids, ensure_ascii=False, indent=2)
        + ");\n\n"
        + "export function localAvatarUrl(avatarId) {\n"
        + '  if (typeof avatarId !== "string" || !LOCAL_AVATAR_IDS.has(avatarId)) return null;\n'
        + '  const [series, character] = avatarId.split(":");\n'
        + '  return "/avatars/" + series + "/" + character + ".webp";\n'
        + "}\n"
    )
    (ROOT / "functions/avatar-local-images.js").write_text(generated, encoding="utf-8")
    successful = sum(r["status"] in ("ok", "existing") for r in report)
    print(f"Portraits available: {successful}/66", flush=True)
    return 0 if successful == 66 else 1


if __name__ == "__main__":
    sys.exit(main())
