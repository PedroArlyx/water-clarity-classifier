import * as THREE from "/static/vendor/three.module.js";

const container = document.querySelector("#scene-container");
const fallback = document.querySelector("#webgl-fallback");
const startButton = document.querySelector("#start-demo");
const resetButton = document.querySelector("#reset-camera");
const stateLabel = document.querySelector("#agent-state");
const resultPanel = document.querySelector("#demo-result");
const demoUpload = document.querySelector("#demo-upload");
const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
let reducedMotion = motionQuery.matches;
motionQuery.addEventListener("change", (event) => { reducedMotion = event.matches; });

let renderer;
let scene;
let camera;
let robot;
let robotHead;
let cup;
let water;
let waterStream;
let analyzingRing;
let running = false;
let orbitAngle = 0;
let orbitHeight = 3.4;
let orbitDistance = 9.5;
let dragging = false;
let pointerX = 0;
let pointerY = 0;

const colors = {
    clean: { color: 0x9ee8f8, opacity: 0.56, roughness: 0.08 },
    dirty: { color: 0x7a431f, opacity: 0.96, roughness: 0.48 },
};

function material(color, options = {}) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05, ...options });
}

function mesh(geometry, surface, position, parent = scene) {
    const object = new THREE.Mesh(geometry, surface);
    object.position.set(...position);
    object.castShadow = true;
    object.receiveShadow = true;
    parent.add(object);
    return object;
}

function makeKitchen() {
    mesh(new THREE.PlaneGeometry(20, 16), material(0x18313d, { roughness: 0.9 }), [0, 0, 0]).rotation.x = -Math.PI / 2;
    mesh(new THREE.PlaneGeometry(20, 9), material(0xadc4cc, { roughness: 0.92 }), [0, 4.5, -4.8]);

    const cabinet = material(0x315f64, { roughness: 0.72 });
    const wood = material(0x9b7653, { roughness: 0.68 });
    const counter = material(0xdce8e8, { roughness: 0.3 });
    for (let x = -4.5; x <= 4.5; x += 1.5) {
        mesh(new THREE.BoxGeometry(1.42, 1.8, 1.6), cabinet, [x, 0.9, -2.9]);
        const handle = mesh(new THREE.BoxGeometry(0.42, 0.05, 0.06), material(0xb8c7ca, { metalness: 0.8 }), [x, 1.35, -2.05]);
        handle.castShadow = false;
    }
    mesh(new THREE.BoxGeometry(11, 0.25, 2), counter, [0, 1.92, -2.75]);
    mesh(new THREE.BoxGeometry(3.0, 0.2, 1.55), material(0x607f86, { metalness: 0.38 }), [1.7, 2.04, -2.75]);
    mesh(new THREE.BoxGeometry(2.55, 0.1, 1.2), material(0x142c35, { metalness: 0.6 }), [1.7, 2.13, -2.72]);
    mesh(new THREE.BoxGeometry(2.2, 0.04, 0.95), material(0x294853, { metalness: 0.55 }), [1.7, 2.16, -2.72]);

    const faucetMaterial = material(0xa9bec5, { metalness: 0.82, roughness: 0.22 });
    mesh(new THREE.CylinderGeometry(0.12, 0.15, 1.55, 18), faucetMaterial, [1.7, 2.78, -3.28]);
    const neck = new THREE.Mesh(new THREE.TorusGeometry(0.65, 0.11, 12, 28, Math.PI), faucetMaterial);
    neck.position.set(1.7, 3.54, -2.67);
    neck.rotation.z = Math.PI / 2;
    scene.add(neck);
    mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.55, 16), faucetMaterial, [1.7, 3.52, -2.05]).rotation.x = Math.PI / 2;

    for (const x of [-3.7, -1.9, 3.8]) {
        mesh(new THREE.BoxGeometry(1.35, 1.15, 0.45), wood, [x, 4.0, -4.48]);
    }
    mesh(new THREE.BoxGeometry(1.4, 2.8, 1.1), material(0x233d47, { metalness: 0.35 }), [5.8, 1.4, -3.7]);
    mesh(new THREE.SphereGeometry(0.35, 20, 16), material(0x5cc7a0), [-4.2, 2.45, -2.6]);
    const plantPot = mesh(new THREE.CylinderGeometry(0.28, 0.36, 0.5, 16), material(0xb86643), [-4.2, 2.17, -2.6]);
    plantPot.castShadow = true;
}

