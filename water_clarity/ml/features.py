"""Validação de imagens e extração de características de cor.

O modelo_agua usa a cor do centro da foto (``center_color_features``); o histograma RGB
da foto inteira continua sendo calculado só para a visualização na interface.
"""

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
FEATURE_SCHEMA_VERSION = "cor-do-centro-v1"
CENTER_FRACTION = 0.5
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


def to_feature_vector(features: Mapping[str, float], columns: list[str] | tuple[str, ...]) -> list[float]:
    missing = [column for column in columns if column not in features]
    if missing:
        raise ValueError(f"Schema incompatível; atributos ausentes: {missing[:5]}")
    return [float(features[column]) for column in columns]



CENTER_COLOR_FEATURES = (
    "sat_p10", "sat_p25", "sat_p50", "sat_p75", "sat_p90", "sat_mean", "sat_std",
    "val_p10", "val_p50", "val_p90", "val_std",
    "chroma_r", "chroma_g", "chroma_b", "chroma_r_std", "chroma_g_std", "chroma_b_std",
    "sat_above_025", "sat_above_040",
)


def center_color_features(image: Image.Image, fraction: float = CENTER_FRACTION) -> np.ndarray:
    """Estatísticas de cor do centro da foto, onde normalmente está o copo.

    Diferente do histograma da foto inteira, ignora a maior parte do fundo. É o vetor de
    entrada do modelo_agua, no treino e na inferência.
    """
    rgb_image = image.convert("RGB")
    width, height = rgb_image.size
    crop_w, crop_h = int(width * fraction), int(height * fraction)
    left, top = (width - crop_w) // 2, (height - crop_h) // 2
    center = rgb_image.crop((left, top, left + crop_w, top + crop_h)).resize((256, 256))
    rgb = np.asarray(center, dtype=float) / 255
    hsv = np.asarray(center.convert("HSV"), dtype=float) / 255
    saturation, value = hsv[..., 1].ravel(), hsv[..., 2].ravel()
    chroma = (rgb / (rgb.sum(axis=-1, keepdims=True) + 1e-6)).reshape(-1, 3)
    return np.array(
        [
            *np.percentile(saturation, [10, 25, 50, 75, 90]),
            saturation.mean(),
            saturation.std(),
            *np.percentile(value, [10, 50, 90]),
            value.std(),
            *chroma.mean(axis=0),
            *chroma.std(axis=0),
            (saturation > 0.25).mean(),
            (saturation > 0.40).mean(),
        ]
    )
