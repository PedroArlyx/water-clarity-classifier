from __future__ import annotations

import io

import pytest
from PIL import Image

from water_clarity import create_app


@pytest.fixture()
def app():
    return create_app({"TESTING": True})


@pytest.fixture()
def client(app):
    return app.test_client()


@pytest.fixture()
def png_bytes():
    buffer = io.BytesIO()
    Image.new("RGB", (64, 48), color=(120, 170, 190)).save(buffer, format="PNG")
    return buffer.getvalue()

