// Controlador da experiência. Módulos 3D são importados sob demanda (só após
// "Iniciar experiência"). Todo dado exibido como resultado vem da API.
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const xp = $("#xp");
const stage = $("#scene-container");
const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const debug = new URLSearchParams(window.location.search).has("debug");

let world = null;
let director = null;
let audio = null;
let metadata = null;
let lastPrediction = null;
let lastImageUrl = null;
let waterMode = "clean";

function webglAvailable() {
    try {
        const canvas = document.createElement("canvas");
        return Boolean(window.WebGL2RenderingContext && canvas.getContext("webgl2"));
    } catch (_error) {
        return false;
    }
}

function percent(value) {
    return `${(value * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function formatNumber(value, digits = 0) {
    return Number(value).toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function predictedProbability(prediction) {
    if (prediction.probabilities && prediction.classification in prediction.probabilities) {
        return prediction.probabilities[prediction.classification];
    }
    return prediction.confidence;
}

function setLoad(step, state) {
    const item = $(`[data-load="${step}"]`);
    if (item) item.dataset.state = state;
}

function toast(message) {
    const element = $("#xp-toast");
    element.textContent = message;
    element.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { element.hidden = true; }, 6000);
}

// --- Componentes de dados -------------------------------------------------

function rgbMeter(container, rgb) {
    container.replaceChildren();
    const names = ["R", "G", "B"];
    rgb.forEach((value, index) => {
        const row = document.createElement("div");
        row.className = `rgb-meter__row rgb-meter__row--${names[index].toLowerCase()}`;
        row.innerHTML = `<span class="rgb-meter__label">${names[index]}</span><span class="rgb-meter__track"><span class="rgb-meter__bar"></span></span><span class="rgb-meter__value mono"></span>`;
        row.querySelector(".rgb-meter__value").textContent = formatNumber(value, 0);
        row.querySelector(".rgb-meter__bar").style.setProperty("--value", String(value / 255));
        container.append(row);
    });
    const swatch = document.createElement("div");
    swatch.className = "rgb-meter__swatch";
    swatch.style.setProperty("--swatch", `rgb(${rgb.map((v) => Math.round(v)).join(",")})`);
    swatch.innerHTML = "<span></span><small>Cor média</small>";
    container.append(swatch);
}

function drawHistogram(svg, histogram) {
    const width = 320;
    const height = 140;
    const pad = 6;
    const channels = ["r", "g", "b"];
    const max = Math.max(...channels.flatMap((c) => histogram[c])) || 1;
    const bins = histogram.r.length;
    const step = (width - pad * 2) / (bins - 1);
    const parts = [];
    for (let i = 0; i <= 4; i += 1) {
        const y = pad + ((height - pad * 2) * i) / 4;
        parts.push(`<line class="histogram__grid" x1="${pad}" x2="${width - pad}" y1="${y}" y2="${y}"/>`);
    }
    for (const channel of channels) {
        const points = histogram[channel].map((value, index) => [pad + index * step, height - pad - (value / max) * (height - pad * 2)]);
        const line = points.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
        const area = `${line}L${(width - pad).toFixed(1)},${height - pad}L${pad},${height - pad}Z`;
        parts.push(`<path class="histogram__area histogram__area--${channel}" d="${area}"/>`);
        parts.push(`<path class="histogram__line histogram__line--${channel}" d="${line}"/>`);
    }
    parts.push(`<text class="histogram__axis" x="${pad}" y="${height - 0.5}">0</text><text class="histogram__axis" x="${width - pad}" y="${height - 0.5}" text-anchor="end">255</text>`);
    svg.innerHTML = parts.join("");
}

function facts(container, rows) {
    container.replaceChildren();
    for (const [label, value] of rows) {
        if (value === undefined || value === null || value === "") continue;
        const row = document.createElement("div");
        const dt = document.createElement("dt");
        const dd = document.createElement("dd");
        dt.textContent = label;
        dd.textContent = value;
        row.append(dt, dd);
        container.append(row);
    }
}

// --- Interface consumida pelo diretor ---------------------------------------

const PIPE_FROM_STEP = { capture: "capture", rgb: "rgb", features: "features", model: "model", done: "model" };

const ui = {
    setState(key, label) {
        $("#agent-state").textContent = label;
        xp.dataset.agent = key;
    },
    say(text) {
        const bubble = document.createElement("p");
        bubble.className = "bubble bubble--agent";
        bubble.textContent = text;
        const log = $("#assistant-log");
        log.append(bubble);
        while (log.children.length > 3) log.firstElementChild.remove();
    },
    pipeline(step, state) {
        const item = $(`[data-pipe="${step}"]`);
        if (item) item.dataset.state = state;
    },
    analysisStep(step, state, detail = "") {
        const item = $(`#analysis-steps [data-step="${step}"]`);
        item.dataset.state = state;
        item.querySelector("em").textContent = detail;
        if (PIPE_FROM_STEP[step]) ui.pipeline(PIPE_FROM_STEP[step], state);
    },
    showCapture(image, caption) {
        if (lastImageUrl) URL.revokeObjectURL(lastImageUrl);
        lastImageUrl = URL.createObjectURL(image);
        $("#analysis-image").src = lastImageUrl;
        $("#analysis-caption").textContent = caption;
        $("#analysis").hidden = false;
        ui.analysisStep("capture", "done", caption.includes("512") ? "PNG 512×512" : "foto");
        ui.analysisStep("rgb", "active", "no servidor…");
        ui.pipeline("rgb", "active");
    },
    // Os valores já chegaram da API; a revelação escalonada só organiza a
    // leitura (cada etapa exibe dados reais da resposta).
    async revealAnalysis(prediction, wait) {
        lastPrediction = prediction;
        const [r, g, b] = prediction.features.mean_rgb;
        ui.analysisStep("rgb", "done", `R ${formatNumber(r)} · G ${formatNumber(g)} · B ${formatNumber(b)}`);
        await wait(0.45);
        ui.analysisStep("features", "active");
        await wait(0.3);
        const count = prediction.features.count;
        ui.analysisStep("features", "done", count ? `${count} atributos` : "vetor RGB");
        await wait(0.3);
        ui.analysisStep("model", "active");
        await wait(0.3);
        const steps = (prediction.pipeline || []).map((item) => item.estimator).join(" → ");
        ui.analysisStep("model", "done", steps || prediction.model);
        await wait(0.3);
        const probability = predictedProbability(prediction);
        ui.analysisStep("done", "done", `${prediction.classification.toUpperCase()}${probability !== null && probability !== undefined ? ` · ${percent(probability)}` : ""}`);
        $("#hud-model").textContent = prediction.model;
        await wait(0.5);
    },
    showResult(prediction) {
        const card = $("#result");
        const clean = prediction.classification === "limpo";
        card.dataset.class = clean ? "clean" : "dirty";
        $("#result-label").textContent = clean ? "Limpa" : "Suja";
        $("#result-message").textContent = `Água classificada visualmente como ${clean ? "LIMPA" : "SUJA"}. ${clean ? "O robô vai entregar o copo." : "O robô não vai entregar o copo."}`;
        const probability = predictedProbability(prediction);
        $("#result-confidence").textContent = probability === null || probability === undefined ? "não disponível" : percent(probability);
        $("#result-model").textContent = prediction.model;
        rgbMeter($("#result-rgb"), prediction.features.mean_rgb);
        $("#analysis").hidden = true;
        card.hidden = false;
    },
    showError(message) {
        toast(message);
        ui.say(`Não consegui concluir: ${message}`);
    },
    finished() {
        $("#assistant-running").hidden = true;
        $("#assistant-after").hidden = false;
        $("#xp-view").hidden = !lastPrediction;
        setSpeed(false);
    },
};

