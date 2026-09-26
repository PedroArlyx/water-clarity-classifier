"""Configuração central e caminhos independentes do diretório de execução."""

from __future__ import annotations

import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
MODEL_DIR = PROJECT_ROOT / "model"
# Único artefato de classificação da água (limpo/sujo), gerado por train_model.py.
WATER_MODEL_PATH = MODEL_DIR / "modelo_agua.pkl"
MODEL_METADATA_PATH = MODEL_DIR / "metadata.json"
RESULTS_PATH = PROJECT_ROOT / "resultados_avaliacao.csv"
CONFUSION_MATRIX_PATH = PROJECT_ROOT / "matriz_confusao.png"
CLASS_DISTRIBUTION_PATH = PROJECT_ROOT / "distribuicao_classes.png"
DATASET_PATH = PROJECT_ROOT / "res.csv"
CATALOG_PATH = PROJECT_ROOT / "data" / "metadata" / "images.csv"
REPORTS_DIR = PROJECT_ROOT / "data" / "reports"

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
