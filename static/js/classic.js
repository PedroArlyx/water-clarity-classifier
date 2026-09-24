"use strict";

const form = document.querySelector("#classification-form");
const input = document.querySelector("#image-input");
const dropZone = document.querySelector("#drop-zone");
const previewWrap = document.querySelector("#preview-wrap");
const preview = document.querySelector("#image-preview");
const fileLabel = document.querySelector("#file-label");
const submitButton = document.querySelector("#submit-button");
const formStatus = document.querySelector("#form-status");

let previewUrl = null;

function showFile(file) {
    if (!file) return;
    fileLabel.textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(file);
    preview.src = previewUrl;
    previewWrap.hidden = false;
}

input.addEventListener("change", () => showFile(input.files[0]));

for (const eventName of ["dragenter", "dragover"]) {
    dropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        dropZone.classList.add("is-dragging");
    });
}
for (const eventName of ["dragleave", "drop"]) {
    dropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        dropZone.classList.remove("is-dragging");
    });
}
dropZone.addEventListener("drop", (event) => {
    const file = event.dataTransfer.files[0];
    if (!file) return;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    showFile(file);
});

function setText(selector, value) {
    const element = document.querySelector(selector);
    if (element) element.textContent = value;
}

function renderPrediction(data) {
    const empty = document.querySelector("#empty-result");
    const result = document.querySelector("#prediction-result");
    const card = document.querySelector("#result-card");
    empty.hidden = true;
    result.hidden = false;
    card.dataset.empty = "false";
    card.dataset.classification = data.classification;
    setText("#result-label", data.classification.toUpperCase());
    setText("#result-message", `A água foi classificada visualmente como ${data.classification}.`);
    setText("#result-confidence", data.confidence === null ? "—" : `${(data.confidence * 100).toFixed(1)}%`);
    setText("#result-model", data.model);
    const [red, green, blue] = data.features.mean_rgb;
    setText("#result-rgb", `R ${red} · G ${green} · B ${blue}`);
    setText("#result-warning", data.warning);
    card.scrollIntoView({ behavior: "smooth", block: "center" });
}

form.addEventListener("submit", async (event) => {
    if (!window.fetch || !input.files[0]) return;
    event.preventDefault();
    submitButton.disabled = true;
    submitButton.classList.add("is-loading");
    formStatus.textContent = "Validando a imagem e consultando o modelo…";
    const payload = new FormData();
    payload.append("image", input.files[0], input.files[0].name);
    try {
        const response = await fetch("/api/v1/predictions", { method: "POST", body: payload });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.message || "Não foi possível classificar a imagem.");
        renderPrediction(body.data);
        formStatus.textContent = "Análise concluída.";
    } catch (error) {
        formStatus.textContent = error instanceof Error ? error.message : "Falha inesperada.";
        formStatus.setAttribute("role", "alert");
    } finally {
        submitButton.disabled = false;
        submitButton.classList.remove("is-loading");
    }
});

