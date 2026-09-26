"""Baixa candidatos rastreáveis do Wikimedia Commons para revisão humana.

As imagens entram como ``pending`` e NÃO são adicionadas automaticamente ao
dataset de treinamento. Revise conteúdo e rótulo antes de trocar o status para
``approved`` em ``data/metadata/images.csv``.
"""

from __future__ import annotations

import csv
import hashlib
import html
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from water_clarity.settings import PROJECT_ROOT

API = "https://commons.wikimedia.org/w/api.php"
USER_AGENT = "WaterClarityAcademicResearch/1.0 (educational project)"
METADATA_PATH = PROJECT_ROOT / "data" / "metadata" / "images.csv"

# Lista curada por título. Proposta de rótulo não substitui revisão visual.
CANDIDATES = {
    "limpo": [
        "File:A cold glass of water - GE Refrigerator - August 7, 2007.jpg",
        "File:Glass-of-water.jpg",
        "File:Glass of water, detail.jpg",
        "File:Glass of water on vintage sheet.jpg",
        "File:Glass of water ouside.jpg",
        "File:Glass of water ouside 2.jpg",
        "File:Clear glass with water dews.jpg",
        "File:Fasting 4-Fasting-a-glass-of-water-on-an-empty-plate.jpg",
        "File:Water pouring from a faucet into a clear glass cup. (15054813052).jpg",
        "File:Water splashing out of a full clear, glass cup. (15055172195).jpg",
    ],
    "sujo": [
        "File:2008-09-20 Dirty water spilling from a bottle.jpg",
        "File:Murky water, checking turbidity. (4606483974).jpg",
        "File:Greywater treatment.jpg",
    ],
}

FIELDS = (
    "file",
    "class",
    "source_url",
    "source_page",
    "license",
    "author",
    "acquired_at",
    "sha256",
    "group_id",
    "review_status",
    "notes",
)


def _plain(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", html.unescape(value))).strip()


def _open(request: urllib.request.Request, *, timeout: int):
    for attempt in range(4):
        try:
            return urllib.request.urlopen(request, timeout=timeout)
        except urllib.error.HTTPError as exc:
            if exc.code != 429 or attempt == 3:
                raise
            retry_after = int(exc.headers.get("Retry-After", "3"))
            time.sleep(min(max(retry_after, 2), 10))
    raise RuntimeError("Falha inesperada ao consultar o Wikimedia Commons.")


def _query_many(titles: list[str]) -> dict[str, dict]:
    params = {
        "action": "query",
        "titles": "|".join(titles),
        "prop": "imageinfo",
        "iiprop": "url|extmetadata",
        "iiurlwidth": "900",
        "format": "json",
        "origin": "*",
    }
    request = urllib.request.Request(
        f"{API}?{urllib.parse.urlencode(params)}",
        headers={"User-Agent": USER_AGENT},
    )
    with _open(request, timeout=45) as response:
        payload = json.load(response)
    return {page["title"]: page for page in payload["query"]["pages"].values() if "missing" not in page}


def _download(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with _open(request, timeout=60) as response:
        return response.read()


def _existing_rows() -> list[dict[str, str]]:
    if not METADATA_PATH.exists():
        return []
    with METADATA_PATH.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def _save_rows(rows: list[dict[str, str]]) -> None:
    METADATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    with METADATA_PATH.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)


def main() -> int:
    rows = _existing_rows()
    known_pages = {row["source_page"] for row in rows}
    acquired_at = datetime.now(timezone.utc).isoformat()
    all_titles = [title for titles in CANDIDATES.values() for title in titles]
    pages = _query_many(all_titles)

    for proposed_class, titles in CANDIDATES.items():
        destination_dir = PROJECT_ROOT / "data" / "raw" / "commons" / proposed_class
        destination_dir.mkdir(parents=True, exist_ok=True)
        for title in titles:
            page = pages.get(title)
            if page is None:
                print(f"Não encontrado: {title}")
                continue
            info = page["imageinfo"][0]
            source_page = info["descriptionurl"]
            if source_page in known_pages:
                print(f"Já catalogada: {title}")
                continue
            metadata = info.get("extmetadata", {})
            license_name = metadata.get("LicenseShortName", {}).get("value", "unknown")
            if license_name.lower() in {"unknown", "copyright"}:
                print(f"Ignorada por licença não reutilizável: {title}")
                continue
            source_url = info.get("thumburl") or info["url"]
            content = _download(source_url)
            digest = hashlib.sha256(content).hexdigest()
            suffix = Path(urllib.parse.urlparse(source_url).path).suffix.lower() or ".jpg"
            if suffix not in {".jpg", ".jpeg", ".png", ".webp", ".bmp"}:
                suffix = ".jpg"
            relative = Path("data") / "raw" / "commons" / proposed_class / f"commons-{digest[:16]}{suffix}"
            destination = PROJECT_ROOT / relative
            destination.write_bytes(content)
            artist = _plain(metadata.get("Artist", {}).get("value", "Wikimedia Commons contributor"))
            rows.append(
                {
                    "file": relative.as_posix(),
                    "class": proposed_class,
                    "source_url": source_url,
                    "source_page": source_page,
                    "license": license_name,
                    "author": artist,
                    "acquired_at": acquired_at,
                    "sha256": digest,
                    "group_id": f"commons-{page['pageid']}",
                    "review_status": "pending",
                    "notes": f"Candidato: {title}. Rótulo proposto; exige revisão visual.",
                }
            )
            known_pages.add(source_page)
            _save_rows(rows)
            print(f"Baixado para revisão: {relative}")

    _save_rows(rows)
    print(f"Metadados: {METADATA_PATH.relative_to(PROJECT_ROOT)} ({len(rows)} registros)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
