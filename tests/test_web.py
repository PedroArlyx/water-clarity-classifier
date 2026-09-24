from __future__ import annotations

import pytest


@pytest.mark.parametrize(
    ("path", "marker"),
    [
        ("/", "Modo clássico"),
        ("/demonstracao", "Cozinha interativa"),
        ("/experimento", "Etapas KDD implementadas"),
    ],
)
def test_pages_render(client, path, marker):
    response = client.get(path)
    assert response.status_code == 200
    assert marker.encode() in response.data


def test_security_headers_are_applied(client):
    response = client.get("/")
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert "script-src 'self'" in response.headers["Content-Security-Policy"]


def test_unknown_page_uses_friendly_error(client):
    response = client.get("/nao-existe")
    assert response.status_code == 404
    assert "Página não encontrada".encode() in response.data


@pytest.mark.parametrize(
    "path",
    [
        "/artefatos/comparacao-modelos.png",
        "/artefatos/matriz-confusao.png",
        "/artefatos/distribuicao-classes.png",
        "/static/vendor/three.module.js",
        "/static/vendor/three.core.js",
    ],
)
def test_dashboard_and_3d_artifacts_are_served(client, path):
    assert client.get(path).status_code == 200
