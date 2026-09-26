"""Validação de imagens e extração do histograma RGB (768 bins) usado pelo modelo_agua."""

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
FEATURE_SCHEMA_VERSION = "rgb-histogram-v1"
FEATURE_COLUMNS = HISTOGRAM_FEATURES
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

