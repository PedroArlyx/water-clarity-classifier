"""Configuração central e caminhos independentes do diretório de execução."""

from __future__ import annotations

import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
MODEL_DIR = PROJECT_ROOT / "model"
MODEL_PATH = MODEL_DIR / "classifier.joblib"
LEGACY_MODEL_PATH = MODEL_DIR / "model.pkl"
MODEL_METADATA_PATH = MODEL_DIR / "metadata.json"
EVALUATION_METADATA_PATH = MODEL_DIR / "evaluation_latest.json"
FEATURE_SCHEMA_PATH = MODEL_DIR / "feature_schema.json"
RESULTS_PATH = PROJECT_ROOT / "resultados_avaliacao.csv"
CONFUSION_MATRIX_PATH = PROJECT_ROOT / "matriz_confusao.png"
COMPARISON_CHART_PATH = PROJECT_ROOT / "comparacao_modelos.png"
CLASS_DISTRIBUTION_PATH = PROJECT_ROOT / "distribuicao_classes.png"
DATASET_PATH = PROJECT_ROOT / "res.csv"

MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", 16 * 1024 * 1024))
MAX_IMAGE_PIXELS = int(os.getenv("MAX_IMAGE_PIXELS", 20_000_000))
MAX_IMAGE_SIDE = int(os.getenv("MAX_IMAGE_SIDE", 8_192))

ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "bmp", "webp"}
ALLOWED_MIME_TYPES = {
    "image/png",
    "image/jpeg",
    "image/bmp",
    "image/webp",
}
ALLOWED_PIL_FORMATS = {"PNG", "JPEG", "BMP", "WEBP"}
