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

function formatNumber(value, digits = 0) {
    return Number(value).toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

// Barras R/G/B com rótulo e valor: a cor do canal nunca é o único código.
function rgbMeter(container, rgb) {
    container.replaceChildren();
    ["R", "G", "B"].forEach((name, index) => {
        const row = document.createElement("div");
        row.className = `rgb-meter__row rgb-meter__row--${name.toLowerCase()}`;
        row.innerHTML = '<span class="rgb-meter__label"></span><span class="rgb-meter__track"><span class="rgb-meter__bar"></span></span><span class="rgb-meter__value mono"></span>';
        row.querySelector(".rgb-meter__label").textContent = name;
        row.querySelector(".rgb-meter__value").textContent = formatNumber(rgb[index]);
        row.querySelector(".rgb-meter__bar").style.setProperty("--value", String(rgb[index] / 255));
        container.append(row);
    });
    const swatch = document.createElement("div");
    swatch.className = "rgb-meter__swatch";
    swatch.style.setProperty("--swatch", `rgb(${rgb.map((value) => Math.round(value)).join(",")})`);
    swatch.innerHTML = "<span></span><small>Cor média</small>";
    container.append(swatch);
}

function drawHistogram(svg, histogram) {
    const width = 320;
    const height = 140;
    const pad = 6;
    const channels = ["r", "g", "b"];
    const max = Math.max(...channels.flatMap((channel) => histogram[channel])) || 1;
    const step = (width - pad * 2) / (histogram.r.length - 1);
    const parts = [];
    for (let i = 0; i <= 4; i += 1) {
        const y = pad + ((height - pad * 2) * i) / 4;
        parts.push(`<line class="histogram__grid" x1="${pad}" x2="${width - pad}" y1="${y}" y2="${y}"/>`);
    }
    for (const channel of channels) {
        const points = histogram[channel].map((value, index) => [pad + index * step, height - pad - (value / max) * (height - pad * 2)]);
        const line = points.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
        parts.push(`<path class="histogram__area histogram__area--${channel}" d="${line}L${width - pad},${height - pad}L${pad},${height - pad}Z"/>`);
        parts.push(`<path class="histogram__line histogram__line--${channel}" d="${line}"/>`);
    }
    parts.push(`<text class="histogram__axis" x="${pad}" y="${height - 0.5}">0</text><text class="histogram__axis" x="${width - pad}" y="${height - 0.5}" text-anchor="end">255</text>`);
    svg.innerHTML = parts.join("");
}

function renderPrediction(data) {
    const clean = data.classification === "limpo";
    document.querySelector("#empty-result").hidden = true;
    document.querySelector("#prediction-result").hidden = false;
    const card = document.querySelector("#result-card");
    card.dataset.classification = data.classification;
    const badge = document.querySelector("#result-badge");
    badge.className = `verdict ${clean ? "verdict--clean" : "verdict--dirty"}`;
    badge.textContent = clean ? "Visualmente limpa" : "Visualmente suja";
    setText("#result-label", clean ? "Limpa" : "Suja");
    setText("#result-message", `A água foi classificada visualmente como ${data.classification.toUpperCase()}.`);
    const probability = data.probabilities?.[data.classification] ?? data.confidence;
    setText("#result-confidence", probability === null || probability === undefined ? "não disponível" : `${formatNumber(probability * 100, 1)}%`);
    setText("#result-model", data.model);
    setText("#result-features", data.features.count ? String(data.features.count) : "—");
    rgbMeter(document.querySelector("#result-rgb"), data.features.mean_rgb);
    if (data.features.histogram) {
        drawHistogram(document.querySelector("#result-histogram"), data.features.histogram);
        document.querySelector("#histogram-block").hidden = false;
    }
    if (data.pipeline?.length) setText("#result-steps", data.pipeline.map((step) => step.estimator).join(" → "));
    setText("#result-warning", data.warning);
    if (window.matchMedia("(max-width: 900px)").matches) card.scrollIntoView({ behavior: "smooth", block: "start" });
}

// Resultado renderizado pelo servidor (fallback sem JS): completa as barras RGB.
const serverRgb = document.querySelector("#result-rgb")?.dataset.rgb;
if (serverRgb) rgbMeter(document.querySelector("#result-rgb"), serverRgb.split(",").map(Number));

form.addEventListener("submit", async (event) => {
    if (!window.fetch || !input.files[0]) return;
    event.preventDefault();
    submitButton.disabled = true;
    submitButton.classList.add("is-loading");
    formStatus.removeAttribute("role");
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