// --- Diálogo "Ver análise" --------------------------------------------------

function fillSheet() {
    const prediction = lastPrediction;
    if (!prediction) return;
    const features = prediction.features;
    const flow = $("#sheet-flow");
    flow.replaceChildren();
    const nodes = [
        ["Imagem", prediction.image ? `${prediction.image.width}×${prediction.image.height} · ${prediction.image.format}` : ""],
        ["RGB", features.mean_rgb.map((value) => formatNumber(value)).join(" · ")],
        [`${features.histogram_count ?? 768} histograma`, "3 × 256 bins normalizados"],
        [`${features.count ?? "—"} features`, features.engineered_count ? `+ ${features.engineered_count} estatísticas RGB` : ""],
    ];
    for (const step of prediction.pipeline || []) {
        const label = step.estimator === "StandardScaler" ? "Normalização" : step.estimator;
        const detail = step.estimator === "StandardScaler" ? "StandardScaler (média 0, desvio 1)" : `etapa "${step.name}"`;
        nodes.push([label, detail]);
    }
    const probability = predictedProbability(prediction);
    nodes.push([prediction.classification.toUpperCase(), probability ? `probabilidade ${percent(probability)}` : ""]);
    nodes.forEach(([title, detail], index) => {
        const item = document.createElement("li");
        if (index === nodes.length - 1) item.dataset.result = prediction.classification === "limpo" ? "clean" : "dirty";
        const strong = document.createElement("strong");
        strong.textContent = title;
        const small = document.createElement("small");
        small.textContent = detail;
        item.append(strong, small);
        flow.append(item);
    });
    $("#sheet-image").src = lastImageUrl || "";
    $("#sheet-image-meta").textContent = prediction.image ? `${prediction.image.width}×${prediction.image.height} px · ${prediction.image.mime_type}` : "";
    if (features.histogram) drawHistogram($("#sheet-histogram"), features.histogram);
    rgbMeter($("#sheet-rgb"), features.mean_rgb);
    facts($("#sheet-facts"), [
        ["Classificação", prediction.classification.toUpperCase()],
        ["Algoritmo", prediction.model],
        ["Schema de atributos", features.schema_version],
    ]);
    const probabilities = $("#sheet-probabilities");
    probabilities.replaceChildren();
    for (const [label, value] of Object.entries(prediction.probabilities || {})) {
        const row = document.createElement("div");
        row.className = "prob__row";
        row.dataset.active = String(label === prediction.classification);
        row.innerHTML = `<span class="prob__label"></span><span class="prob__track"><span class="prob__bar"></span></span><span class="prob__value mono"></span>`;
        row.querySelector(".prob__label").textContent = label;
        row.querySelector(".prob__value").textContent = percent(value);
        row.querySelector(".prob__bar").style.setProperty("--value", String(value));
        probabilities.append(row);
    }
    const winner = metadata?.evaluation?.winner_metrics;
    facts($("#sheet-model"), [
        ["Algoritmo vencedor", metadata?.model_name],
        ["Critério de seleção", metadata?.primary_metric],
        ["F1 macro (validação)", winner ? formatNumber(winner.f1_macro, 3) : null],
        ["Balanced accuracy", winner ? formatNumber(winner.balanced_accuracy, 3) : null],
        ["Amostras de treino", metadata?.dataset?.samples],
        ["Treinado em", metadata?.trained_at ? new Date(metadata.trained_at).toLocaleString("pt-BR") : null],
    ]);
}

