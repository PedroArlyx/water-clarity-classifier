"""Páginas web e fallback sem JavaScript."""

from __future__ import annotations

import csv

from flask import Blueprint, render_template, request, send_file

from water_clarity.errors import WaterClarityError
from water_clarity.ml.service import model_service
from water_clarity.settings import (
    CLASS_DISTRIBUTION_PATH,
    CONFUSION_MATRIX_PATH,
    RESULTS_PATH,
)

web = Blueprint("web", __name__)


def _metrics() -> list[dict[str, str]]:
    if not RESULTS_PATH.exists():
        return []
    with RESULTS_PATH.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


METRICS = (
    ("accuracy", "Accuracy"),
    ("balanced_accuracy", "Balanced accuracy"),
    ("precision_macro", "Precision (macro)"),
    ("recall_macro", "Recall (macro)"),
    ("f1_macro", "F1 macro"),
    ("f1_weighted", "F1 ponderado"),
)
CHART = {"width": 640, "label": 150, "value": 70, "row": 38, "bar": 18, "top": 22}


def _float(value) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _metric_charts(metrics: list[dict[str, str]], winner: str | None) -> list[dict[str, object]]:
    """Geometria das barras horizontais (escala 0–1) calculada a partir do CSV real."""
    plot = CHART["width"] - CHART["label"] - CHART["value"]
    charts = []
    for key, label in METRICS:
        rows = [
            (row["modelo"], _float(row.get(key)), _float(row.get(f"{key}_std")))
            for row in metrics
            if _float(row.get(key)) is not None
        ]
        if not rows:
            continue
        rows.sort(key=lambda item: item[1], reverse=True)
        bars = []
        for index, (model, value, std) in enumerate(rows):
            y = CHART["top"] + index * CHART["row"]
            low = max(0.0, value - (std or 0))
            high = min(1.0, value + (std or 0))
            bars.append({
                "model": model,
                "value": value,
                "std": std,
                "winner": model == winner,
                "y": y,
                "cy": y + CHART["bar"] / 2,
                "width": max(2.0, value * plot),
                "w_low": CHART["label"] + low * plot,
                "w_high": CHART["label"] + high * plot,
            })
        charts.append({"key": key, "label": label, "bars": bars, "height": CHART["top"] + len(rows) * CHART["row"]})
    return charts


def _confusion(metadata: dict) -> dict[str, object] | None:
    evaluation = metadata.get("evaluation") or {}
    matrix = evaluation.get("confusion_matrix")
    labels = evaluation.get("labels")
    if not matrix or not labels:
        return None
    peak = max(max(row) for row in matrix) or 1
    rows = []
    for label, values in zip(labels, matrix, strict=True):
        total = sum(values) or 1
        rows.append({
            "label": label,
            "cells": [
                {"count": count, "share": count / total, "level": 0 if count == 0 else min(5, 1 + int(4 * count / peak)), "hit": label == column}
                for column, count in zip(labels, values, strict=True)
            ],
        })
    return {"labels": labels, "rows": rows, "total": sum(sum(row) for row in matrix)}


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
    metrics = _metrics()
    winner = metadata.get("model_name")
    return render_template(
        "experiment.html",
        page="experiment",
        metadata=metadata,
        metrics=metrics,
        metric_names=METRICS,
        charts=_metric_charts(metrics, winner),
        chart=CHART,
        confusion=_confusion(metadata),
        winner_row=next((row for row in metrics if row.get("modelo") == winner), None),
    )


@web.get("/artefatos/matriz-confusao.png")
def confusion_matrix_chart():
    return send_file(CONFUSION_MATRIX_PATH, mimetype="image/png", conditional=True)


@web.get("/artefatos/distribuicao-classes.png")
def class_distribution_chart():
    return send_file(CLASS_DISTRIBUTION_PATH, mimetype="image/png", conditional=True)
