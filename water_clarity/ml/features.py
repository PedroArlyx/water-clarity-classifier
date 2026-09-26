"""Validação de imagens e extração de características de cor.

A foto vira um histograma RGB de 768 valores, no mesmo formato do ``res.csv``. O
``ColorShapeTransformer`` (formato da cor) fica dentro do pipeline do modelo, então
treino e aplicação recebem exatamente o mesmo tratamento.
"""

from __future__ import annotations

import io
import warnings
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO

import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError
from sklearn.base import BaseEstimator, TransformerMixin

from water_clarity.errors import InvalidImageError
from water_clarity.settings import (
    ALLOWED_EXTENSIONS,
    ALLOWED_MIME_TYPES,
    ALLOWED_PIL_FORMATS,
    MAX_IMAGE_PIXELS,
    MAX_IMAGE_SIDE,
    MAX_UPLOAD_BYTES,
)

CHANNELS = ("r", "g", "b")
HISTOGRAM_FEATURES = tuple(f"{channel}{index}" for channel in CHANNELS for index in range(256))
FEATURE_SCHEMA_VERSION = "rgb-histogram-768"
EXTENSION_FORMATS = {
    "png": "PNG",
    "jpg": "JPEG",
    "jpeg": "JPEG",
    "bmp": "BMP",
    "webp": "WEBP",
}


@dataclass(frozen=True)
class ImageInfo:
    width: int
    height: int
    format: str
    mime_type: str


def _extension(filename: str) -> str:
    return Path(filename).suffix.lower().lstrip(".")


def read_limited(stream: BinaryIO, max_bytes: int = MAX_UPLOAD_BYTES) -> bytes:
    """Lê no máximo ``max_bytes`` e rejeita corpos maiores sem persistir upload."""
    payload = stream.read(max_bytes + 1)
    if len(payload) > max_bytes:
        raise InvalidImageError(
            f"A imagem excede o limite de {max_bytes // (1024 * 1024)} MB.",
            status_code=413,
            code="image_too_large",
        )
    if not payload:
        raise InvalidImageError("O arquivo enviado está vazio.")
    return payload


def validate_image_bytes(
    payload: bytes,
    *,
    filename: str,
    declared_mime: str | None = None,
) -> tuple[Image.Image, ImageInfo]:
    """Valida extensão, MIME, assinatura, formato e dimensões da imagem."""
    extension = _extension(filename)
    if extension not in ALLOWED_EXTENSIONS:
        raise InvalidImageError(
            "Formato não permitido. Use PNG, JPG, JPEG, BMP ou WebP.",
            status_code=415,
            code="unsupported_media_type",
        )
    if declared_mime and declared_mime.lower() not in ALLOWED_MIME_TYPES:
        raise InvalidImageError(
            "O tipo MIME informado não corresponde a uma imagem aceita.",
            status_code=415,
            code="unsupported_media_type",
        )

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            probe = Image.open(io.BytesIO(payload))
            detected_format = (probe.format or "").upper()
            width, height = probe.size
            probe.verify()
    except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise InvalidImageError("O arquivo está corrompido ou não contém uma imagem válida.") from exc

    if detected_format not in ALLOWED_PIL_FORMATS:
        raise InvalidImageError(
            "O conteúdo da imagem usa um formato não permitido.",
            status_code=415,
            code="unsupported_media_type",
        )
    if EXTENSION_FORMATS[extension] != detected_format:
        raise InvalidImageError(
            "A extensão do arquivo não corresponde ao conteúdo da imagem.",
            status_code=415,
            code="media_type_mismatch",
        )
    if width <= 0 or height <= 0 or width > MAX_IMAGE_SIDE or height > MAX_IMAGE_SIDE:
        raise InvalidImageError(
            f"As dimensões máximas permitidas são {MAX_IMAGE_SIDE} × {MAX_IMAGE_SIDE} pixels.",
            status_code=413,
            code="image_dimensions_too_large",
        )
    if width * height > MAX_IMAGE_PIXELS:
        raise InvalidImageError(
            f"A imagem excede o limite de {MAX_IMAGE_PIXELS:,} pixels.",
            status_code=413,
            code="image_dimensions_too_large",
        )

    try:
        image = Image.open(io.BytesIO(payload))
        image = ImageOps.exif_transpose(image).convert("RGB")
        image.load()
    except (UnidentifiedImageError, OSError, SyntaxError) as exc:
        raise InvalidImageError("Não foi possível decodificar a imagem enviada.") from exc

    actual_mime = Image.MIME.get(detected_format, "application/octet-stream")
    if declared_mime and declared_mime.lower() != actual_mime.lower():
        raise InvalidImageError(
            "O tipo MIME informado não corresponde ao conteúdo da imagem.",
            status_code=415,
            code="media_type_mismatch",
        )
    return image, ImageInfo(width, height, detected_format, actual_mime)