// --- Controles ----------------------------------------------------------------

function radioGroup(selector, attribute, onChange) {
    const buttons = $$(`${selector} [${attribute}]`);
    const select = (button) => {
        for (const other of buttons) {
            other.setAttribute("aria-checked", String(other === button));
            other.tabIndex = other === button ? 0 : -1;
        }
        onChange(button.getAttribute(attribute));
    };
    buttons.forEach((button, index) => {
        button.tabIndex = button.getAttribute("aria-checked") === "true" ? 0 : -1;
        button.addEventListener("click", () => select(button));
        button.addEventListener("keydown", (event) => {
            const delta = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
            if (!delta) return;
            event.preventDefault();
            const next = buttons[(index + delta + buttons.length) % buttons.length];
            next.focus();
            select(next);
        });
    });
}

function setSpeed(fast) {
    const button = $("#xp-speed");
    button.setAttribute("aria-pressed", String(fast));
    button.textContent = fast ? "Velocidade normal" : "Acelerar animação";
    // Com movimento reduzido, a sequência já roda mais curta por padrão.
    const base = motionQuery.matches ? 2 : 1;
    if (world) world.animator.timeScale = fast ? 3 : base;
}

function resetUi() {
    lastPrediction = null;
    $("#result").hidden = true;
    $("#analysis").hidden = true;
    $$("#analysis-steps li").forEach((item) => { item.dataset.state = ""; item.querySelector("em").textContent = ""; });
    $$("[data-pipe]").forEach((item) => { item.dataset.state = ""; });
    $("#assistant-controls").hidden = false;
    $("#assistant-after").hidden = true;
    $("#assistant-running").hidden = true;
    const log = $("#assistant-log");
    log.replaceChildren();
    ui.say("O que posso fazer por você?");
    ui.setState("idle", "Aguardando solicitação");
}

