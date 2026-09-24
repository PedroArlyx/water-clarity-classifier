import os
import joblib
import numpy as np
from flask import Flask, render_template, request

from feature_extraction import extract_rgb_histogram, to_feature_vector

MODEL_PATH = "model/model.pkl"
ALLOWED_EXT = {"png", "jpg", "jpeg", "bmp", "webp"}

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024  # 16 MB (fotos de celular ~12MP)

_bundle = None


def get_bundle():
    global _bundle
    if _bundle is None:
        if not os.path.exists(MODEL_PATH):
            raise FileNotFoundError(
                f"Modelo nao encontrado em {MODEL_PATH}. Rode 'python train_model.py' primeiro."
            )
        _bundle = joblib.load(MODEL_PATH)
    return _bundle


def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXT


@app.route("/", methods=["GET"])
def index():
    return render_template("index.html")


@app.route("/predict", methods=["POST"])
def predict():
    file = request.files.get("imagem")
    if file is None or file.filename == "":
        return render_template("index.html", error="Selecione uma imagem antes de enviar.")

    if not allowed_file(file.filename):
        return render_template("index.html", error="Formato de arquivo nao suportado.")

    try:
        bundle = get_bundle()
    except FileNotFoundError as e:
        return render_template("index.html", error=str(e))

    features, (r, g, b) = extract_rgb_histogram(file.stream)
    pipeline = bundle["pipeline"]
    le = bundle["label_encoder"]
    model_name = bundle["model_name"]
    feature_columns = bundle["feature_columns"]

    X = np.array([to_feature_vector(features, feature_columns)])

    pred = pipeline.predict(X)[0]
    label = le.inverse_transform([pred])[0]

    proba = None
    if hasattr(pipeline, "predict_proba"):
        probs = pipeline.predict_proba(X)[0]
        proba = round(float(np.max(probs)) * 100, 1)

    return render_template(
        "index.html",
        result=label,
        rgb=(round(r, 1), round(g, 1), round(b, 1)),
        model_name=model_name,
        proba=proba,
    )


if __name__ == "__main__":
    app.run(debug=True)
