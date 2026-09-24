"""Páginas web e fallback sem JavaScript."""

from __future__ import annotations

import csv

from flask import Blueprint, render_template, request, send_file

from water_clarity.errors import WaterClarityError
from water_clarity.ml.service import model_service
from water_clarity.settings import (
    CLASS_DISTRIBUTION_PATH,
    COMPARISON_CHART_PATH,
    CONFUSION_MATRIX_PATH,
    RESULTS_PATH,
)

web = Blueprint("web", __name__)


def _metrics() -> list[dict[str, str]]:
    if not RESULTS_PATH.exists():
        return []
    with RESULTS_PATH.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


@web.get("/")
def index():
    return render_template("index.html", page="classic")


@web.post("/predict")
def predict_fallback():
    file = request.files.get("imagem")
    if file is None or not file.filename:
        return render_template(
            "index.html",
            page="classic",
            error="Selecione uma imagem antes de enviar.",
        ), 400
    try:
        prediction = model_service.predict_upload(
            file.stream,
            filename=file.filename,
            declared_mime=file.mimetype,
        )
    except WaterClarityError as exc:
        return render_template("index.html", page="classic", error=exc.message), exc.status_code
    return render_template("index.html", page="classic", result=prediction.to_dict())


@web.get("/demonstracao")
def demonstration():
    return render_template("demonstration.html", page="demo")


@web.get("/experimento")
def experiment():
    try:
        metadata = model_service.metadata()
    except WaterClarityError as exc:
        metadata = {"warning": exc.message}
    return render_template(
        "experiment.html",
        page="experiment",
        metadata=metadata,
        metrics=_metrics(),
    )


@web.get("/artefatos/comparacao-modelos.png")
def comparison_chart():
    return send_file(COMPARISON_CHART_PATH, mimetype="image/png", conditional=True)


@web.get("/artefatos/matriz-confusao.png")
def confusion_matrix_chart():
    return send_file(CONFUSION_MATRIX_PATH, mimetype="image/png", conditional=True)


@web.get("/artefatos/distribuicao-classes.png")
def class_distribution_chart():
    return send_file(CLASS_DISTRIBUTION_PATH, mimetype="image/png", conditional=True)
