from __future__ import annotations

from train_model import PRIMARY_METRIC, get_candidate_models, load_dataset, preprocess


def test_required_algorithms_remain_available():
    assert set(get_candidate_models()) == {
        "KNN",
        "DecisionTree",
        "RandomForest",
        "NaiveBayes",
        "SVM",
        "LogisticRegression",
        "GradientBoosting",
    }
    assert PRIMARY_METRIC == "f1_macro"


def test_dataset_and_feature_transformation():
    frame, columns, target = load_dataset()
    X, y, encoder = preprocess(frame, columns, target)
    assert X.shape == (61, 794)
    assert y.shape == (61,)
    assert list(encoder.classes_) == ["limpo", "sujo"]