def extract_features_from_image(image: Image.Image) -> tuple[dict[str, float], tuple[float, float, float]]:
    rgb = image.convert("RGB")
    array = np.asarray(rgb)
    pixel_count = array.shape[0] * array.shape[1]
    histogram_features: dict[str, float] = {}
    means: list[float] = []

    for channel_index, channel in enumerate(CHANNELS):
        channel_values = array[:, :, channel_index]
        histogram = np.bincount(channel_values.ravel(), minlength=256).astype(float) / pixel_count
        histogram_features.update(
            {f"{channel}{index}": float(count) for index, count in enumerate(histogram)}
        )
        means.append(float(channel_values.mean()))

    return histogram_features, tuple(means)  # type: ignore[return-value]



# 25 percentis por canal: 2%, 6%, ..., 98%
SHAPE_PERCENTILES = tuple(round(0.02 + 0.04 * index, 2) for index in range(25))
_PAIRS = (("r", "g"), ("g", "b"), ("r", "b"))
COLOR_SHAPE_FEATURES = tuple(
    f"{first}-{second}_p{round(q * 100):02d}" for first, second in _PAIRS for q in SHAPE_PERCENTILES
) + tuple(f"contraste_{channel}" for channel in CHANNELS)


def color_shape_features(histograms: np.ndarray) -> np.ndarray:
    """Transforma histogramas RGB (n × 768) no "formato da cor" (n × 78).

    Água limpa é transparente: a foto mostra o fundo neutro e as curvas R, G e B têm o
    mesmo formato. Água suja é colorida e cria um "morro" num canal que não aparece nos
    outros. Para cada canal calculamos 25 percentis e os padronizamos por
    ``(percentil − média) / desvio``, o que remove brilho e contraste; os atributos são as
    diferenças de formato R−G, G−B e R−B (75) e o contraste relativo de cada canal (3).

    Aceita contagens brutas (como no ``res.csv``) ou proporções: cada canal é normalizado
    pela própria soma, então o resultado não depende do tamanho da imagem.
    """
    histograms = np.asarray(histograms, dtype=float).reshape(-1, len(CHANNELS), 256)
    totals = histograms.sum(axis=2, keepdims=True)
    if np.any(totals <= 0):
        raise ValueError("Histograma RGB com soma zero.")
    proportions = histograms / totals
    intensities = np.arange(256, dtype=float)
    means = proportions @ intensities
    stds = np.sqrt(np.einsum("ncb,ncb->nc", proportions, (intensities - means[..., None]) ** 2))
    cumulative = np.cumsum(proportions, axis=2)
    percentiles = np.empty((*means.shape, len(SHAPE_PERCENTILES)))
    for row in range(cumulative.shape[0]):
        for channel in range(len(CHANNELS)):
            percentiles[row, channel] = np.searchsorted(cumulative[row, channel], SHAPE_PERCENTILES)
    shapes = (percentiles - means[..., None]) / (stds[..., None] + 1e-9)
    index = {channel: position for position, channel in enumerate(CHANNELS)}
    differences = [shapes[:, index[first]] - shapes[:, index[second]] for first, second in _PAIRS]
    contrast = stds / (stds.mean(axis=1, keepdims=True) + 1e-9)
    return np.hstack([*differences, contrast])


class ColorShapeTransformer(TransformerMixin, BaseEstimator):
    """Etapa de ``Pipeline``: histograma RGB de 768 valores → 78 atributos de formato da cor."""

    def fit(self, X, y=None):
        return self

    def transform(self, X):
        return color_shape_features(np.asarray(X, dtype=float))

    def get_feature_names_out(self, input_features=None):
        return np.asarray(COLOR_SHAPE_FEATURES, dtype=object)
