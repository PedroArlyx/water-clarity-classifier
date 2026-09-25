// Mundo 3D: renderer, cena, qualidade adaptativa, loop e captura da câmera
// da estação de visão. A lógica do agente nunca depende do nível gráfico:
// a captura usa sempre a mesma resolução e a mesma câmera.
import * as THREE from "/static/vendor/three.module.js";
import { Animator } from "./anim.js";
import { CameraRig } from "./camera.js";
import { buildEnvironment } from "./environment.js";
import { Cup } from "./glass.js";
import { buildKitchen, LAYOUT } from "./kitchen.js";
import { Robot } from "./robot.js";
import { WaterStream } from "./stream.js";
import { contactShadow } from "./textures.js";

export const QUALITY_PRESETS = {
    low: { pixelRatio: 1, shadowSize: 1024, transmission: 0.5, label: "Baixa" },
    medium: { pixelRatio: 1.35, shadowSize: 2048, transmission: 0.75, label: "Média" },
    high: { pixelRatio: 2, shadowSize: 2048, transmission: 1, label: "Alta" },
};

export function detectQuality() {
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const small = Math.min(window.innerWidth, window.innerHeight) < 700;
    const cores = navigator.hardwareConcurrency || 4;
    const memory = navigator.deviceMemory || 8;
    if ((coarse && small) || cores <= 2 || memory <= 2) return "low";
    if (coarse || cores <= 4 || memory <= 4) return "medium";
    return "high";
}

const CAPTURE_SIZE = 512;
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

export class World {
    constructor(container, { quality = "auto", reducedMotion = false } = {}) {
        this.container = container;
        this.qualitySetting = quality;
        this.quality = quality === "auto" ? detectQuality() : quality;
        this.reducedMotion = reducedMotion;
        this.animator = new Animator();
        this.frameListeners = new Set();
        this.fps = { frames: 0, elapsed: 0, value: 60, low: 0 };
        this.running = false;
    }

    async init(progress = () => {}) {
        progress("env", "active");
        this.renderer = new THREE.WebGLRenderer({
            antialias: this.quality !== "low",
            powerPreference: "high-performance",
            preserveDrawingBuffer: false,
        });
        const renderer = this.renderer;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.NeutralToneMapping;
        renderer.toneMappingExposure = 1.0;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFShadowMap;
        renderer.domElement.setAttribute("tabindex", "0");
        renderer.domElement.setAttribute("aria-label", "Cena 3D: cozinha com robô assistente, pia, torneira, copo e estação de visão. No modo livre, use as setas para orbitar e + ou − para aproximar.");
        this.container.append(renderer.domElement);

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0xd9d6d0);
        this.camera = new THREE.PerspectiveCamera(36, 1, 0.03, 30);
        await nextFrame();
        this.scene.environment = buildEnvironment(renderer);
        this.scene.environmentIntensity = 1;
        this.kitchen = buildKitchen(this.scene, this.quality);
        progress("env", "done");

        progress("agent", "active");
        await nextFrame();
        const shadowTexture = contactShadow();
        this.robot = new Robot();
        this.robot.setShadowTexture(shadowTexture);
        this.scene.add(this.robot.root);
        this.cup = new Cup(this.quality);
        this.cup.setShadowTexture(shadowTexture);
        this.scene.add(this.cup.group);
        this.stream = new WaterStream(this.scene, this.kitchen.faucet.outlet, this.quality);
        this.stream.impactY = () => this.impactY();
        this.rig = new CameraRig(this.camera, renderer.domElement);
        this.rig.reducedMotion = this.reducedMotion;
        this.resetScene();
        progress("agent", "done");

