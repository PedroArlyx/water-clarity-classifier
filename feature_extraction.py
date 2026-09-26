"""Camada de compatibilidade para o extrator RGB original."""

from __future__ import annotations

from water_clarity.ml.features import (
    extract_features_from_image,
    read_limited,
    to_feature_vector,
    validate_image_bytes,
)


def extract_rgb_histogram(file_stream):
    payload = read_limited(file_stream)
    filename = getattr(file_stream, "name", "upload.jpg")
    image, _ = validate_image_bytes(payload, filename=filename, declared_mime=None)
    return extract_features_from_image(image)


__all__ = ["extract_rgb_histogram", "to_feature_vector"]