function makeRobot() {
    const group = new THREE.Group();
    group.position.set(-3.5, 0, -0.7);
    const shell = material(0xe8f2f4, { metalness: 0.35, roughness: 0.24 });
    const dark = material(0x12313e, { metalness: 0.3 });
    const cyan = material(0x22d3ee, { emissive: 0x0c6b79, emissiveIntensity: 1.2 });
    mesh(new THREE.CylinderGeometry(0.58, 0.72, 1.2, 18), shell, [0, 1.0, 0], group);
    mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.22, 18), dark, [0, 0.34, 0], group);
    mesh(new THREE.TorusGeometry(0.49, 0.12, 12, 24), dark, [0, 0.24, 0], group).rotation.x = Math.PI / 2;
    robotHead = new THREE.Group();
    robotHead.position.set(0, 1.95, 0);
    mesh(new THREE.SphereGeometry(0.55, 24, 18), shell, [0, 0, 0], robotHead);
    mesh(new THREE.BoxGeometry(0.62, 0.25, 0.12), dark, [0, 0.02, 0.49], robotHead);
    mesh(new THREE.SphereGeometry(0.055, 14, 10), cyan, [-0.17, 0.03, 0.56], robotHead);
    mesh(new THREE.SphereGeometry(0.055, 14, 10), cyan, [0.17, 0.03, 0.56], robotHead);
    group.add(robotHead);
    for (const side of [-1, 1]) {
        const arm = mesh(new THREE.CapsuleGeometry(0.12, 0.72, 6, 10), shell, [side * 0.72, 1.18, 0], group);
        arm.rotation.z = side * 0.35;
    }
    return group;
}

function makeCup() {
    const group = new THREE.Group();
    group.position.set(1.7, 2.22, -1.95);
    const glass = new THREE.Mesh(
        new THREE.CylinderGeometry(0.42, 0.34, 1.18, 36, 1, true),
        new THREE.MeshPhysicalMaterial({ color: 0xdaf7ff, transparent: true, opacity: 0.28, roughness: 0.05, metalness: 0, transmission: 0.45, side: THREE.DoubleSide })
    );
    glass.position.y = 0.59;
    glass.castShadow = true;
    group.add(glass);
    mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.05, 36), material(0xdaf7ff, { transparent: true, opacity: 0.34 }), [0, 0.03, 0], group);
    water = mesh(new THREE.CylinderGeometry(0.33, 0.3, 0.92, 32), material(colors.clean.color, { transparent: true, opacity: colors.clean.opacity, roughness: colors.clean.roughness }), [0, 0.49, 0], group);
    water.scale.y = 0.04;
    water.position.y = 0.06;
    return group;
}

function initializeScene() {
    try {
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x102c3a);
        scene.fog = new THREE.Fog(0x102c3a, 12, 24);
        camera = new THREE.PerspectiveCamera(42, 1, 0.1, 50);
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: "high-performance" });
    } catch (_error) {
        fallback.hidden = false;
        startButton.disabled = true;
        return false;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.domElement.setAttribute("role", "img");
    renderer.domElement.setAttribute("aria-label", "Cozinha 3D interativa com robô, bancada, pia, torneira e copo de água.");
    container.prepend(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xd9f7ff, 0x11242b, 2.1));
    const key = new THREE.DirectionalLight(0xffffff, 3.2);
    key.position.set(-3, 8, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    scene.add(key);
    const fill = new THREE.PointLight(0x4ac8e8, 2.8, 12);
    fill.position.set(4, 5, 2);
    scene.add(fill);

    makeKitchen();
    robot = makeRobot();
    scene.add(robot);
    cup = makeCup();
    scene.add(cup);
    waterStream = mesh(new THREE.CylinderGeometry(0.045, 0.065, 1.5, 12), material(0x8eeaff, { transparent: true, opacity: 0.58 }), [1.7, 2.85, -1.97]);
    waterStream.visible = false;
    analyzingRing = mesh(new THREE.TorusGeometry(0.68, 0.025, 10, 40), material(0x22d3ee, { emissive: 0x22d3ee, emissiveIntensity: 2 }), [1.7, 2.85, -1.94]);
    analyzingRing.rotation.x = Math.PI / 2;
    analyzingRing.visible = false;
    resetCamera();
    resize();
    return true;
}

function resetCamera() {
    orbitAngle = 0;
    orbitHeight = 3.5;
    orbitDistance = 9.5;
    updateCamera();
}

