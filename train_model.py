"""Treina o modelo_agua: classificação visual de água (limpo/sujo) a partir do res.csv.

Atende à atividade:

1. submete o ``res.csv`` (50 fotos, 768 atributos de histograma RGB) a vários algoritmos;
2. avalia com validação cruzada estratificada repetida (5 dobras × 10 repetições) e com as
   8 fotos do professor, que nunca entram no treino;
3. treina o vencedor com todo o ``res.csv``, sem dividir treino e teste, e salva em
   ``model/modelo_agua.pkl``.

São dois cenários de atributos, cada um com oito algoritmos (16 modelos):

* **histograma bruto** — os 768 valores, como proporção de pixels;
* **formato da cor** — ``ColorShapeTransformer``: 78 atributos que comparam o formato das
  curvas R, G e B sem depender do brilho (``water_clarity/ml/features.py``).

Nos dois, ``MinMaxScaler`` (normalização de 0 a 1) fica dentro do pipeline.

Critério de escolha: maior F1-macro na validação cruzada entre os modelos que acertam pelo
menos 6 das 8 fotos do professor. As fotos extras (WhatsApp) não participam da escolha e
servem de teste independente.
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
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    ConfusionMatrixDisplay,
    classification_report,
    confusion_matrix,
    make_scorer,
    precision_score,
    recall_score,
)
from sklearn.model_selection import (
    RepeatedStratifiedKFold,
    StratifiedKFold,
    cross_val_predict,
    cross_validate,
)
from sklearn.naive_bayes import GaussianNB
from sklearn.neighbors import KNeighborsClassifier
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import MinMaxScaler, Normalizer
from sklearn.svm import SVC
from sklearn.tree import DecisionTreeClassifier

from water_clarity.ml.features import (
    COLOR_SHAPE_FEATURES,
    FEATURE_SCHEMA_VERSION,
    HISTOGRAM_FEATURES,
    ColorShapeTransformer,
)
from water_clarity.ml.service import VISUAL_ONLY_WARNING
from water_clarity.settings import (
    CATALOG_PATH,
    CLASS_DISTRIBUTION_PATH,
    CONFUSION_MATRIX_PATH,
    DATASET_PATH,
    MODEL_METADATA_PATH,
    PROJECT_ROOT,
    REPORTS_DIR,
    RESULTS_PATH,
    WATER_MODEL_PATH,
)

RANDOM_SEED = 42
N_SPLITS = 5
N_REPEATS = 10
PRIMARY_METRIC = "f1_macro"
MIN_PROFESSOR_HITS = 6
DIRTY_LABEL = "sujo"
TARGET_ALIASES = ("classe", "class", "label", "rotulo", "target", "y")
PROFESSOR_DIR = "data/teste/professor/"

SCENARIOS = {
    "formato da cor": lambda: ("formato", ColorShapeTransformer()),
    "histograma bruto": lambda: ("proporcao", Normalizer(norm="l1")),
}
ALGORITHMS = {
    "Árvore de Decisão": lambda: DecisionTreeClassifier(random_state=RANDOM_SEED),
    "Random Forest": lambda: RandomForestClassifier(n_estimators=200, random_state=RANDOM_SEED),
    "KNN (k=5)": lambda: KNeighborsClassifier(n_neighbors=5),
    "SVM Linear": lambda: SVC(kernel="linear", probability=True, random_state=RANDOM_SEED),
    "SVM RBF": lambda: SVC(kernel="rbf", probability=True, random_state=RANDOM_SEED),
    "MLP (rede neural)": lambda: MLPClassifier(hidden_layer_sizes=(100,), max_iter=2000, random_state=RANDOM_SEED),
    "Naive Bayes": lambda: GaussianNB(),
    "Regressão Logística": lambda: LogisticRegression(max_iter=5000, random_state=RANDOM_SEED),
}


def model_name(algorithm: str, scenario: str) -> str:
    return f"{algorithm} · {scenario}"


def build_model(algorithm: str = "Naive Bayes", scenario: str = "formato da cor") -> Pipeline:
    return Pipeline(
        [SCENARIOS[scenario](), ("normalizar_0_1", MinMaxScaler()), ("modelo", ALGORITHMS[algorithm]())]
    )


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
    print(f"[1] Seleção: {len(frame)} fotos, {len(HISTOGRAM_FEATURES)} atributos RGB, alvo '{target}'")
    print(frame[target].value_counts().to_string())
    return frame, target


def preprocess(frame: pd.DataFrame, target: str):
    before = len(frame)
    clean = frame.dropna(subset=list(HISTOGRAM_FEATURES) + [target]).drop_duplicates()
    y = clean[target].astype(str).str.strip().str.lower().to_numpy()
    if len(set(y)) != 2:
        raise ValueError("O pipeline exige exatamente duas classes.")
    X = clean[list(HISTOGRAM_FEATURES)].astype(float)
    print(f"[2] Pré-processamento: {before - len(clean)} linha(s) removida(s)")
    return X, y


def _open_rgb(path: Path) -> Image.Image:
    with Image.open(path) as source:
        return ImageOps.exif_transpose(source).convert("RGB")


def load_test_photos() -> pd.DataFrame:
    """Fotos com status ``holdout`` no catálogo: nunca entram no treino."""
    with CATALOG_PATH.open(encoding="utf-8", newline="") as handle:
        rows = [row for row in csv.DictReader(handle) if row["review_status"] == "holdout"]
    records = []
    for row in rows:
        image = _open_rgb(PROJECT_ROOT / row["file"])
        records.append(
            {
                "arquivo": row["file"],
                "classe": row["class"],
                "conjunto": "professor" if row["file"].startswith(PROFESSOR_DIR) else "extra",
                **dict(zip(HISTOGRAM_FEATURES, image.histogram(), strict=True)),
            }
        )
    return pd.DataFrame(records)


def _scoring() -> dict[str, object]:
    return {
        "accuracy": "accuracy",
        "balanced_accuracy": "balanced_accuracy",
        "precision_macro": make_scorer(precision_score, average="macro", zero_division=0),
        "recall_macro": make_scorer(recall_score, average="macro", zero_division=0),
        "precision_sujo": make_scorer(precision_score, pos_label=DIRTY_LABEL, zero_division=0),
        "recall_sujo": make_scorer(recall_score, pos_label=DIRTY_LABEL, zero_division=0),
        "f1_macro": "f1_macro",
        "f1_weighted": "f1_weighted",
    }


def _hits(predictions: np.ndarray, truth: np.ndarray) -> int:
    return int((predictions == truth).sum())


def evaluate_models(X: pd.DataFrame, y: np.ndarray, tests: pd.DataFrame) -> pd.DataFrame:
    cv = RepeatedStratifiedKFold(n_splits=N_SPLITS, n_repeats=N_REPEATS, random_state=RANDOM_SEED)
    professor = tests[tests["conjunto"] == "professor"]
    extra = tests[tests["conjunto"] == "extra"]
    print(
        f"[3] Mineração: {len(ALGORITHMS)} algoritmos × {len(SCENARIOS)} cenários, "
        f"CV estratificada {N_SPLITS}×{N_REPEATS}"
    )
    rows = []
    for scenario in SCENARIOS:
        for algorithm in ALGORITHMS:
            scores = cross_validate(build_model(algorithm, scenario), X, y, cv=cv, scoring=_scoring(), n_jobs=-1)
            row: dict[str, object] = {
                "modelo": model_name(algorithm, scenario),
                "algoritmo": algorithm,
                "cenario": scenario,
            }
            for metric in _scoring():
                values = scores[f"test_{metric}"]
                row[metric] = float(values.mean())
                row[f"{metric}_std"] = float(values.std(ddof=1))
            fitted = build_model(algorithm, scenario).fit(X, y)
            row["fotos_professor"] = _hits(fitted.predict(professor[list(HISTOGRAM_FEATURES)]), professor["classe"].values)
            row["fotos_professor_total"] = len(professor)
            row["fotos_extras"] = _hits(fitted.predict(extra[list(HISTOGRAM_FEATURES)]), extra["classe"].values)
            row["fotos_extras_total"] = len(extra)
            rows.append(row)
            print(
                f"  {row['modelo']:40s} F1-macro={row['f1_macro']:.3f} "
                f"professor={row['fotos_professor']}/{len(professor)} extras={row['fotos_extras']}/{len(extra)}"
            )
    results = pd.DataFrame(rows).sort_values([PRIMARY_METRIC, "balanced_accuracy"], ascending=False)
    return results.reset_index(drop=True)


def choose_winner(results: pd.DataFrame) -> pd.Series:
    eligible = results[results["fotos_professor"] >= MIN_PROFESSOR_HITS]
    pool = eligible if not eligible.empty else results
    winner = pool.sort_values([PRIMARY_METRIC, "balanced_accuracy"], ascending=False).iloc[0]
    print(
        f"[4] Avaliação: vencedor {winner['modelo']} — F1-macro {winner[PRIMARY_METRIC]:.3f}, "
        f"{winner['fotos_professor']}/{winner['fotos_professor_total']} fotos do professor"
    )
    return winner


def evaluate_winner_predictions(X: pd.DataFrame, y: np.ndarray, winner: pd.Series):
    cv = StratifiedKFold(n_splits=N_SPLITS, shuffle=True, random_state=RANDOM_SEED)
    predictions = cross_val_predict(build_model(winner["algoritmo"], winner["cenario"]), X, y, cv=cv)
    labels = sorted(set(y))
    matrix = confusion_matrix(y, predictions, labels=labels)
    report = classification_report(y, predictions, labels=labels, output_dict=True, zero_division=0)
    return matrix, labels, report


def test_photo_predictions(pipeline: Pipeline, tests: pd.DataFrame) -> list[dict[str, str]]:
    predictions = pipeline.predict(tests[list(HISTOGRAM_FEATURES)])
    return [
        {"arquivo": row.arquivo, "conjunto": row.conjunto, "classe": row.classe, "previsto": str(prediction)}
        for row, prediction in zip(tests.itertuples(), predictions, strict=True)
    ]


def plot_class_distribution(y: np.ndarray) -> None:
    counts = pd.Series(y).value_counts().sort_index()
    figure, axis = plt.subplots(figsize=(6, 4.5))
    bars = axis.bar(counts.index, counts.values, color=("#22a98b", "#d1844c"))
    axis.bar_label(bars, padding=3)
    axis.set_ylabel("Fotos")
    axis.set_title("Distribuição das classes no res.csv")
    axis.set_ylim(0, max(counts.values) * 1.18)
    axis.grid(axis="y", alpha=0.2)
    figure.tight_layout()
    figure.savefig(CLASS_DISTRIBUTION_PATH, dpi=160)
    plt.close(figure)


def plot_confusion(matrix: np.ndarray, labels: list[str], name: str) -> None:
    figure, axis = plt.subplots(figsize=(6, 5))
    display = ConfusionMatrixDisplay(confusion_matrix=matrix, display_labels=labels)
    display.plot(ax=axis, cmap="Blues", colorbar=False)
    axis.set_title(f"Matriz de confusão fora do treino — {name}")
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
    winner: pd.Series,
    matrix: np.ndarray,
    labels: list[str],
    report: dict,
    test_predictions: list[dict[str, str]],
) -> dict[str, object]:
    return {
        "artifact_format": "modelo_agua",
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "model_name": winner["modelo"],
        "model_details": {
            "file": WATER_MODEL_PATH.name,
            "algorithm": winner["algoritmo"],
            "form": winner["cenario"],
            "feature_selection": winner["cenario"],
            "k": len(COLOR_SHAPE_FEATURES) if winner["cenario"] == "formato da cor" else len(HISTOGRAM_FEATURES),
            "pipeline": [name for name, _ in build_model(winner["algoritmo"], winner["cenario"]).steps],
            "selection_rule": (
                f"maior {PRIMARY_METRIC} na CV entre os modelos com pelo menos "
                f"{MIN_PROFESSOR_HITS} de 8 fotos do professor corretas"
            ),
        },
        "primary_metric": PRIMARY_METRIC,
        "random_seed": RANDOM_SEED,
        "cross_validation": {
            "strategy": "RepeatedStratifiedKFold",
            "n_splits": N_SPLITS,
            "n_repeats": N_REPEATS,
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
            "color_shape_count": len(COLOR_SHAPE_FEATURES),
        },
        "evaluation": {
            "winner_metrics": {key: float(winner[key]) for key in _scoring()},
            "confusion_matrix": matrix.tolist(),
            "labels": labels,
            "classification_report": report,
            "professor_photos": {
                "hits": int(winner["fotos_professor"]),
                "total": int(winner["fotos_professor_total"]),
            },
            "extra_photos": {"hits": int(winner["fotos_extras"]), "total": int(winner["fotos_extras_total"])},
            "test_predictions": test_predictions,
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


def train_final_model(X: pd.DataFrame, y: np.ndarray, winner: pd.Series) -> Pipeline:
    print(f"[5] Modelo final: {winner['modelo']} treinado com todas as {len(y)} fotos do res.csv")
    pipeline = build_model(winner["algoritmo"], winner["cenario"]).fit(X, y)
    _atomic_joblib_dump(
        {
            "modelo": pipeline,
            "colunas": list(HISTOGRAM_FEATURES),
            "entrada": FEATURE_SCHEMA_VERSION,
            "algoritmo": winner["modelo"],
            "atributos": winner["cenario"],
            "n_atributos": len(COLOR_SHAPE_FEATURES) if winner["cenario"] == "formato da cor" else len(HISTOGRAM_FEATURES),
            "metricas": {
                "acuracia": float(winner["accuracy"]),
                "acuracia_bal": float(winner["balanced_accuracy"]),
                "precisao_sujo": float(winner["precision_sujo"]),
                "recall_sujo": float(winner["recall_sujo"]),
                "f1_macro": float(winner["f1_macro"]),
                "fotos_professor": f"{winner['fotos_professor']}/{winner['fotos_professor_total']}",
            },
            "versao_sklearn": version("scikit-learn"),
        },
        WATER_MODEL_PATH,
    )
    return pipeline


def run_pipeline(*, evaluate_only: bool = False) -> dict[str, object]:
    frame, target = load_dataset(DATASET_PATH)
    X, y = preprocess(frame, target)
    tests = load_test_photos()
    results = evaluate_models(X, y, tests)
    winner = choose_winner(results)
    matrix, labels, report = evaluate_winner_predictions(X, y, winner)
    final = build_model(winner["algoritmo"], winner["cenario"]).fit(X, y)
    test_predictions = test_photo_predictions(final, tests)
    metadata = build_metadata(
        y=y, results=results, winner=winner, matrix=matrix, labels=labels, report=report,
        test_predictions=test_predictions,
    )
    if evaluate_only:
        return metadata

    results.to_csv(RESULTS_PATH, index=False)
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(test_predictions).to_csv(REPORTS_DIR / "fotos_de_teste.csv", index=False)
    plot_class_distribution(y)
    plot_confusion(matrix, labels, winner["modelo"])
    write_json(MODEL_METADATA_PATH, metadata)
    train_final_model(X, y, winner)
    return metadata


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--evaluate-only",
        action="store_true",
        help="executa a avaliação sem gravar artefatos nem substituir modelo_agua.pkl",
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
