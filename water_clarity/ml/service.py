"""Carregamento auditável do modelo e serviço único de inferência."""

from __future__ import annotations

import json
import threading
from dataclasses import asdict, dataclass
from pathlib import Path

import joblib
import numpy as np

from water_clarity.errors import ModelUnavailableError
from water_clarity.ml.features import (
    extract_features_from_image,
    read_limited,
    to_feature_vector,
    validate_image_bytes,
)
from water_clarity.settings import LEGACY_MODEL_PATH, MODEL_METADATA_PATH, MODEL_PATH

VISUAL_ONLY_WARNING = (
    "Resultado baseado somente na aparência visual; não confirma potabilidade, "
    "segurança química ou microbiológica."
)


@dataclass(frozen=True)
class Prediction:
    classification: str
    confidence: float | None
    model: str
    mean_rgb: tuple[float, float, float]
    image: dict[str, object]
    warning: str = VISUAL_ONLY_WARNING

    def to_dict(self) -> dict[str, object]:
        payload = asdict(self)
        payload["features"] = {"mean_rgb": list(self.mean_rgb)}
        payload.pop("mean_rgb")
        return payload


class ModelService:
    """Repositório lazy e thread-safe para o artefato confiável do projeto."""

    def __init__(self, model_path: Path = MODEL_PATH):
        self.model_path = model_path
        self._bundle: dict[str, object] | None = None
        self._lock = threading.Lock()

    def _resolved_model_path(self) -> Path:
        if self.model_path.exists():
            return self.model_path
        if self.model_path == MODEL_PATH and LEGACY_MODEL_PATH.exists():
            return LEGACY_MODEL_PATH
        raise ModelUnavailableError(
            "Modelo não encontrado. Execute 'python train_model.py' antes de iniciar a aplicação."
        )

    def bundle(self) -> dict[str, object]:
        if self._bundle is None:
            with self._lock:
                if self._bundle is None:
                    try:
                        loaded = joblib.load(self._resolved_model_path())
                    except Exception as exc:
                        raise ModelUnavailableError(
                            "O modelo não pôde ser carregado. Treine-o novamente no ambiente atual."
                        ) from exc
                    required = {"pipeline", "label_encoder", "model_name", "feature_columns"}
                    if not isinstance(loaded, dict) or not required.issubset(loaded):
                        raise ModelUnavailableError("O artefato do modelo possui formato incompatível.")
                    self._bundle = loaded
        return self._bundle

    def reset(self) -> None:
        with self._lock:
            self._bundle = None

    def metadata(self) -> dict[str, object]:
        if MODEL_METADATA_PATH.exists():
            return json.loads(MODEL_METADATA_PATH.read_text(encoding="utf-8"))
        bundle = self.bundle()
        return {
            "artifact_format": "legacy",
            "model_name": bundle["model_name"],
            "feature_count": len(bundle["feature_columns"]),
            "warning": "Artefato legado sem metadata.json; execute novamente o treinamento.",
        }

    def predict_upload(self, stream, *, filename: str, declared_mime: str | None) -> Prediction:
        payload = read_limited(stream)
        image, image_info = validate_image_bytes(
            payload,
            filename=filename,
            declared_mime=declared_mime,
        )
        features, mean_rgb = extract_features_from_image(image)
        bundle = self.bundle()
        columns = list(bundle["feature_columns"])
        vector = np.asarray([to_feature_vector(features, columns)], dtype=float)
        pipeline = bundle["pipeline"]
        encoder = bundle["label_encoder"]
        prediction = pipeline.predict(vector)[0]
        label = str(encoder.inverse_transform([prediction])[0])

        confidence = None
        if hasattr(pipeline, "predict_proba"):
            probabilities = pipeline.predict_proba(vector)[0]
            confidence = round(float(np.max(probabilities)), 4)

        return Prediction(
            classification=label,
            confidence=confidence,
            model=str(bundle["model_name"]),
            mean_rgb=tuple(round(value, 2) for value in mean_rgb),
            image={
                "width": image_info.width,
                "height": image_info.height,
                "format": image_info.format,
                "mime_type": image_info.mime_type,
            },
        )


model_service = ModelService()