function updateCamera() {
    camera.position.set(Math.sin(orbitAngle) * orbitDistance, orbitHeight, 3.2 + Math.cos(orbitAngle) * orbitDistance);
    camera.lookAt(0.6, 1.7, -1.8);
}

function resize() {
    if (!renderer) return;
    const width = container.clientWidth;
    const height = Math.max(420, container.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
}

function tween(target, values, duration = 700) {
    if (reducedMotion) {
        Object.assign(target, values);
        return Promise.resolve();
    }
    const start = {};
    for (const key of Object.keys(values)) start[key] = target[key];
    const started = performance.now();
    return new Promise((resolve) => {
        function frame(now) {
            const progress = Math.min(1, (now - started) / duration);
            const eased = 1 - Math.pow(1 - progress, 3);
            for (const key of Object.keys(values)) target[key] = start[key] + (values[key] - start[key]) * eased;
            if (progress < 1) requestAnimationFrame(frame); else resolve();
        }
        requestAnimationFrame(frame);
    });
}

function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, reducedMotion ? Math.min(ms, 80) : ms));
}

function setStep(name, state) {
    const item = document.querySelector(`[data-step="${name}"]`);
    item.classList.remove("is-active", "is-complete");
    if (state) item.classList.add(state);
}

function setAgentState(text) {
    stateLabel.textContent = text;
}

function setWaterAppearance(mode) {
    const appearance = colors[mode];
    water.material.color.setHex(appearance.color);
    water.material.opacity = appearance.opacity;
    water.material.roughness = appearance.roughness;
    water.material.needsUpdate = true;
}

function selectedMode() {
    const requested = document.querySelector('input[name="water-mode"]:checked').value;
    return requested === "random" ? (Math.random() < 0.5 ? "clean" : "dirty") : requested;
}

function visualMode(requested) {
    return requested === "upload" ? "clean" : requested;
}

async function closeUpAndCapture(mode) {
    const originalPosition = camera.position.clone();
    const originalQuaternion = camera.quaternion.clone();
    const originalExposure = renderer.toneMappingExposure;
    // O enquadramento aproxima o recipiente para que a captura classificada
    // represente a água, e não seja dominada pelos móveis ao redor.
    await tween(camera.position, { x: 1.7, y: 2.9, z: 0.3 }, 650);
    camera.lookAt(1.7, 2.72, -1.95);
    // A água turva absorve mais luz; a câmera registra essa perda de
    // transmitância na própria renderização, sem qualquer rótulo na API.
    renderer.toneMappingExposure = mode === "dirty" ? 0.78 : originalExposure;
    await wait(180);
    renderer.render(scene, camera);
    const source = renderer.domElement;
    const cropSize = Math.floor(Math.min(source.width, source.height) * 0.58);
    const captureCanvas = document.createElement("canvas");
    captureCanvas.width = cropSize;
    captureCanvas.height = cropSize;
    const context = captureCanvas.getContext("2d", { alpha: false });
    context.drawImage(
        source,
        Math.floor((source.width - cropSize) / 2),
        Math.floor((source.height - cropSize) / 2),
        cropSize,
        cropSize,
        0,
        0,
        cropSize,
        cropSize,
    );
    const blob = await new Promise((resolve) => captureCanvas.toBlob(resolve, "image/png", 0.94));
    renderer.toneMappingExposure = originalExposure;
    camera.position.copy(originalPosition);
    camera.quaternion.copy(originalQuaternion);
    if (!blob) throw new Error("O navegador não conseguiu capturar a cena 3D.");
    return blob;
}

async function classify(blob) {
    const payload = new FormData();
    const filename = blob instanceof File ? blob.name : "captura-copo-3d.png";
    payload.append("image", blob, filename);
    const response = await fetch("/api/v1/predictions", { method: "POST", body: payload });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message || "A API recusou a captura 3D.");
    return body.data;
}

function showResult(data) {
    resultPanel.hidden = false;
    document.querySelector("#demo-result-label").textContent = data.classification.toUpperCase();
    document.querySelector("#demo-confidence").textContent = data.confidence === null ? "—" : `${(data.confidence * 100).toFixed(1)}%`;
    document.querySelector("#demo-model").textContent = data.model;
    const [red, green, blue] = data.features.mean_rgb;
    document.querySelector("#demo-rgb").textContent = `R ${red} · G ${green} · B ${blue}`;
    document.querySelector("#demo-result-message").textContent = data.classification === "limpo"
        ? "Visualmente, a água foi classificada como limpa. O robô pode entregar o copo, mantendo o aviso de que aparência não comprova potabilidade."
        : "A água apresentou características visuais classificadas como sujas. O robô interrompe a entrega e emite um alerta.";
}

