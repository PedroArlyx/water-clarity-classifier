from __future__ import annotations

from train_model import ALGORITHMS, PRIMARY_METRIC, SCENARIOS, build_model, load_dataset, preprocess


def test_required_algorithms_and_scenarios():
    assert len(ALGORITHMS) == 8
    assert set(SCENARIOS) == {"formato da cor", "histograma bruto"}
    assert [name for name, _ in build_model().steps] == ["formato", "normalizar_0_1", "modelo"]
    assert PRIMARY_METRIC == "f1_macro"


def test_training_uses_res_csv_with_50_photos():
    frame, target = load_dataset()
    X, y = preprocess(frame, target)
    assert X.shape == (50, 768)
    assert sorted(set(y)) == ["limpo", "sujo"]
