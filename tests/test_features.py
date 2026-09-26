from __future__ import annotations

import io

import numpy as np
import pytest
from PIL import Image

from water_clarity.errors import InvalidImageError
from water_clarity.ml.features import (
    HISTOGRAM_FEATURES,
    extract_features_from_image,
    validate_image_bytes,
)


def test_histograms_are_normalized_and_schema_is_complete():
    image = Image.new("RGB", (10, 10), color=(10, 20, 30))
    features, means = extract_features_from_image(image)
    assert len(HISTOGRAM_FEATURES) == 768
    assert set(features) == set(HISTOGRAM_FEATURES)
    for channel in "rgb":
        assert sum(features[f"{channel}{index}"] for index in range(256)) == pytest.approx(1.0)
    assert means == pytest.approx((10.0, 20.0, 30.0))


def test_histogram_feature_order_remains_rgb_baseline():
    assert HISTOGRAM_FEATURES[0] == "r0"
    assert HISTOGRAM_FEATURES[255] == "r255"
    assert HISTOGRAM_FEATURES[256] == "g0"
    assert HISTOGRAM_FEATURES[-1] == "b255"


def test_corrupt_image_is_rejected():
    with pytest.raises(InvalidImageError, match="corrompido"):
        validate_image_bytes(b"not an image", filename="fake.jpg", declared_mime="image/jpeg")


def test_extension_spoofing_is_rejected(png_bytes):
    with pytest.raises(InvalidImageError, match="extensão"):
        validate_image_bytes(png_bytes, filename="fake.jpg", declared_mime="image/png")


def test_mime_spoofing_is_rejected(png_bytes):
    with pytest.raises(InvalidImageError, match="MIME"):
        validate_image_bytes(png_bytes, filename="valid.png", declared_mime="image/jpeg")


def test_excessive_dimensions_are_rejected():
    buffer = io.BytesIO()
    Image.fromarray(np.zeros((1, 8193, 3), dtype=np.uint8)).save(buffer, format="PNG")
    with pytest.raises(InvalidImageError, match="dimensões"):
        validate_image_bytes(buffer.getvalue(), filename="wide.png", declared_mime="image/png")



def test_center_color_features_ignore_the_border():
    from water_clarity.ml.features import CENTER_COLOR_FEATURES, center_color_features

    image = Image.new("RGB", (100, 100), color=(200, 30, 30))  # borda vermelha saturada
    image.paste((240, 240, 240), (25, 25, 75, 75))  # centro neutro, como água limpa
    features = center_color_features(image)
    assert features.shape == (len(CENTER_COLOR_FEATURES),)
    assert features[CENTER_COLOR_FEATURES.index("sat_mean")] == pytest.approx(0.0, abs=0.01)