async function runAgent() {
    if (running) return;
    running = true;
    startButton.disabled = true;
    startButton.classList.add("is-loading");
    resultPanel.hidden = true;
    document.querySelectorAll(".agent-timeline li").forEach((item) => item.className = "");
    water.scale.y = 0.04;
    water.position.y = 0.06;
    robot.position.set(-3.5, 0, -0.7);
    cup.position.set(1.7, 2.22, -1.95);
    const requestedMode = selectedMode();
    if (requestedMode === "upload" && !demoUpload.files[0]) {
        setAgentState("Selecione uma imagem própria antes de iniciar.");
        running = false;
        startButton.disabled = false;
        startButton.classList.remove("is-loading");
        demoUpload.focus();
        return;
    }
    setWaterAppearance(visualMode(requestedMode));
    try {
        setStep("request", "is-active"); setAgentState("Solicitação recebida. Confirmando tarefa…"); await wait(700); setStep("request", "is-complete");
        setStep("collect", "is-active"); setAgentState("Indo até a pia e posicionando o copo…"); await tween(robot.position, { x: 0.7, z: -1.1 }, 1500); await tween(cup.position, { y: 2.24 }, 300);
        waterStream.visible = true; setAgentState("Torneira aberta. Enchendo o copo…"); await tween(water.scale, { y: 1 }, 1350); water.position.y = 0.49; waterStream.visible = false; setStep("collect", "is-complete");
        setStep("capture", "is-active"); setAgentState(requestedMode === "upload" ? "Preparando a fotografia enviada para análise…" : "Observando e capturando a aparência da água…"); robotHead.rotation.y = 0.65; analyzingRing.visible = true; const capture = requestedMode === "upload" ? demoUpload.files[0] : await closeUpAndCapture(requestedMode); setStep("capture", "is-complete");
        setStep("classify", "is-active"); setAgentState("Analisando RGB com o modelo treinado…"); const prediction = await classify(capture); setStep("classify", "is-complete"); analyzingRing.visible = false;
        setStep("decide", "is-active"); showResult(prediction); if (prediction.classification === "limpo") { setAgentState("Aparência limpa: entregando com ressalva científica."); await tween(robot.position, { x: -1.8, z: 1.2 }, 1000); } else { setAgentState("Aparência suja: entrega interrompida e alerta emitido."); robotHead.rotation.z = 0.18; } setStep("decide", "is-complete");
    } catch (error) {
        setAgentState(error instanceof Error ? error.message : "A demonstração não pôde ser concluída.");
        analyzingRing.visible = false;
        waterStream.visible = false;
    } finally {
        running = false;
        startButton.disabled = false;
        startButton.classList.remove("is-loading");
    }
}

function animate() {
    if (!renderer) return;
    requestAnimationFrame(animate);
    if (analyzingRing.visible && !reducedMotion) analyzingRing.rotation.z += 0.025;
    renderer.render(scene, camera);
}

function pointerDown(event) { dragging = true; pointerX = event.clientX; pointerY = event.clientY; renderer.domElement.setPointerCapture(event.pointerId); }
function pointerMove(event) { if (!dragging || running) return; orbitAngle -= (event.clientX - pointerX) * 0.006; orbitHeight = Math.max(2.4, Math.min(5.5, orbitHeight + (event.clientY - pointerY) * 0.008)); pointerX = event.clientX; pointerY = event.clientY; updateCamera(); }
function pointerUp() { dragging = false; }

if (initializeScene()) {
    renderer.domElement.addEventListener("pointerdown", pointerDown);
    renderer.domElement.addEventListener("pointermove", pointerMove);
    renderer.domElement.addEventListener("pointerup", pointerUp);
    renderer.domElement.addEventListener("pointercancel", pointerUp);
    renderer.domElement.addEventListener("wheel", (event) => { event.preventDefault(); orbitDistance = Math.max(5.5, Math.min(13, orbitDistance + event.deltaY * 0.008)); updateCamera(); }, { passive: false });
    window.addEventListener("resize", resize);
    resetButton.addEventListener("click", resetCamera);
    startButton.addEventListener("click", runAgent);
    animate();
}