async function classify(image) {
    const payload = new FormData();
    const filename = image instanceof File ? image.name : "captura-estacao-visao.png";
    payload.append("image", image, filename);
    const response = await fetch("/api/v1/predictions", { method: "POST", body: payload });
    let body = null;
    try {
        body = await response.json();
    } catch (_error) {
        body = null;
    }
    if (!response.ok) throw new Error(body?.error?.message || "A API recusou a captura.");
    return body.data;
}

async function runTask() {
    const upload = waterMode === "upload" ? $("#demo-upload").files[0] : null;
    if (waterMode === "upload" && !upload) {
        toast("Escolha uma fotografia antes de fazer a solicitação.");
        $("#demo-upload").focus();
        return;
    }
    const appearance = waterMode === "random" ? (Math.random() < 0.5 ? "clean" : "dirty") : waterMode === "dirty" ? "dirty" : "clean";
    $("#assistant-controls").hidden = true;
    $("#assistant-running").hidden = false;
    $("#assistant-after").hidden = true;
    const request = document.createElement("p");
    request.className = "bubble bubble--user";
    request.textContent = "Pegue um copo de água para mim.";
    $("#assistant-log").append(request);
    if (waterMode === "random") ui.say("Aparência sorteada. Nem eu sei qual é — vou descobrir pela análise.");
    await director.run({ appearance, upload, classify });
}

async function newRequest() {
    const fade = $("#xp-fade");
    fade.classList.add("is-on");
    await new Promise((resolve) => setTimeout(resolve, motionQuery.matches ? 0 : 450));
    director.cancel();
    director.current = "idle";
    world.resetScene();
    world.rig.shot("overview");
    world.rig.cut();
    resetUi();
    fade.classList.remove("is-on");
    $("#start-demo").focus();
}

async function loadMetadata() {
    const response = await fetch("/api/v1/model/metadata");
    if (!response.ok) throw new Error("Modelo indisponível na API.");
    metadata = (await response.json()).data;
    $("#hud-model").textContent = metadata.model_name || "—";
}

