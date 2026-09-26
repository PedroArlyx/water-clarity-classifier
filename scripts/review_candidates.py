"""Aplica decisões humanas documentadas aos candidatos de setembro de 2026."""

from __future__ import annotations

import csv
import hashlib
from datetime import datetime, timezone

from water_clarity.settings import PROJECT_ROOT

METADATA_PATH = PROJECT_ROOT / "data" / "metadata" / "images.csv"
FIELDS = (
    "file", "class", "source_url", "source_page", "license", "author",
    "acquired_at", "sha256", "group_id", "review_status", "notes",
)

DECISIONS = {
    "2cfaa76e8e6671f4": ("approved", "Copo com água transparente em dispensador; conteúdo e rótulo revisados."),
    "383b98837cc5156b": ("approved", "Copo transparente com água visualmente clara; conteúdo e rótulo revisados."),
    "44d4bbffd201666a": ("approved", "Copo isolado com água visualmente clara; conteúdo e rótulo revisados."),
    "47f2889f7d97eda9": ("approved", "Detalhe superior de copo com água visualmente clara; revisado."),
    "5068547b1b2abacd": ("rejected", "Rejeitada: mostra vidro/janela molhada, não um copo de água."),
    "73b1743f7e7f14ba": ("approved", "Copo em ambiente interno com água visualmente clara; revisado."),
    "9ff73eb407e42bc3": ("approved", "Torneira enchendo copo com água visualmente clara; revisado."),
    "b1aeb848b1e93126": ("approved", "Copo ao ar livre com água visualmente clara; revisado."),
    "ef5aded3626e303e": ("approved", "Copo em mesa externa com água visualmente clara; revisado."),
    "f6efacd6b9266f7e": ("rejected", "Rejeitada como near-duplicate da imagem commons-b1aeb848b1e93126."),
    "03e33b13ca1ba776": ("approved", "Amostra em recipiente com turbidez e tonalidade marrom evidentes; revisada."),
    "28187cf49023cc33": ("rejected", "Rejeitada: cena de rio/pessoa, domínio distante de copo ou amostra."),
    "4842ef915c474d98": ("rejected", "Rejeitada: dois frascos com aparências divergentes tornam o rótulo ambíguo."),
}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    with METADATA_PATH.open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    for row in rows:
        decision = DECISIONS.get(row["sha256"][:16])
        if decision:
            row["review_status"], row["notes"] = decision

    now = datetime.now(timezone.utc).isoformat()
    local_records = [
        ("data/raw/proprias/limpo/limpo2.jpg", "limpo", "local-limpo-2020", "Foto local do projeto; conteúdo e rótulo revisados."),
        ("data/raw/proprias/sujo/sujo19.jpg", "sujo", "local-sujo-2020", "Foto local do projeto; conteúdo e rótulo revisados."),
    ]
    known = {row["file"] for row in rows}
    for filename, label, group_id, notes in local_records:
        if filename in known:
            continue
        path = PROJECT_ROOT / filename
        rows.append(
            {
                "file": filename,
                "class": label,
                "source_url": "",
                "source_page": "local://projeto-original",
                "license": "Uso acadêmico no projeto; confirmar autoria antes de redistribuir",
                "author": "Autor original não registrado",
                "acquired_at": now,
                "sha256": digest(path),
                "group_id": group_id,
                "review_status": "approved",
                "notes": notes,
            }
        )

    with METADATA_PATH.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    counts: dict[str, int] = {}
    for row in rows:
        counts[row["review_status"]] = counts.get(row["review_status"], 0) + 1
    print("Revisão registrada:", counts)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
