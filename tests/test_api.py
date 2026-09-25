from __future__ import annotations

import io

import pytest

from water_clarity.settings import PROJECT_ROOT


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        ("/api/v1/health", 200),
        ("/api/v1/model", 200),
        ("/api/v1/model/metadata", 200),
        ("/api/v1/model/metrics", 200),
    ],
)
def test_read_endpoints(client, path, expected):
    response = client.get(path)
    assert response.status_code == expected
    assert response.is_json


def test_missing_image_returns_json_400(client):
    response = client.post("/api/v1/predictions", data={}, content_type="multipart/form-data")
    assert response.status_code == 400
    assert response.get_json()["error"]["code"] == "missing_image"


def test_corrupt_image_returns_422_not_500(client):
    response = client.post(
        "/api/v1/predictions",
        data={"image": (io.BytesIO(b"invalid"), "fake.jpg", "image/jpeg")},
        content_type="multipart/form-data",
    )
    assert response.status_code == 422
    assert response.get_json()["error"]["code"] == "invalid_image"


def test_false_extension_returns_415(client, png_bytes):
    response = client.post(
        "/api/v1/predictions",
        data={"image": (io.BytesIO(png_bytes), "fake.jpg", "image/png")},
        content_type="multipart/form-data",
    )
    assert response.status_code == 415
    assert response.get_json()["error"]["code"] == "media_type_mismatch"


@pytest.mark.parametrize(("filename", "expected"), [("limpo2.jpg", "limpo"), ("sujo19.jpg", "sujo")])
def test_real_images_reach_the_model(client, filename, expected):
    with (PROJECT_ROOT / filename).open("rb") as image:
        response = client.post(
            "/api/v1/predictions",
            data={"image": (image, filename, "image/jpeg")},
            content_type="multipart/form-data",
        )
    body = response.get_json()["data"]
    assert response.status_code == 200
    assert body["classification"] == expected
    assert body["model"]
    assert len(body["features"]["mean_rgb"]) == 3
    assert "potabilidade" in body["warning"]


def test_request_body_limit_returns_413():
    from water_clarity import create_app

    app = create_app({"TESTING": True, "MAX_CONTENT_LENGTH": 512})
    response = app.test_client().post(
        "/api/v1/predictions",
        data={"image": (io.BytesIO(b"x" * 1024), "large.jpg", "image/jpeg")},
        content_type="multipart/form-data",
    )
    assert response.status_code == 413
    assert response.get_json()["error"]["code"] == "request_too_large"


def test_metadata_matches_saved_artifact(client):
    metadata = client.get("/api/v1/model/metadata").get_json()["data"]
    assert metadata["dataset"]["samples"] == 61
    assert metadata["feature_schema"]["count"] == 794
    assert metadata["primary_metric"] == "f1_macro"


def test_prediction_exposes_real_pipeline_details(client):
    with (PROJECT_ROOT / "limpo2.jpg").open("rb") as image:
        body = client.post(
            "/api/v1/predictions",
            data={"image": (image, "limpo2.jpg", "image/jpeg")},
            content_type="multipart/form-data",
        ).get_json()["data"]
    features = body["features"]
    assert features["count"] == 794
    assert features["histogram_count"] == 768
    assert features["engineered_count"] == 26
    for channel in ("r", "g", "b"):
        assert len(features["histogram"][channel]) == 32
        assert abs(sum(features["histogram"][channel]) - 1) < 1e-3
    assert body["pipeline"] and all(step["estimator"] for step in body["pipeline"])
    assert set(body["probabilities"]) == {"limpo", "sujo"}
    assert abs(sum(body["probabilities"].values()) - 1) < 1e-3
