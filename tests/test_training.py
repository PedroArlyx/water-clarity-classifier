from __future__ import annotations

from train_model import PRIMARY_METRIC, build_model, load_dataset, preprocess
from water_clarity.ml.features import CENTER_COLOR_FEATURES


def test_modelo_agua_recipe():
    assert [name for name, _ in build_model().steps] == ["padronizar", "modelo"]
    assert PRIMARY_METRIC == "f1_macro"


def test_dataset_and_feature_transformation():
    frame = load_dataset()
    X, y, groups = preprocess(frame)
    assert X.shape == (len(frame), len(CENTER_COLOR_FEATURES))
    assert sorted(set(y)) == ["limpo", "sujo"]
    assert len(groups) == len(frame)
