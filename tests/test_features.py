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




def test_color_shape_separates_neutral_from_colored_water():
    from water_clarity.ml.features import COLOR_SHAPE_FEATURES, color_shape_features

    rng = np.random.default_rng(0)
    neutral = rng.integers(90, 170, size=(60, 60, 1)).repeat(3, axis=2).astype(np.uint8)  # R = G = B
    tinted = neutral.copy()
    tinted[20:40, 20:40, 2] = 230  # "morro" só no azul, como água colorida
    shapes = color_shape_features(
        np.vstack([Image.fromarray(img).histogram() for img in (neutral, tinted)])
    )
    assert shapes.shape == (2, len(COLOR_SHAPE_FEATURES)) == (2, 78)
    assert np.abs(shapes[0, :75]).max() < 1e-9
    assert np.abs(shapes[1, :75]).mean() > 0.05


def test_color_shape_does_not_depend_on_image_size():
    from water_clarity.ml.features import color_shape_features

    small = Image.new("RGB", (10, 10), color=(30, 90, 160))
    large = small.resize((100, 100), Image.NEAREST)
    assert np.allclose(
        color_shape_features(np.array([small.histogram()])),
        color_shape_features(np.array([large.histogram()])),
    )
