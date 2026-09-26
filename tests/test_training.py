from __future__ import annotations

from train_model import K_FEATURES, PRIMARY_METRIC, build_model, load_dataset, preprocess


def test_modelo_agua_recipe():
    assert [name for name, _ in build_model().steps] == ["normalizar", "selecionar", "modelo"]
    assert K_FEATURES == 500
    assert PRIMARY_METRIC == "f1_macro"


def test_dataset_and_feature_transformation():
    frame, columns, target = load_dataset()
    X, y = preprocess(frame, columns, target)
    assert X.shape == (65, 768)
    assert y.shape == (65,)
    assert sorted(set(y)) == ["limpo", "sujo"]
