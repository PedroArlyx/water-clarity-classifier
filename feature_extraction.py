import numpy as np
from PIL import Image

CHANNELS = ("r", "g", "b")


def extract_rgb_histogram(file_stream):
    """Retorna dict {r0..r255, g0..g255, b0..b255} = frequencia relativa de
    pixels por intensidade em cada canal (soma 1 por canal). Normalizar pelo
    total de pixels torna o histograma invariante ao tamanho/resolucao da
    foto, igual ao pre-processamento usado para gerar res.csv."""
    img = Image.open(file_stream).convert("RGB")
    arr = np.asarray(img)
    total_pixels = arr.shape[0] * arr.shape[1]

    features = {}
    for i, ch in enumerate(CHANNELS):
        hist = np.bincount(arr[:, :, i].ravel(), minlength=256)
        for bin_idx, count in enumerate(hist):
            features[f"{ch}{bin_idx}"] = count / total_pixels

    means = (arr[:, :, 0].mean(), arr[:, :, 1].mean(), arr[:, :, 2].mean())
    return features, means


def to_feature_vector(features, feature_columns):
    return [features[col] for col in feature_columns]
