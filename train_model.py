"""Treina o modelo_agua: classificação visual de água (limpo/sujo) por histograma RGB.

Receita do modelo (a mesma do artefato ``modelo_agua.pkl``):

* ``Normalizer(norm="l1")`` sobre os 768 bins RGB;
* ``SelectKBest(chi2, k=500)`` — seleção de atributos por qui-quadrado;
* ``GaussianNB`` — Naive Bayes.

Avaliação e treinamento final são fases distintas: a validação cruzada estima o
desempenho e, só depois, o modelo é ajustado com 100% das amostras.
"""

from __future__ import annotations

import argparse
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
from sklearn.feature_selection import SelectKBest, chi2
from sklearn.metrics import (
    ConfusionMatrixDisplay,
    classification_report,
    confusion_matrix,
    make_scorer,
    precision_score,
    recall_score,
)
from sklearn.model_selection import StratifiedKFold, cross_val_predict, cross_validate
from sklearn.naive_bayes import GaussianNB
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import Normalizer

from water_clarity.ml.features import FEATURE_SCHEMA_VERSION, HISTOGRAM_FEATURES
from water_clarity.ml.service import VISUAL_ONLY_WARNING
from water_clarity.settings import (
    CLASS_DISTRIBUTION_PATH,
    CONFUSION_MATRIX_PATH,
    DATASET_PATH,
    MODEL_METADATA_PATH,
    RESULTS_PATH,
    WATER_MODEL_PATH,
)

RANDOM_SEED = 42
N_SPLITS = 5
PRIMARY_METRIC = "f1_macro"
K_FEATURES = 500
MODEL_NAME = "Naive Bayes"
TARGET_ALIASES = ("classe", "class", "label", "rotulo", "target", "y")
DIRTY_LABEL = "sujo"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def find_column(columns, aliases=TARGET_ALIASES):
    normalized = {str(column).lower().strip(): column for column in columns}
    return next((normalized[alias] for alias in aliases if alias in normalized), None)


def load_dataset(path: Path = DATASET_PATH):
    frame = pd.read_csv(path)
    target = find_column(frame.columns)
    if target is None:
        raise ValueError("A coluna alvo não foi encontrada no dataset.")
    missing = [column for column in HISTOGRAM_FEATURES if column not in frame.columns]
    if missing:
        raise ValueError(f"Dataset incompatível; atributos RGB ausentes: {missing[:5]}")
    print(f"[1] Seleção: {len(frame)} linhas, {len(HISTOGRAM_FEATURES)} bins RGB, alvo '{target}'")
    print(frame[target].value_counts().to_string())
    return frame, list(HISTOGRAM_FEATURES), target


def preprocess(frame: pd.DataFrame, feature_columns: list[str], target: str):
    before = len(frame)
    clean = frame.dropna(subset=feature_columns + [target]).drop_duplicates().copy()
    removed = before - len(clean)
    y = clean[target].astype(str).str.strip().str.lower().to_numpy()
    if len(set(y)) != 2:
        raise ValueError("O pipeline exige exatamente duas classes após a limpeza.")
    if min(pd.Series(y).value_counts()) < N_SPLITS:
        raise ValueError(f"Cada classe precisa ter pelo menos {N_SPLITS} amostras.")
    X = clean[feature_columns].astype(float)

    print(f"[2] Pré-processamento: {removed} linha(s) removida(s)")
    print(f"[3] Transformação: schema {FEATURE_SCHEMA_VERSION}, {X.shape[1]} atributos")
    return X, y


