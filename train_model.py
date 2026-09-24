"""
Pipeline KDD - Classificacao de copo de agua (limpo/sujo) a partir de RGB.

Fases do KDD aplicadas:
1. Selecao dos dados       -> carregar res.csv
2. Pre-processamento       -> limpeza, checagem de nulos/duplicados
3. Transformacao           -> separacao de features (R,G,B) e alvo (classe)
4. Mineracao de dados      -> avaliar varios classificadores com validacao cruzada
5. Interpretacao/avaliacao -> comparar metricas e escolher o vencedor
6. Modelo final            -> retreinar o vencedor com TODO o dataset (sem split)
"""

import sys
import warnings
import joblib
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from sklearn.model_selection import StratifiedKFold, cross_validate
from sklearn.preprocessing import LabelEncoder, StandardScaler
from sklearn.pipeline import Pipeline

from sklearn.linear_model import LogisticRegression
from sklearn.neighbors import KNeighborsClassifier
from sklearn.tree import DecisionTreeClassifier
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.naive_bayes import GaussianNB
from sklearn.svm import SVC

warnings.filterwarnings("ignore", category=FutureWarning)

DATA_PATH = "res.csv"
MODEL_PATH = "model/model.pkl"
RESULTS_CSV = "resultados_avaliacao.csv"
RESULTS_PNG = "comparacao_modelos.png"

TARGET_ALIASES = ["classe", "class", "label", "rotulo", "target", "y"]


def find_column(columns, aliases):
    lower = {c.lower().strip(): c for c in columns}
    for alias in aliases:
        if alias in lower:
            return lower[alias]
    return None


def load_dataset(path):
    df = pd.read_csv(path)
    print(f"[1] Selecao dos dados: {df.shape[0]} linhas, {df.shape[1]} colunas")

    col_target = find_column(df.columns, TARGET_ALIASES)
    if col_target is None:
        col_target = df.columns[-1]
        print(f"Aviso: coluna alvo nao identificada por nome, usando a ultima coluna: '{col_target}'")

    feature_cols = [c for c in df.columns if c != col_target]
    print(f"Features: {len(feature_cols)} colunas (histograma RGB) | Alvo: '{col_target}'")
    print("Distribuicao de classes:")
    print(df[col_target].value_counts())
    return df, feature_cols, col_target


def normalize_histogram(df, feature_cols):
    # As fotos de origem tem resolucoes diferentes, entao a contagem bruta de
    # pixels por bin nao e comparavel entre imagens. Convertendo cada canal
    # para frequencia relativa (soma 1 por canal), o histograma fica
    # invariante ao tamanho/resolucao da foto.
    df = df.copy()
    for prefix in ("r", "g", "b"):
        cols = [c for c in feature_cols if c.startswith(prefix)]
        total = df[cols].sum(axis=1)
        df[cols] = df[cols].div(total, axis=0)
    return df


def preprocess(df, feature_cols, col_target):
    n_before = len(df)
    df = df.dropna(subset=feature_cols + [col_target]).drop_duplicates()
    n_after = len(df)
    print(f"[2] Pre-processamento: removidas {n_before - n_after} linhas (nulos/duplicadas)")

    df = normalize_histogram(df, feature_cols)

    X = df[feature_cols].astype(float).values
    y_raw = df[col_target].astype(str).str.strip().str.lower().values

    le = LabelEncoder()
    y = le.fit_transform(y_raw)
    print(f"[3] Transformacao: histograma normalizado por canal (frequencia relativa) | classes = {list(le.classes_)}")
    return X, y, le


def get_candidate_models():
    # class_weight="balanced": dataset e pequeno e desbalanceado (sujo >> limpo)
    return {
        "KNN": KNeighborsClassifier(n_neighbors=5),
        "DecisionTree": DecisionTreeClassifier(random_state=42, class_weight="balanced"),
        "RandomForest": RandomForestClassifier(random_state=42, n_estimators=200, class_weight="balanced"),
        "NaiveBayes": GaussianNB(),
        "SVM": SVC(kernel="rbf", probability=True, random_state=42, class_weight="balanced"),
        "LogisticRegression": LogisticRegression(max_iter=1000, class_weight="balanced"),
        "GradientBoosting": GradientBoostingClassifier(random_state=42),
    }


def evaluate_models(X, y):
    print("[4] Mineracao de dados: avaliando classificadores com validacao cruzada (5-fold)")
    # 5 folds (nao 10): a classe minoritaria (limpo) tem poucas amostras no dataset.
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    scoring = ["accuracy", "precision_weighted", "recall_weighted", "f1_weighted"]

    rows = []
    for name, clf in get_candidate_models().items():
        pipe = Pipeline([("scaler", StandardScaler()), ("clf", clf)])
        scores = cross_validate(pipe, X, y, cv=cv, scoring=scoring)
        row = {
            "modelo": name,
            "acuracia": scores["test_accuracy"].mean(),
            "precisao": scores["test_precision_weighted"].mean(),
            "recall": scores["test_recall_weighted"].mean(),
            "f1": scores["test_f1_weighted"].mean(),
        }
        rows.append(row)
        print(f"  {name:20s} acc={row['acuracia']:.4f}  f1={row['f1']:.4f}")

    results = pd.DataFrame(rows).sort_values("f1", ascending=False).reset_index(drop=True)
    return results


def plot_results(results):
    fig, ax = plt.subplots(figsize=(9, 5))
    x = np.arange(len(results))
    width = 0.2
    for i, metric in enumerate(["acuracia", "precisao", "recall", "f1"]):
        ax.bar(x + i * width, results[metric], width, label=metric)
    ax.set_xticks(x + width * 1.5)
    ax.set_xticklabels(results["modelo"], rotation=20, ha="right")
    ax.set_ylim(0, 1)
    ax.set_ylabel("Score")
    ax.set_title("Comparacao de algoritmos - validacao cruzada (5-fold)")
    ax.legend()
    fig.tight_layout()
    fig.savefig(RESULTS_PNG, dpi=150)
    print(f"[5] Grafico comparativo salvo em {RESULTS_PNG}")


def train_final_model(X, y, winner_name, le, feature_cols):
    print(f"[6] Modelo final: retreinando '{winner_name}' com TODO o dataset (sem split)")
    clf = get_candidate_models()[winner_name]
    pipe = Pipeline([("scaler", StandardScaler()), ("clf", clf)])
    pipe.fit(X, y)

    joblib.dump(
        {
            "pipeline": pipe,
            "label_encoder": le,
            "model_name": winner_name,
            "feature_columns": feature_cols,
        },
        MODEL_PATH,
    )
    print(f"Modelo final salvo em {MODEL_PATH}")


def main():
    df, feature_cols, col_target = load_dataset(DATA_PATH)
    X, y, le = preprocess(df, feature_cols, col_target)

    results = evaluate_models(X, y)
    results.to_csv(RESULTS_CSV, index=False)
    print(f"\nResultados completos salvos em {RESULTS_CSV}")
    print(results.to_string(index=False))

    plot_results(results)

    winner = results.iloc[0]["modelo"]
    print(f"\n>>> Algoritmo vencedor: {winner} (f1={results.iloc[0]['f1']:.4f}) <<<\n")

    train_final_model(X, y, winner, le, feature_cols)


if __name__ == "__main__":
    main()
