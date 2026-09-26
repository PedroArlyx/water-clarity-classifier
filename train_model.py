"""Treina o modelo_agua: classificação visual de água (limpo/sujo) pela cor do centro da foto.

Receita do modelo (artefato ``modelo_agua.pkl``):

* recorte central (50% da largura e da altura), onde normalmente está o copo;
* 19 estatísticas de cor desse recorte: saturação, brilho e cromaticidade
  (``water_clarity.ml.features.center_color_features``);
* ``StandardScaler`` + ``LogisticRegression`` com classes balanceadas.

O histograma da foto inteira, usado antes, era dominado pelo fundo: em fotos nunca
vistas o modelo antigo acertou 1 de 5 fotos limpas; esta abordagem acertou 5 de 5.

Os dados vêm das imagens aprovadas em ``data/metadata/images.csv``. As 50 linhas de
``res.csv.bak`` não são usadas: existem só como histogramas, sem a foto para recortar.

Avaliação e treinamento final são fases distintas: a validação cruzada agrupada
(fotos da mesma sessão/fonte nunca ficam no treino e no teste ao mesmo tempo)
estima o desempenho e, só depois, o modelo é ajustado com 100% das imagens.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import platform
import sys
import tempfile
from datetime import datetime, timezone
from importlib.metadata import version
from pathlib import Path

os.environ.setdefault(
    "MPLCONFIGDIR",
    str(Path(tempfile.gettempdir()) / "water-clarity-matplotlib"),
)

import joblib
import matplotlib
import numpy as np
import pandas as pd

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from PIL import Image, ImageOps
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    ConfusionMatrixDisplay,
    classification_report,
    confusion_matrix,
    make_scorer,
    precision_score,
    recall_score,
)
from sklearn.model_selection import StratifiedGroupKFold, cross_val_predict, cross_validate
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from water_clarity.ml.features import (
    CENTER_COLOR_FEATURES,
    CENTER_FRACTION,
    FEATURE_SCHEMA_VERSION,
    center_color_features,
)
from water_clarity.ml.service import VISUAL_ONLY_WARNING
from water_clarity.settings import (
    CATALOG_PATH,
    CLASS_DISTRIBUTION_PATH,
    CONFUSION_MATRIX_PATH,
    MODEL_METADATA_PATH,
    PROJECT_ROOT,
    REPORTS_DIR,
    RESULTS_PATH,
    WATER_MODEL_PATH,
)

RANDOM_SEED = 42
N_SPLITS = 5
PRIMARY_METRIC = "f1_macro"
MODEL_NAME = "Regressão logística"
DIRTY_LABEL = "sujo"
OWN_PHOTOS_PREFIX = "data/raw/proprias/"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def load_dataset(path: Path = CATALOG_PATH) -> pd.DataFrame:
    """Imagens aprovadas do catálogo, com hash conferido."""
    with path.open(encoding="utf-8", newline="") as handle:
        rows = [row for row in csv.DictReader(handle) if row["review_status"] == "approved"]
    for row in rows:
        file = PROJECT_ROOT / row["file"]
        if not file.exists():
            raise FileNotFoundError(f"Imagem aprovada ausente: {row['file']}")
        if sha256_file(file) != row["sha256"]:
            raise ValueError(f"Hash divergente: {row['file']}")
    frame = pd.DataFrame(rows)
    print(f"[1] Seleção: {len(frame)} imagens aprovadas em {path.relative_to(PROJECT_ROOT)}")
    print(frame["class"].value_counts().to_string())
    return frame


def _open_rgb(path: Path) -> Image.Image:
    with Image.open(path) as source:
        return ImageOps.exif_transpose(source).convert("RGB")


def preprocess(frame: pd.DataFrame):
    y = frame["class"].astype(str).str.strip().str.lower().to_numpy()
    if len(set(y)) != 2:
        raise ValueError("O pipeline exige exatamente duas classes.")
    groups = frame["group_id"].to_numpy()
    for label in set(y):
        if len(set(groups[y == label])) < N_SPLITS:
            raise ValueError(f"A classe '{label}' precisa de pelo menos {N_SPLITS} grupos/sessões distintos.")
    X = pd.DataFrame(
        [center_color_features(_open_rgb(PROJECT_ROOT / file)) for file in frame["file"]],
        columns=list(CENTER_COLOR_FEATURES),
    )
    print(f"[2] Pré-processamento: {len(set(groups))} grupos (sessões/fontes) distintos")
    print(f"[3] Transformação: schema {FEATURE_SCHEMA_VERSION}, {X.shape[1]} atributos do centro da foto")
    return X, y, groups


def build_model() -> Pipeline:
    return Pipeline(
        [
            ("padronizar", StandardScaler()),
            ("modelo", LogisticRegression(max_iter=5000, class_weight="balanced", C=0.5)),
        ]
    )


def _scoring() -> dict[str, object]:
    return {
        "accuracy": "accuracy",
        "balanced_accuracy": "balanced_accuracy",
        "precision_macro": make_scorer(precision_score, average="macro", zero_division=0),
        "recall_macro": make_scorer(recall_score, average="macro", zero_division=0),
        "f1_macro": "f1_macro",
        "f1_weighted": "f1_weighted",
    }


def evaluate_model(X: pd.DataFrame, y: np.ndarray, groups: np.ndarray):
    cv = StratifiedGroupKFold(n_splits=N_SPLITS, shuffle=True, random_state=RANDOM_SEED)
    print(f"[4] Mineração: {MODEL_NAME}, CV estratificada agrupada {N_SPLITS}-fold")
    scores = cross_validate(build_model(), X, y, groups=groups, cv=cv, scoring=_scoring())
    row: dict[str, object] = {"modelo": MODEL_NAME}
    for metric in _scoring():
        values = scores[f"test_{metric}"]
        row[metric] = float(values.mean())
        row[f"{metric}_std"] = float(values.std(ddof=1))

    predictions = cross_val_predict(build_model(), X, y, groups=groups, cv=cv)
    labels = sorted(set(y))
    matrix = confusion_matrix(y, predictions, labels=labels)
    report = classification_report(y, predictions, labels=labels, output_dict=True, zero_division=0)
    print(f"  {MODEL_NAME} macro_f1={row['f1_macro']:.4f} balanced_acc={row['balanced_accuracy']:.4f}")
    return pd.DataFrame([row]), matrix, labels, report


def evaluate_unseen_own_photos(frame: pd.DataFrame, X: pd.DataFrame, y: np.ndarray, groups: np.ndarray) -> dict:
    """Deixa cada sessão de fotos próprias de fora uma vez: mede o acerto em fotos nunca vistas."""
    own = frame["file"].str.startswith(OWN_PHOTOS_PREFIX).to_numpy()
    rows = []
    for group in sorted(set(groups[own])):
        test = groups == group
        model = build_model().fit(X[~test], y[~test])
        for file, label, prediction in zip(frame["file"][test], y[test], model.predict(X[test]), strict=True):
            rows.append({"arquivo": file, "classe": label, "previsto": prediction})
    result = pd.DataFrame(rows)
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    result.to_csv(REPORTS_DIR / "fotos_nunca_vistas.csv", index=False)
    summary = {
        label: {
            "hits": int((result["previsto"][result["classe"] == label] == label).sum()),
            "total": int((result["classe"] == label).sum()),
        }
        for label in sorted(result["classe"].unique())
    }
    text = "  ".join(f"{label} {v['hits']}/{v['total']}" for label, v in summary.items())
    print(f"[5] Fotos próprias nunca vistas (uma sessão de fora por vez): {text}")
    return summary


def plot_class_distribution(y: np.ndarray) -> None:
    counts = pd.Series(y).value_counts().sort_index()
    figure, axis = plt.subplots(figsize=(6, 4.5))
    bars = axis.bar(counts.index, counts.values, color=("#22a98b", "#d1844c"))
    axis.bar_label(bars, padding=3)
    axis.set_ylabel("Imagens")
    axis.set_title("Distribuição das classes no treino")
    axis.set_ylim(0, max(counts.values) * 1.18)
    axis.grid(axis="y", alpha=0.2)
    figure.tight_layout()
    figure.savefig(CLASS_DISTRIBUTION_PATH, dpi=160)
    plt.close(figure)


def plot_confusion(matrix: np.ndarray, labels: list[str]) -> None:
    figure, axis = plt.subplots(figsize=(6, 5))
    display = ConfusionMatrixDisplay(confusion_matrix=matrix, display_labels=labels)
    display.plot(ax=axis, cmap="Blues", colorbar=False)
    axis.set_title(f"Matriz de confusão fora do treino — {MODEL_NAME}")
    figure.tight_layout()
    figure.savefig(CONFUSION_MATRIX_PATH, dpi=160)
    plt.close(figure)


def _library_versions() -> dict[str, str]:
    packages = ("flask", "numpy", "pandas", "scikit-learn", "pillow", "joblib", "matplotlib")
    return {package: version(package) for package in packages}


def build_metadata(
    *,
    frame: pd.DataFrame,
    y: np.ndarray,
    results: pd.DataFrame,
    matrix: np.ndarray,
    labels: list[str],
    report: dict,
    unseen: dict,
) -> dict[str, object]:
    row = results.iloc[0]
    own = frame["file"].str.startswith(OWN_PHOTOS_PREFIX)
    return {
        "artifact_format": "modelo_agua",
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "model_name": MODEL_NAME,
        "model_details": {
            "file": WATER_MODEL_PATH.name,
            "form": "Cor do centro da foto",
            "feature_selection": f"recorte central de {CENTER_FRACTION:.0%} da largura e da altura",
            "k": len(CENTER_COLOR_FEATURES),
            "pipeline": [name for name, _ in build_model().steps],
        },
        "primary_metric": PRIMARY_METRIC,
        "random_seed": RANDOM_SEED,
        "cross_validation": {
            "strategy": "StratifiedGroupKFold",
            "n_splits": N_SPLITS,
            "shuffle": True,
            "groups": "group_id do catálogo (sessão de fotos ou página do Commons)",
            "selection_metric": PRIMARY_METRIC,
        },
        "dataset": {
            "path": CATALOG_PATH.relative_to(PROJECT_ROOT).as_posix(),
            "sha256": sha256_file(CATALOG_PATH),
            "samples": int(len(y)),
            "own_photos": int(own.sum()),
            "commons_photos": int((~own).sum()),
            "class_distribution": {str(k): int(v) for k, v in pd.Series(y).value_counts().items()},
        },
        "feature_schema": {
            "version": FEATURE_SCHEMA_VERSION,
            "count": len(CENTER_COLOR_FEATURES),
            "features": list(CENTER_COLOR_FEATURES),
        },
        "evaluation": {
            "winner_metrics": {key: float(row[key]) for key in _scoring()},
            "confusion_matrix": matrix.tolist(),
            "labels": labels,
            "classification_report": report,
            "unseen_own_photos": unseen,
        },
        "runtime": {
            "python": platform.python_version(),
            "platform": platform.platform(),
            "libraries": _library_versions(),
        },
        "visual_only_warning": VISUAL_ONLY_WARNING,
    }


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    content = json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    descriptor, temporary_name = tempfile.mkstemp(prefix=f"{path.stem}-", suffix=".json", dir=path.parent)
    os.close(descriptor)
    temporary = Path(temporary_name)
    try:
        temporary.write_text(content, encoding="utf-8")
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def _atomic_joblib_dump(payload: object, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix="model-", suffix=".pkl", dir=destination.parent)
    os.close(descriptor)
    temporary = Path(temporary_name)
    try:
        joblib.dump(payload, temporary)
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


def train_final_model(X: pd.DataFrame, y: np.ndarray, results: pd.DataFrame, report: dict) -> None:
    print(f"[6] Modelo final: treinando {MODEL_NAME} com 100% das imagens")
    pipeline = build_model().fit(X, y)
    row = results.iloc[0]
    _atomic_joblib_dump(
        {
            "modelo": pipeline,
            "colunas": list(X.columns),
            "extrator": "cor_do_centro",
            "fracao_centro": CENTER_FRACTION,
            "algoritmo": MODEL_NAME,
            "forma": "Cor do centro da foto",
            "metricas": {
                "acuracia": float(row["accuracy"]),
                "acuracia_bal": float(row["balanced_accuracy"]),
                "precisao_sujo": float(report[DIRTY_LABEL]["precision"]),
                "recall_sujo": float(report[DIRTY_LABEL]["recall"]),
                "f1_macro": float(row["f1_macro"]),
            },
            "versao_sklearn": version("scikit-learn"),
        },
        WATER_MODEL_PATH,
    )


def run_pipeline(*, evaluate_only: bool = False) -> dict[str, object]:
    frame = load_dataset()
    X, y, groups = preprocess(frame)
    results, matrix, labels, report = evaluate_model(X, y, groups)
    unseen = evaluate_unseen_own_photos(frame, X, y, groups)
    metadata = build_metadata(
        frame=frame, y=y, results=results, matrix=matrix, labels=labels, report=report, unseen=unseen
    )
    if evaluate_only:
        return metadata

    results.to_csv(RESULTS_PATH, index=False)
    plot_class_distribution(y)
    plot_confusion(matrix, labels)
    write_json(MODEL_METADATA_PATH, metadata)
    train_final_model(X, y, results, report)
    return metadata


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--evaluate-only",
        action="store_true",
        help="executa a validação sem gravar artefatos nem substituir modelo_agua.pkl",
    )
    args = parser.parse_args()
    try:
        run_pipeline(evaluate_only=args.evaluate_only)
    except Exception as exc:
        print(f"Erro no pipeline: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
