"""Gera o dataset tabular a partir da base preservada e das imagens aprovadas."""

from __future__ import annotations

import csv
import hashlib
import os
import tempfile
from pathlib import Path

import numpy as np
import pandas as pd
from PIL import Image

from water_clarity.ml.features import HISTOGRAM_FEATURES
from water_clarity.settings import PROJECT_ROOT

BASE_DATASET = PROJECT_ROOT / "res.csv.bak"
OUTPUT_DATASET = PROJECT_ROOT / "res.csv"
METADATA_PATH = PROJECT_ROOT / "data" / "metadata" / "images.csv"
REPORT_PATH = PROJECT_ROOT / "data" / "reports" / "dataset_summary.csv"


def raw_histogram(path: Path) -> dict[str, int]:
    with Image.open(path) as source:
        image = source.convert("RGB")
        array = np.asarray(image)
    row: dict[str, int] = {}
    for channel_index, channel in enumerate(("r", "g", "b")):
        counts = np.bincount(array[:, :, channel_index].ravel(), minlength=256)
        row.update({f"{channel}{index}": int(value) for index, value in enumerate(counts)})
    return row


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _atomic_csv(frame: pd.DataFrame, destination: Path) -> None:
    descriptor, name = tempfile.mkstemp(prefix=f"{destination.stem}-", suffix=".csv", dir=destination.parent)
    os.close(descriptor)
    temporary = Path(name)
    try:
        frame.to_csv(temporary, index=False)
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


def main() -> int:
    if not BASE_DATASET.exists():
        raise FileNotFoundError(f"Base preservada não encontrada: {BASE_DATASET}")
    base = pd.read_csv(BASE_DATASET)
    if list(base.columns[:-1]) != list(HISTOGRAM_FEATURES):
        raise ValueError("O schema do dataset legado não corresponde aos 768 bins RGB.")

    rows = []
    approved = []
    with METADATA_PATH.open(encoding="utf-8", newline="") as handle:
        for record in csv.DictReader(handle):
            if record["review_status"] != "approved":
                continue
            path = PROJECT_ROOT / record["file"]
            if not path.exists():
                raise FileNotFoundError(f"Imagem aprovada ausente: {record['file']}")
            if sha256(path) != record["sha256"]:
                raise ValueError(f"Hash divergente: {record['file']}")
            row = raw_histogram(path)
            row["class"] = record["class"]
            rows.append(row)
            approved.append(record)

    combined = pd.concat([base, pd.DataFrame(rows)], ignore_index=True)
    if combined[list(HISTOGRAM_FEATURES)].duplicated().any():
        raise ValueError("Foram detectadas imagens com histogramas RGB idênticos.")
    _atomic_csv(combined, OUTPUT_DATASET)

    summary = combined["class"].value_counts().rename_axis("class").reset_index(name="count")
    summary["dataset_sha256"] = sha256(OUTPUT_DATASET)
    summary["approved_external_or_local_images"] = len(approved)
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    _atomic_csv(summary, REPORT_PATH)
    print(f"Dataset preparado: {len(combined)} amostras")
    print(combined["class"].value_counts().to_string())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