async function startExperience() {
    const startButton = $("#xp-start");
    startButton.hidden = true;
    $("#xp-loading").hidden = false;
    xp.dataset.phase = "loading";
    try {
        const [{ World }, { Director }, { AmbientAudio }] = await Promise.all([
            import("./world.js"),
            import("./director.js"),
            import("./audio.js"),
        ]);
        world = new World(stage, { quality: "auto", reducedMotion: motionQuery.matches });
        await world.init(setLoad);
        setLoad("model", "active");
        await loadMetadata();
        setLoad("model", "done");
        setLoad("sim", "active");
        audio = new AmbientAudio();
        director = new Director(world, ui, audio);
        world.onFrame(() => audio.update({ flow: world.stream.flow * (world.stream.mesh.visible ? 1 : 0), fill: world.cup.level, speed: Math.abs(world.robot.speed) }));
        world.onQualityChange = (level) => updateQualityLabel(level);
        await world.warmup();
        setSpeed(false);
        world.start();
        setLoad("sim", "done");
        updateQualityLabel(world.quality);
        xp.dataset.phase = "ready";
        $("#xp-enter").hidden = false;
        $("#xp-enter").focus();
        if (debug) window.__waterVision = { world, director, ui };
    } catch (error) {
        console.error(error);
        xp.dataset.phase = "intro";
        $("#xp-loading").hidden = true;
        $("#webgl-fallback").hidden = false;
        $("#webgl-fallback p").textContent = error instanceof Error ? `Não foi possível preparar a cena: ${error.message}` : "Não foi possível preparar a cena.";
    }
}

function updateQualityLabel(level) {
    const option = $('#xp-quality option[value="auto"]');
    const names = { high: "Alta", medium: "Média", low: "Baixa" };
    option.textContent = `Qualidade: Auto (${names[level]})`;
}

function enterKitchen() {
    xp.dataset.phase = "scene";
    for (const id of ["#hud", "#assistant", "#xp-toolbar"]) $(id).hidden = false;
    world.rig.shot("overview");
    audio.setEnabled($("#xp-sound").getAttribute("aria-pressed") === "true");
    $("#start-demo").focus();
}

function init() {
    if (!webglAvailable()) {
        $("#xp-start").hidden = true;
        $("#webgl-fallback").hidden = false;
        return;
    }
    $("#xp-start").addEventListener("click", startExperience);
    $("#xp-enter").addEventListener("click", enterKitchen);
    $("#start-demo").addEventListener("click", runTask);
    $("#xp-again").addEventListener("click", newRequest);
    $("#xp-speed").addEventListener("click", () => setSpeed($("#xp-speed").getAttribute("aria-pressed") !== "true"));
    $("#xp-view").addEventListener("click", () => {
        fillSheet();
        $("#analysis-dialog").showModal();
    });
    $("#analysis-dialog").addEventListener("click", (event) => {
        if (event.target === event.currentTarget) event.currentTarget.close();
    });
    $("#xp-sound").addEventListener("click", (event) => {
        const button = event.currentTarget;
        const on = button.getAttribute("aria-pressed") !== "true";
        button.setAttribute("aria-pressed", String(on));
        button.setAttribute("aria-label", on ? "Som ambiente ligado" : "Som ambiente desligado");
        audio?.setEnabled(on);
    });
    $("#xp-quality").addEventListener("change", (event) => world?.setQuality(event.target.value));
    radioGroup("#xp-toolbar", "data-camera", (mode) => {
        world?.rig.setMode(mode);
        xp.dataset.camera = mode;
        if (mode === "free") world?.renderer.domElement.focus();
    });
    radioGroup("#assistant-controls", "data-water", (mode) => {
        waterMode = mode;
        $("#file-pick").hidden = mode !== "upload";
        $("#water-hint").textContent = mode === "upload"
            ? "O robô executa a tarefa e envia a sua fotografia ao modelo, no lugar da captura 3D."
            : mode === "random"
                ? "A aparência é sorteada e não é mostrada: você descobre pelo resultado do modelo."
                : "Altera só o material renderizado. O rótulo nunca é enviado à API.";
    });
    $("#demo-upload").addEventListener("change", (event) => {
        const file = event.target.files[0];
        $("#file-pick-label").textContent = file ? file.name : "Escolher fotografia do copo…";
    });
    motionQuery.addEventListener("change", (event) => {
        if (!world) return;
        world.reducedMotion = event.matches;
        world.rig.reducedMotion = event.matches;
    });
    document.addEventListener("visibilitychange", () => {
        if (!world) return;
        if (document.hidden) world.stop();
        else if (xp.dataset.phase !== "intro" && xp.dataset.phase !== "loading") world.start();
    });
}

init();
