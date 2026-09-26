"""Cataloga imagens locais no fluxo rastreável do dataset.

Exemplo:
    python add_to_dataset.py foto1.jpg limpo foto2.jpg sujo \
        --license "Imagens próprias" --author "Nome" --reviewed

O comando não altera silenciosamente ``res.csv``. Depois da revisão, execute
``python -m scripts.prepare_dataset`` e ``python train_model.py``.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from water_clarity.ml.features import validate_image_bytes
from water_clarity.settings import PROJECT_ROOT

METADATA_PATH = PROJECT_ROOT / "data" / "metadata" / "images.csv"
FIELDS = (
    "file", "class", "source_url", "source_page", "license", "author",
    "acquired_at", "sha256", "group_id", "review_status", "notes",
)


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("items", nargs="+", help="Pares: caminho_da_imagem rótulo")
    parser.add_argument("--source-url", default="", help="URL de origem, quando aplicável")
    parser.add_argument("--license", required=True, help="Licença ou autorização de uso")
    parser.add_argument("--author", required=True, help="Autor ou fonte responsável")
    parser.add_argument("--group", default="local", help="Sessão/lote usado para evitar leakage")
    parser.add_argument("--notes", default="", help="Observações de coleta e enquadramento")
    parser.add_argument(
        "--reviewed",
        action="store_true",
        help="Confirma que conteúdo e rótulo foram revisados visualmente",
    )
    args = parser.parse_args(argv)
    if len(args.items) % 2:
        parser.error("Informe pares completos: caminho rótulo.")
    return args


def _metadata_rows():
    if not METADATA_PATH.exists():
        return []
    with METADATA_PATH.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def _atomic_write_metadata(rows):
    METADATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix="images-", suffix=".csv", dir=METADATA_PATH.parent)
    os.close(descriptor)
    temporary = Path(name)
    try:
        with temporary.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=FIELDS)
            writer.writeheader()
            writer.writerows(rows)
        temporary.replace(METADATA_PATH)
    finally:
        temporary.unlink(missing_ok=True)


def main(argv=None) -> int:
    args = parse_args(argv)
    rows = _metadata_rows()
    known_hashes = {row["sha256"] for row in rows}
    now = datetime.now(timezone.utc).isoformat()

    for index in range(0, len(args.items), 2):
        source = Path(args.items[index]).expanduser().resolve()
        label = args.items[index + 1].strip().lower()
        if label not in {"limpo", "sujo"}:
            raise SystemExit(f"Rótulo inválido: {label!r}. Use somente 'limpo' ou 'sujo'.")
        payload = source.read_bytes()
        image, info = validate_image_bytes(payload, filename=source.name, declared_mime=None)
        image.close()
        digest = hashlib.sha256(payload).hexdigest()
        if digest in known_hashes:
            print(f"Ignorada por hash duplicado: {source}")
            continue

        suffix = ".jpg" if info.format == "JPEG" else f".{info.format.lower()}"
        stem = re.sub(r"[^a-z0-9-]+", "-", source.stem.lower()).strip("-") or "foto"
        relative = Path("data") / "raw" / "proprias" / label / f"{stem}{suffix}"
        if (PROJECT_ROOT / relative).exists():
            relative = relative.with_name(f"{stem}-{digest[:8]}{suffix}")
        destination = PROJECT_ROOT / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(payload)
        rows.append(
            {
                "file": relative.as_posix(),
                "class": label,
                "source_url": args.source_url,
                "source_page": args.source_url or "local://user-provided",
                "license": args.license,
                "author": args.author,
                "acquired_at": now,
                "sha256": digest,
                "group_id": args.group,
                "review_status": "approved" if args.reviewed else "pending",
                "notes": args.notes or "Imagem local catalogada pelo utilitário do projeto.",
            }
        )
        known_hashes.add(digest)
        print(f"Catalogada: {source.name} -> {relative} ({label}, {info.width}x{info.height})")

    _atomic_write_metadata(rows)
    print("Manifesto atualizado. Para reconstruir: python -m scripts.prepare_dataset")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