def build_model() -> Pipeline:
    return Pipeline(
        [
            ("normalizar", Normalizer(norm="l1")),
            ("selecionar", SelectKBest(score_func=chi2, k=K_FEATURES)),
            ("modelo", GaussianNB()),
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


def evaluate_model(X: pd.DataFrame, y: np.ndarray):
    cv = StratifiedKFold(n_splits=N_SPLITS, shuffle=True, random_state=RANDOM_SEED)
    print(f"[4] Mineração: {MODEL_NAME}, CV estratificada {N_SPLITS}-fold")
    scores = cross_validate(build_model(), X, y, cv=cv, scoring=_scoring())
    row: dict[str, object] = {"modelo": MODEL_NAME}
    for metric in _scoring():
        values = scores[f"test_{metric}"]
        row[metric] = float(values.mean())
        row[f"{metric}_std"] = float(values.std(ddof=1))

    predictions = cross_val_predict(build_model(), X, y, cv=cv)
    labels = sorted(set(y))
    matrix = confusion_matrix(y, predictions, labels=labels)
    report = classification_report(y, predictions, labels=labels, output_dict=True, zero_division=0)
    print(
        f"  {MODEL_NAME} macro_f1={row['f1_macro']:.4f} "
        f"balanced_acc={row['balanced_accuracy']:.4f}"
    )
    return pd.DataFrame([row]), matrix, labels, report


def plot_class_distribution(y: np.ndarray) -> None:
    counts = pd.Series(y).value_counts().sort_index()
    figure, axis = plt.subplots(figsize=(6, 4.5))
    bars = axis.bar(counts.index, counts.values, color=("#22a98b", "#d1844c"))
    axis.bar_label(bars, padding=3)
    axis.set_ylabel("Amostras")
    axis.set_title("Distribuição das classes no dataset preparado")
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
    y: np.ndarray,
    results: pd.DataFrame,
    matrix: np.ndarray,
    labels: list[str],
    report: dict,
) -> dict[str, object]:
    row = results.iloc[0]
    return {
        "artifact_format": "modelo_agua",
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "model_name": MODEL_NAME,
        "model_details": {
            "file": WATER_MODEL_PATH.name,
            "form": "B: seleção de atributos",
            "feature_selection": "Qui-quadrado",
            "k": K_FEATURES,
            "pipeline": [name for name, _ in build_model().steps],
        },
        "primary_metric": PRIMARY_METRIC,
        "random_seed": RANDOM_SEED,
        "cross_validation": {
            "strategy": "StratifiedKFold",
            "n_splits": N_SPLITS,
            "shuffle": True,
            "selection_metric": PRIMARY_METRIC,
        },
        "dataset": {
            "path": DATASET_PATH.name,
            "sha256": sha256_file(DATASET_PATH),
            "samples": int(len(y)),
            "class_distribution": {str(k): int(v) for k, v in pd.Series(y).value_counts().items()},
        },
        "feature_schema": {
            "version": FEATURE_SCHEMA_VERSION,
            "count": len(HISTOGRAM_FEATURES),
            "baseline_rgb_histogram_count": len(HISTOGRAM_FEATURES),
        },
        "evaluation": {
            "winner_metrics": {key: float(row[key]) for key in _scoring()},
            "confusion_matrix": matrix.tolist(),
            "labels": labels,
            "classification_report": report,
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
    print(f"[6] Modelo final: treinando {MODEL_NAME} com 100% do dataset")
    pipeline = build_model().fit(X, y)
    row = results.iloc[0]
    _atomic_joblib_dump(
        {
            "modelo": pipeline,
            "colunas": list(X.columns),
            "algoritmo": MODEL_NAME,
            "forma": "B: seleção de atributos",
            "selecao": "Qui-quadrado",
            "k": K_FEATURES,
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
    frame, feature_columns, target = load_dataset(DATASET_PATH)
    X, y = preprocess(frame, feature_columns, target)
    results, matrix, labels, report = evaluate_model(X, y)
    print(f"[5] Avaliação: {MODEL_NAME}, macro F1={results.iloc[0][PRIMARY_METRIC]:.4f}")
    metadata = build_metadata(y=y, results=results, matrix=matrix, labels=labels, report=report)
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
        help="executa a validação cruzada sem gravar artefatos nem substituir modelo_agua.pkl",
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
