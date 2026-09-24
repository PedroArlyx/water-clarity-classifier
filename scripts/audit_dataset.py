"""Audita hashes, dimensões e near-duplicates das imagens catalogadas."""

from __future__ import annotations

import csv
import json
from itertools import combinations

import numpy as np
from PIL import Image

from water_clarity.settings import PROJECT_ROOT

METADATA_PATH = PROJECT_ROOT / "data" / "metadata" / "images.csv"
REPORT_DIR = PROJECT_ROOT / "data" / "reports"


def difference_hash(path) -> int:
    with Image.open(path) as source:
        image = source.convert("L").resize((9, 8), Image.Resampling.LANCZOS)
    values = np.asarray(image)
    bits = values[:, 1:] > values[:, :-1]
    result = 0
    for bit in bits.ravel():
        result = (result << 1) | int(bit)
    return result


def main() -> int:
    with METADATA_PATH.open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    approved = [row for row in rows if row["review_status"] == "approved"]
    hashes = {}
    details = []
    for row in approved:
        path = PROJECT_ROOT / row["file"]
        with Image.open(path) as image:
            width, height = image.size
            image_format = image.format
        hashes[row["file"]] = difference_hash(path)
        details.append(
            {
                "file": row["file"],
                "class": row["class"],
                "width": width,
                "height": height,
                "format": image_format,
                "sha256": row["sha256"],
                "group_id": row["group_id"],
            }
        )

    near_duplicates = []
    for first, second in combinations(approved, 2):
        distance = (hashes[first["file"]] ^ hashes[second["file"]]).bit_count()
        if distance <= 8:
            near_duplicates.append(
                {
                    "file_a": first["file"],
                    "file_b": second["file"],
                    "hamming_distance": distance,
                    "same_group": first["group_id"] == second["group_id"],
                    "review_action": "revisar antes de validação agrupada",
                }
            )

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    with (REPORT_DIR / "approved_images.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=details[0].keys())
        writer.writeheader()
        writer.writerows(details)
    fields = ("file_a", "file_b", "hamming_distance", "same_group", "review_action")
    with (REPORT_DIR / "near_duplicates.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(near_duplicates)
    summary = {
        "cataloged": len(rows),
        "approved": len(approved),
        "rejected": sum(row["review_status"] == "rejected" for row in rows),
        "pending": sum(row["review_status"] == "pending" for row in rows),
        "exact_duplicate_hashes": len(approved) - len({row["sha256"] for row in approved}),
        "near_duplicate_pairs_threshold_8": len(near_duplicates),
        "scope_limitation": "As 50 amostras legadas não possuem arquivos brutos para auditoria perceptual.",
    }
    (REPORT_DIR / "audit_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

