#!/usr/bin/env python3
"""인벤토리 로더 — ingredients 폴더의 JSON 파일을 읽어 카테고리별로 정렬 출력.

사용법:
    python3 inventory.py                       # 기본 경로 사용
    python3 inventory.py /path/to/ingredients  # 명시 경로
    python3 inventory.py --json                # 원본 JSON 배열로 출력
"""
from __future__ import annotations

import json
import sys
from datetime import date, datetime
from pathlib import Path

DEFAULT_PATHS = [
    Path("week-4/레시피앱/ingredients"),
    Path("레시피앱/ingredients"),
    Path("ingredients"),
]


def find_ingredients_dir(arg: str | None) -> Path:
    if arg:
        p = Path(arg)
        if p.is_dir():
            return p
        sys.exit(f"❌ 경로를 찾을 수 없습니다: {arg}")
    for candidate in DEFAULT_PATHS:
        if candidate.is_dir():
            return candidate
    sys.exit(
        "❌ 기본 경로에서 ingredients 폴더를 찾을 수 없습니다.\n"
        f"   탐색 경로: {[str(p) for p in DEFAULT_PATHS]}\n"
        "   경로를 인자로 넘겨주세요."
    )


def load_items(folder: Path) -> list[dict]:
    items = []
    for f in sorted(folder.glob("*.json")):
        try:
            with f.open(encoding="utf-8") as fp:
                items.append(json.load(fp))
        except (json.JSONDecodeError, OSError) as e:
            print(f"⚠️  {f.name} 읽기 실패: {e}", file=sys.stderr)
    return items


def days_until(expiry: str, today: date) -> int:
    try:
        d = datetime.strptime(expiry, "%Y-%m-%d").date()
        return (d - today).days
    except ValueError:
        return 9999


def urgency_label(days: int) -> str:
    if days < 0:
        return f"❌ 만료({-days}일 지남)"
    if days <= 3:
        return f"🔴 D-{days} 매우 임박"
    if days <= 7:
        return f"🟡 D-{days} 임박"
    if days <= 30:
        return f"🟢 D-{days}"
    return f"⚪ D-{days}"


def storage_label(storage: str) -> str:
    return {"냉장": "🧊 냉장", "냉동": "❄️ 냉동", "실온": "🌡 실온"}.get(storage, storage or "기타")


def print_text(items: list[dict], today: date) -> None:
    if not items:
        print("(인벤토리가 비어 있습니다)")
        return

    print(f"📋 인벤토리 ({len(items)}개 항목)  |  기준일: {today.isoformat()}\n")

    soon = sorted(
        (it for it in items if days_until(it.get("expiryDate", ""), today) <= 7),
        key=lambda x: days_until(x.get("expiryDate", ""), today),
    )
    if soon:
        print("⚠️  유통기한 임박 (7일 이내):")
        for it in soon:
            d = days_until(it["expiryDate"], today)
            print(
                f"   {it.get('emoji', '·')} {it['name']} — {urgency_label(d)} "
                f"({it['quantity']}{it['unit']}, {storage_label(it.get('storage', ''))})"
            )
        print()

    by_storage: dict[str, list[dict]] = {}
    for it in items:
        by_storage.setdefault(it.get("storage", "기타"), []).append(it)

    for storage in ["냉장", "냉동", "실온", "기타"]:
        if storage not in by_storage:
            continue
        print(f"━━ {storage_label(storage)} ({len(by_storage[storage])}개) ━━")
        by_cat: dict[str, list[dict]] = {}
        for it in by_storage[storage]:
            by_cat.setdefault(it.get("category", "기타"), []).append(it)
        for cat in sorted(by_cat):
            print(f"  · {cat}")
            for it in sorted(by_cat[cat], key=lambda x: x["name"]):
                d = days_until(it.get("expiryDate", ""), today)
                print(
                    f"    {it.get('emoji', '·')} {it['name']:<14} "
                    f"{it['quantity']}{it['unit']:<3}  {urgency_label(d)}"
                )
        print()


def print_json(items: list[dict], today: date) -> None:
    enriched = []
    for it in items:
        d = days_until(it.get("expiryDate", ""), today)
        enriched.append({**it, "daysUntilExpiry": d})
    enriched.sort(key=lambda x: x["daysUntilExpiry"])
    print(json.dumps(enriched, ensure_ascii=False, indent=2))


def main() -> None:
    args = sys.argv[1:]
    as_json = "--json" in args
    args = [a for a in args if a != "--json"]
    folder_arg = args[0] if args else None

    folder = find_ingredients_dir(folder_arg)
    items = load_items(folder)
    today = date.today()

    if as_json:
        print_json(items, today)
    else:
        print(f"📂 {folder}")
        print_text(items, today)


if __name__ == "__main__":
    main()