        this.applyQuality();
        this.resize();
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(this.container);
        return this;
    }

    // Compila shaders antes de exibir, evitando travadas na primeira animação.
    async warmup() {
        this.rig.update(0, 0);
        this.robot.update(0.016, 0, true);
        if (this.renderer.compileAsync) await this.renderer.compileAsync(this.scene, this.camera);
        this.renderer.render(this.scene, this.camera);
    }

    resetScene() {
        const { robot, cup, stream, kitchen } = this;
        stream.reset();
        kitchen.faucet.lever.rotation.x = 0;
        this.scene.attach(cup.group);
        cup.group.position.copy(LAYOUT.cupStart);
        cup.group.rotation.set(0, 0, 0);
        cup.held = false;
        cup.setLevel(0, true);
        cup.bubbleActivity = 0;
        robot.place(LAYOUT.dock, 0.55);
        robot.targetYaw = 0.55;
        robot.reachLean = 0;
        robot.expression = 0;
        robot.setStatus("idle");
        robot.lookAt(null);
        for (const arm of Object.values(robot.arms)) {
            arm.level = 0;
            arm.grip = 0;
            arm.wobble = 0;
            arm.setGoal(robot.restGoal(arm), 0);
        }
        this.setStationLed(false);
    }

    setStationLed(on) {
        this.kitchen.station.led.color.set(on ? 0x7fd0ff : 0x9aa3ab).multiplyScalar(on ? 2.2 : 1);
    }

    cupUnderOutlet() {
        const outlet = new THREE.Vector3();
        this.kitchen.faucet.outlet.getWorldPosition(outlet);
        const cupPosition = new THREE.Vector3();
        this.cup.group.getWorldPosition(cupPosition);
        return Math.hypot(outlet.x - cupPosition.x, outlet.z - cupPosition.z) < 0.028 && cupPosition.y < outlet.y;
    }

    impactY() {
        if (this.cupUnderOutlet()) {
            const point = new THREE.Vector3(0, this.cup.surfaceY, 0);
            return this.cup.group.localToWorld(point).y;
        }
        return LAYOUT.counterY - 0.035 - LAYOUT.sink.depth;
    }

    setQuality(setting) {
        this.qualitySetting = setting;
        this.quality = setting === "auto" ? detectQuality() : setting;
        this.fps.low = 0;
        this.applyQuality();
    }

    applyQuality() {
        const preset = QUALITY_PRESETS[this.quality];
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.pixelRatio));
        if ("transmissionResolutionScale" in this.renderer) this.renderer.transmissionResolutionScale = preset.transmission;
        const sun = this.kitchen.lights.sun;
        if (sun.shadow.mapSize.x !== preset.shadowSize) {
            sun.shadow.mapSize.set(preset.shadowSize, preset.shadowSize);
            sun.shadow.map?.dispose();
            sun.shadow.map = null;
        }
        this.resize();
    }

    resize() {
        const width = Math.max(1, this.container.clientWidth);
        const height = Math.max(1, this.container.clientHeight);
        this.renderer.setSize(width, height, false);
        this.camera.aspect = width / height;
        // Telas estreitas (retrato): abre o enquadramento para manter o assunto.
        this.rig.fovScale = this.camera.aspect < 1 ? 1.35 : this.camera.aspect < 1.3 ? 1.15 : 1;
        this.camera.updateProjectionMatrix();
    }

    onFrame(listener) {
        this.frameListeners.add(listener);
        return () => this.frameListeners.delete(listener);
    }

    start() {
        if (this.running) return;
        this.running = true;
        this.clock = new THREE.Timer();
        const loop = (timestamp) => {
            if (!this.running) return;
            requestAnimationFrame(loop);
            this.clock.update(timestamp);
            const rawDt = Math.min(0.05, this.clock.getDelta());
            this.frame(rawDt);
        };
        requestAnimationFrame(loop);
    }

    stop() {
        this.running = false;
    }

    frame(rawDt) {
        const dt = this.animator.update(rawDt);
        const time = this.animator.time;
        const reduced = this.reducedMotion;
        this.robot.update(dt, time, reduced);
        if (this.cup.held) this.cup.shadow.visible = false;
        else this.cup.shadow.visible = true;
        this.stream.update(dt, time, reduced);
        if (this.stream.reached && this.cupUnderOutlet()) {
            this.cup.setLevel(this.cup.level + dt * this.stream.flow * 0.27);
            this.cup.bubbleActivity = Math.min(1, this.cup.bubbleActivity + dt * 4 * this.stream.flow);
        }
        this.cup.update(dt, time, reduced);
        const baseFov = this.rig.goalFov;
        this.rig.goalFov = baseFov * (this.rig.fovScale || 1);
        this.rig.update(dt, time);
        this.rig.goalFov = baseFov;
        this.renderer.render(this.scene, this.camera);
        for (const listener of this.frameListeners) listener(dt, time);
        this.trackPerformance(rawDt);
    }

    // AUTO: se o FPS médio ficar baixo por alguns segundos, reduz um nível.
    trackPerformance(rawDt) {
        const fps = this.fps;
        fps.frames += 1;
        fps.elapsed += rawDt;
        if (fps.elapsed < 1) return;
        fps.value = fps.frames / fps.elapsed;
        fps.frames = 0;
        fps.elapsed = 0;
        if (this.qualitySetting !== "auto" || document.hidden) return;
        fps.low = fps.value < 40 ? fps.low + 1 : 0;
        if (fps.low >= 3 && this.quality !== "low") {
            this.quality = this.quality === "high" ? "medium" : "low";
            fps.low = 0;
            this.applyQuality();
            this.onQualityChange?.(this.quality);
        }
    }

    // Captura da câmera da estação: sempre 512×512, pixel ratio 1, com a mesma
    // cena e iluminação. Tudo ocorre na mesma tarefa, então o usuário não vê
    // o redimensionamento temporário do canvas.
    capture() {
        const renderer = this.renderer;
        const sensor = this.kitchen.station.sensor;
        const previousRatio = renderer.getPixelRatio();
        const previousSize = renderer.getSize(new THREE.Vector2());
        const hidden = [this.stream.mesh, this.stream.particles, ...this.stream.ripples].filter((object) => object.visible);
        hidden.forEach((object) => { object.visible = false; });
        renderer.setPixelRatio(1);
        renderer.setSize(CAPTURE_SIZE, CAPTURE_SIZE, false);
        sensor.aspect = 1;
        sensor.updateProjectionMatrix();
        renderer.render(this.scene, sensor);
        const output = document.createElement("canvas");
        output.width = CAPTURE_SIZE;
        output.height = CAPTURE_SIZE;
        output.getContext("2d", { alpha: false }).drawImage(renderer.domElement, 0, 0, CAPTURE_SIZE, CAPTURE_SIZE);
        renderer.setPixelRatio(previousRatio);
        renderer.setSize(previousSize.x, previousSize.y, false);
        hidden.forEach((object) => { object.visible = true; });
        renderer.render(this.scene, this.camera);
        return new Promise((resolve, reject) => {
            output.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("O navegador não conseguiu capturar a cena 3D."))), "image/png");
        });
    }
}
