"""Pipeline KDD reproduzível para classificação visual de água por RGB.

Avaliação e treinamento final são fases distintas:

* a validação cruzada estima o desempenho e seleciona o maior F1 macro;
* somente depois o vencedor é treinado novamente com 100% das amostras.
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
from sklearn.base import clone
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
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
from sklearn.neighbors import KNeighborsClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import LabelEncoder, StandardScaler
from sklearn.svm import SVC
from sklearn.tree import DecisionTreeClassifier

from water_clarity.ml.features import (
    FEATURE_COLUMNS,
    FEATURE_SCHEMA_VERSION,
    HISTOGRAM_FEATURES,
    features_from_histogram_row,
    schema_document,
)
from water_clarity.ml.service import VISUAL_ONLY_WARNING
from water_clarity.settings import (
    CLASS_DISTRIBUTION_PATH,
    COMPARISON_CHART_PATH,
    CONFUSION_MATRIX_PATH,
    DATASET_PATH,
    EVALUATION_METADATA_PATH,
    FEATURE_SCHEMA_PATH,
    MODEL_METADATA_PATH,
    MODEL_PATH,
    RESULTS_PATH,
)

RANDOM_SEED = 42
N_SPLITS = 5
PRIMARY_METRIC = "f1_macro"
TARGET_ALIASES = ("classe", "class", "label", "rotulo", "target", "y")


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


def preprocess(frame: pd.DataFrame, _feature_columns, target: str):
    before = len(frame)
    clean = frame.dropna(subset=list(HISTOGRAM_FEATURES) + [target]).drop_duplicates().copy()
    removed = before - len(clean)
    if clean[target].astype(str).str.strip().str.lower().nunique() != 2:
        raise ValueError("O pipeline exige exatamente duas classes após a limpeza.")

    feature_rows = [features_from_histogram_row(row) for row in clean.to_dict(orient="records")]
    transformed = pd.DataFrame(feature_rows, columns=FEATURE_COLUMNS)
    X = transformed.to_numpy(dtype=float)
    labels = clean[target].astype(str).str.strip().str.lower().to_numpy()
    encoder = LabelEncoder()
    y = encoder.fit_transform(labels)
    if np.min(np.bincount(y)) < N_SPLITS:
        raise ValueError(f"Cada classe precisa ter pelo menos {N_SPLITS} amostras.")

    print(f"[2] Pré-processamento: {removed} linha(s) removida(s)")
    print(f"[3] Transformação: schema {FEATURE_SCHEMA_VERSION}, {X.shape[1]} atributos")
    return X, y, encoder


def _pipeline(classifier, *, scale: bool) -> Pipeline:
    steps = []
    if scale:
        steps.append(("scaler", StandardScaler()))
    steps.append(("classifier", classifier))
    return Pipeline(steps)


def get_candidate_models() -> dict[str, Pipeline]:
    return {
        "KNN": _pipeline(KNeighborsClassifier(n_neighbors=5), scale=True),
        "DecisionTree": _pipeline(
            DecisionTreeClassifier(random_state=RANDOM_SEED, class_weight="balanced"), scale=False
        ),
        "RandomForest": _pipeline(
            RandomForestClassifier(
                random_state=RANDOM_SEED,
                n_estimators=300,
                class_weight="balanced",
                n_jobs=-1,
            ),
            scale=False,
        ),
        "NaiveBayes": _pipeline(GaussianNB(), scale=True),
        "SVM": _pipeline(
            SVC(
                kernel="rbf",
                probability=True,
                random_state=RANDOM_SEED,
                class_weight="balanced",
            ),
            scale=True,
        ),
        "LogisticRegression": _pipeline(
            LogisticRegression(
                max_iter=2_000,
                random_state=RANDOM_SEED,
                class_weight="balanced",
            ),
            scale=True,
        ),
        "GradientBoosting": _pipeline(
            GradientBoostingClassifier(random_state=RANDOM_SEED), scale=False
        ),
    }


def _scoring() -> dict[str, object]:
    return {
        "accuracy": "accuracy",
        "balanced_accuracy": "balanced_accuracy",
        "precision_macro": make_scorer(precision_score, average="macro", zero_division=0),
        "recall_macro": make_scorer(recall_score, average="macro", zero_division=0),
        "f1_macro": "f1_macro",
        "f1_weighted": "f1_weighted",
    }


def evaluate_models(X: np.ndarray, y: np.ndarray):
    cv = StratifiedKFold(n_splits=N_SPLITS, shuffle=True, random_state=RANDOM_SEED)
    print(f"[4] Mineração: {len(get_candidate_models())} modelos, CV estratificada {N_SPLITS}-fold")
    rows: list[dict[str, object]] = []
    for name, pipeline in get_candidate_models().items():
        scores = cross_validate(pipeline, X, y, cv=cv, scoring=_scoring(), n_jobs=None)
        row: dict[str, object] = {"modelo": name}
        for metric in _scoring():
            values = scores[f"test_{metric}"]
            row[metric] = float(values.mean())
            row[f"{metric}_std"] = float(values.std(ddof=1))
        rows.append(row)
        print(
            f"  {name:20s} macro_f1={row['f1_macro']:.4f} "
            f"balanced_acc={row['balanced_accuracy']:.4f}"
        )
    results = pd.DataFrame(rows).sort_values(
        [PRIMARY_METRIC, "balanced_accuracy", "f1_weighted"],
        ascending=False,
    )
    return results.reset_index(drop=True), cv


def evaluate_winner_predictions(X, y, winner_name: str, cv, encoder: LabelEncoder):
    pipeline = clone(get_candidate_models()[winner_name])
    predictions = cross_val_predict(pipeline, X, y, cv=cv)
    matrix = confusion_matrix(y, predictions)
    report = classification_report(
        y,
        predictions,
        target_names=list(encoder.classes_),
        output_dict=True,
        zero_division=0,
    )
    return matrix, report


def plot_results(results: pd.DataFrame) -> None:
    metrics = ("accuracy", "balanced_accuracy", "f1_macro", "f1_weighted")
    figure, axis = plt.subplots(figsize=(11, 6))
    x = np.arange(len(results))
    width = 0.19
    for index, metric in enumerate(metrics):
        axis.bar(x + index * width, results[metric], width, label=metric.replace("_", " "))
    axis.set_xticks(x + width * 1.5)
    axis.set_xticklabels(results["modelo"], rotation=18, ha="right")
    axis.set_ylim(0, 1)
    axis.set_ylabel("Score médio")
    axis.set_title("Comparação de classificadores — validação cruzada estratificada")
    axis.legend(ncols=2)
    axis.grid(axis="y", alpha=0.2)
    figure.tight_layout()
    figure.savefig(COMPARISON_CHART_PATH, dpi=160)
    plt.close(figure)


def plot_class_distribution(frame: pd.DataFrame, target: str) -> None:
    counts = frame[target].astype(str).str.strip().str.lower().value_counts().sort_index()
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


def plot_confusion(matrix: np.ndarray, labels: list[str], model_name: str) -> None:
    figure, axis = plt.subplots(figsize=(6, 5))
    display = ConfusionMatrixDisplay(confusion_matrix=matrix, display_labels=labels)
    display.plot(ax=axis, cmap="Blues", colorbar=False)
    axis.set_title(f"Matriz de confusão fora do treino — {model_name}")
    figure.tight_layout()
    figure.savefig(CONFUSION_MATRIX_PATH, dpi=160)
    plt.close(figure)


def _library_versions() -> dict[str, str]:
    packages = ("flask", "numpy", "pandas", "scikit-learn", "pillow", "joblib", "matplotlib")
    return {package: version(package) for package in packages}


def build_metadata(
    *,
    frame: pd.DataFrame,
    target: str,
    encoder: LabelEncoder,
    results: pd.DataFrame,
    winner: str,
    matrix: np.ndarray,
    report: dict,
) -> dict[str, object]:
    winner_row = results.loc[results["modelo"] == winner].iloc[0]
    metrics = {
        key: float(winner_row[key])
        for key in _scoring()
    }
    return {
        "artifact_format": "water-clarity-model-v2",
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "model_name": winner,
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
            "samples": int(len(frame)),
            "class_distribution": {
                str(key): int(value)
                for key, value in frame[target].astype(str).str.strip().str.lower().value_counts().items()
            },
            "provenance_limitation": (
                "O CSV legado não registra arquivo/sessão para 50 amostras; validação agrupada ainda não é possível."
            ),
        },
        "feature_schema": {
            "version": FEATURE_SCHEMA_VERSION,
            "count": len(FEATURE_COLUMNS),
            "baseline_rgb_histogram_count": len(HISTOGRAM_FEATURES),
        },
        "evaluation": {
            "winner_metrics": metrics,
            "confusion_matrix": matrix.tolist(),
            "labels": list(encoder.classes_),
            "classification_report": report,
            "all_models": results.to_dict(orient="records"),
        },
        "runtime": {
            "python": platform.python_version(),
            "platform": platform.platform(),
            "libraries": _library_versions(),
        },
        "visual_only_warning": VISUAL_ONLY_WARNING,
    }


def _atomic_joblib_dump(payload: object, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix="model-", suffix=".joblib", dir=destination.parent)
    os.close(descriptor)
    temporary = Path(temporary_name)
    try:
        joblib.dump(payload, temporary)
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


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


def train_final_model(X, y, winner: str, encoder: LabelEncoder) -> None:
    print(f"[6] Modelo final: treinando {winner} novamente com 100% do dataset")
    pipeline = clone(get_candidate_models()[winner])
    pipeline.fit(X, y)
    _atomic_joblib_dump(
        {
            "pipeline": pipeline,
            "label_encoder": encoder,
            "model_name": winner,
            "feature_columns": list(FEATURE_COLUMNS),
            "feature_schema_version": FEATURE_SCHEMA_VERSION,
        },
        MODEL_PATH,
    )


def run_pipeline(*, evaluate_only: bool = False) -> dict[str, object]:
    frame, feature_columns, target = load_dataset(DATASET_PATH)
    X, y, encoder = preprocess(frame, feature_columns, target)
    results, cv = evaluate_models(X, y)
    winner = str(results.iloc[0]["modelo"])
    matrix, report = evaluate_winner_predictions(X, y, winner, cv, encoder)

    results.to_csv(RESULTS_PATH, index=False)
    plot_class_distribution(frame, target)
    plot_results(results)
    plot_confusion(matrix, list(encoder.classes_), winner)
    metadata = build_metadata(
        frame=frame,
        target=target,
        encoder=encoder,
        results=results,
        winner=winner,
        matrix=matrix,
        report=report,
    )
    write_json(FEATURE_SCHEMA_PATH, schema_document())
    write_json(
        EVALUATION_METADATA_PATH if evaluate_only else MODEL_METADATA_PATH,
        metadata,
    )
    print(f"[5] Avaliação: vencedor {winner}, macro F1={results.iloc[0][PRIMARY_METRIC]:.4f}")
    if not evaluate_only:
        train_final_model(X, y, winner, encoder)
    return metadata


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--evaluate-only",
        action="store_true",
        help="Gera métricas e relatórios sem substituir o modelo final.",
    )
    args = parser.parse_args(argv)
    run_pipeline(evaluate_only=args.evaluate_only)
    return 0


if __name__ == "__main__":
    sys.exit(main())
