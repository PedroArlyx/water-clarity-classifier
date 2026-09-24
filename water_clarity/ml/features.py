"""Validação de imagens e extração reproduzível de características RGB."""

from __future__ import annotations

import io
import warnings
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Mapping

import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

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
STATISTICS = ("mean", "std", "p10", "p25", "median", "p75", "p90")
STATISTICAL_FEATURES = tuple(f"{channel}_{stat}" for channel in CHANNELS for stat in STATISTICS)
CROSS_CHANNEL_FEATURES = (
    "brightness",
    "rg_difference",
    "rb_difference",
    "gb_difference",
    "channel_mean_spread",
)
FEATURE_SCHEMA_VERSION = "rgb-histogram-stats-v2"
FEATURE_COLUMNS = HISTOGRAM_FEATURES + STATISTICAL_FEATURES + CROSS_CHANNEL_FEATURES
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


def _percentile_from_histogram(histogram: np.ndarray, percentile: float) -> float:
    cumulative = np.cumsum(histogram)
    if cumulative[-1] <= 0:
        return 0.0
    position = percentile * cumulative[-1]
    return float(np.searchsorted(cumulative, position, side="left"))


def _normalized_histogram(values: np.ndarray) -> np.ndarray:
    values = np.asarray(values, dtype=float)
    total = float(values.sum())
    if total <= 0:
        raise ValueError("Histograma RGB com soma zero.")
    return values / total


def augment_histogram_features(features: Mapping[str, float]) -> dict[str, float]:
    """Calcula estatísticas deriváveis dos histogramas, sem quebrar treino/inferência."""
    augmented: dict[str, float] = {name: float(features[name]) for name in HISTOGRAM_FEATURES}
    intensities = np.arange(256, dtype=float)
    means: dict[str, float] = {}

    for channel in CHANNELS:
        histogram = _normalized_histogram(
            np.array([augmented[f"{channel}{index}"] for index in range(256)], dtype=float)
        )
        for index, value in enumerate(histogram):
            augmented[f"{channel}{index}"] = float(value)
        mean = float(histogram @ intensities)
        variance = float(histogram @ ((intensities - mean) ** 2))
        means[channel] = mean
        augmented[f"{channel}_mean"] = mean
        augmented[f"{channel}_std"] = variance**0.5
        augmented[f"{channel}_p10"] = _percentile_from_histogram(histogram, 0.10)
        augmented[f"{channel}_p25"] = _percentile_from_histogram(histogram, 0.25)
        augmented[f"{channel}_median"] = _percentile_from_histogram(histogram, 0.50)
        augmented[f"{channel}_p75"] = _percentile_from_histogram(histogram, 0.75)
        augmented[f"{channel}_p90"] = _percentile_from_histogram(histogram, 0.90)

    augmented["brightness"] = 0.2126 * means["r"] + 0.7152 * means["g"] + 0.0722 * means["b"]
    augmented["rg_difference"] = means["r"] - means["g"]
    augmented["rb_difference"] = means["r"] - means["b"]
    augmented["gb_difference"] = means["g"] - means["b"]
    augmented["channel_mean_spread"] = max(means.values()) - min(means.values())
    return augmented


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

    return augment_histogram_features(histogram_features), tuple(means)  # type: ignore[return-value]


def features_from_histogram_row(row: Mapping[str, float]) -> dict[str, float]:
    return augment_histogram_features({name: float(row[name]) for name in HISTOGRAM_FEATURES})


def to_feature_vector(features: Mapping[str, float], columns: list[str] | tuple[str, ...]) -> list[float]:
    missing = [column for column in columns if column not in features]
    if missing:
        raise ValueError(f"Schema incompatível; atributos ausentes: {missing[:5]}")
    return [float(features[column]) for column in columns]


def schema_document() -> dict[str, object]:
    return {
        "version": FEATURE_SCHEMA_VERSION,
        "feature_count": len(FEATURE_COLUMNS),
        "features": list(FEATURE_COLUMNS),
        "baseline": {
            "description": "Histogramas RGB normalizados, 256 bins por canal.",
            "features": list(HISTOGRAM_FEATURES),
        },
        "engineered": {
            "description": "Estatísticas derivadas exclusivamente dos histogramas RGB.",
            "features": list(STATISTICAL_FEATURES + CROSS_CHANNEL_FEATURES),
        },
    }
