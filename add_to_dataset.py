"""Adiciona fotos rotuladas ao res.csv (mesmo formato: r0..r255,g0..g255,b0..b255,class).

Uso:
    python add_to_dataset.py caminho_foto1.jpg limpo caminho_foto2.jpg sujo ...
"""

import sys
import numpy as np
import pandas as pd
from PIL import Image

DATA_PATH = "res.csv"


def raw_histogram_row(image_path):
    img = Image.open(image_path).convert("RGB")
    arr = np.asarray(img)
    row = {}
    for i, ch in enumerate(("r", "g", "b")):
        hist = np.bincount(arr[:, :, i].ravel(), minlength=256)
        for bin_idx, count in enumerate(hist):
            row[f"{ch}{bin_idx}"] = int(count)
    return row


def main(args):
    if len(args) % 2 != 0 or len(args) == 0:
        print("Uso: python add_to_dataset.py foto1.jpg limpo foto2.jpg sujo ...")
        sys.exit(1)

    df = pd.read_csv(DATA_PATH)
    new_rows = []
    for i in range(0, len(args), 2):
        path, label = args[i], args[i + 1].strip().lower()
        if label not in ("limpo", "sujo"):
            print(f"Aviso: rotulo '{label}' incomum (esperado 'limpo' ou 'sujo')")
        row = raw_histogram_row(path)
        row["class"] = label
        new_rows.append(row)
        print(f"Adicionado: {path} -> {label}")

    df = pd.concat([df, pd.DataFrame(new_rows)], ignore_index=True)
    df.to_csv(DATA_PATH, index=False)
    print(f"\n{DATA_PATH} atualizado: {len(df)} linhas no total")
    print(df["class"].value_counts())


if __name__ == "__main__":
    main(sys.argv[1:])
