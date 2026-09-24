"""API HTTP versionada do classificador."""

from __future__ import annotations

import csv

from flask import Blueprint, jsonify, request

from water_clarity.errors import InvalidImageError
from water_clarity.ml.service import model_service
from water_clarity.settings import RESULTS_PATH

api = Blueprint("api", __name__, url_prefix="/api/v1")


def _uploaded_image():
    file = request.files.get("image") or request.files.get("imagem")
    if file is None or not file.filename:
        raise InvalidImageError(
            "Envie uma imagem no campo 'image'.",
            status_code=400,
            code="missing_image",
        )
    return file


@api.get("/health")
def health():
    try:
        metadata = model_service.metadata()
        status = "healthy"
        model_ready = True
    except Exception:
        metadata = None
        status = "degraded"
        model_ready = False
    return jsonify(
        {
            "status": status,
            "service": "water-clarity-classifier",
            "model_ready": model_ready,
            "model": metadata.get("model_name") if metadata else None,
        }
    ), (200 if model_ready else 503)


@api.post("/predictions")
def create_prediction():
    file = _uploaded_image()
    prediction = model_service.predict_upload(
        file.stream,
        filename=file.filename,
        declared_mime=file.mimetype,
    )
    return jsonify({"data": prediction.to_dict()}), 200


@api.get("/model")
def model_summary():
    metadata = model_service.metadata()
    return jsonify(
        {
            "data": {
                "name": metadata.get("model_name"),
                "trained_at": metadata.get("trained_at"),
                "dataset": metadata.get("dataset"),
                "feature_schema": metadata.get("feature_schema"),
                "primary_metric": metadata.get("primary_metric"),
                "warning": metadata.get("visual_only_warning"),
            }
        }
    )


@api.get("/model/metadata")
def model_metadata():
    return jsonify({"data": model_service.metadata()})


@api.get("/model/metrics")
def model_metrics():
    rows: list[dict[str, object]] = []
    if RESULTS_PATH.exists():
        with RESULTS_PATH.open(encoding="utf-8", newline="") as handle:
            for source_row in csv.DictReader(handle):
                row = dict(source_row)
                parsed: dict[str, object] = {"modelo": row.pop("modelo")}
                for key, value in row.items():
                    try:
                        parsed[key] = float(value)
                    except (TypeError, ValueError):
                        parsed[key] = value
                rows.append(parsed)
    return jsonify(
        {
            "data": {
                "primary_metric": model_service.metadata().get("primary_metric", "f1_macro"),
                "models": rows,
            }
        }
    )

