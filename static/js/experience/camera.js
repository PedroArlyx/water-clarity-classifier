// Direção de câmera: cada plano define posição, alvo e distância focal.
// A câmera persegue o plano com amortecimento exponencial (sem cortes secos)
// e pode seguir o robô. No modo livre, o usuário orbita a cena.
import * as THREE from "/static/vendor/three.module.js";
import { clamp, damp } from "./anim.js";

export const SHOTS = {
    intro: { position: [3.25, 1.62, 4.1], target: [-0.35, 0.95, -0.9], fov: 36, lambda: 0.9 },
    overview: { position: [2.6, 1.62, 3.85], target: [0.62, 0.92, -0.9], fov: 40, lambda: 1.6 },
    greet: { position: [2.35, 1.38, 1.4], target: [1.5, 1.0, -0.62], fov: 34, lambda: 1.8 },
    pickup: { position: [-0.45, 1.42, -0.1], target: [-1.25, 0.98, -1.62], fov: 34, lambda: 1.6 },
    sink: { position: [1.75, 1.38, -0.55], target: [0.72, 1.05, -1.72], fov: 34, lambda: 1.5 },
    fill: { position: [1.22, 1.16, -1.28], target: [0.7, 1.03, -1.84], fov: 30, lambda: 1.3 },
    toStation: { position: [0.95, 1.5, 1.9], target: [-0.45, 0.95, 0.2], fov: 38, lambda: 1.4 },
    analysis: { position: [-1.3, 1.16, 1.14], target: [-0.64, 1.02, 0.56], fov: 32, lambda: 1.2 },
    result: { position: [-1.55, 1.32, 1.55], target: [-0.66, 1.02, 0.35], fov: 36, lambda: 1.2 },
    delivery: { position: [-0.1, 1.5, 4.25], target: [-1.15, 0.92, 1.85], fov: 38, lambda: 1.3 },
    alert: { position: [-1.6, 1.36, 1.75], target: [-0.62, 1.0, 0.3], fov: 38, lambda: 1.3 },
};

export class CameraRig {
    constructor(camera, element) {
        this.camera = camera;
        this.element = element;
        this.mode = "demo";
        this.position = new THREE.Vector3(...SHOTS.intro.position);
        this.target = new THREE.Vector3(...SHOTS.intro.target);
        this.goalPosition = this.position.clone();
        this.goalTarget = this.target.clone();
        this.goalFov = SHOTS.intro.fov;
        this.lambda = 1;
        this.follow = null;
        this.orbit = { theta: 0, phi: 1.2, radius: 4, dragging: false, x: 0, y: 0, vTheta: 0, vPhi: 0 };
        this.reducedMotion = false;
        camera.fov = this.goalFov;
        this.bindInput();
    }

    shot(name, overrides = {}) {
        const shot = { ...SHOTS[name], ...overrides };
        this.follow = null;
        this.goalPosition.set(...shot.position);
        this.goalTarget.set(...shot.target);
        this.goalFov = shot.fov;
        this.lambda = shot.lambda ?? 1.5;
        this.currentShot = name;
    }

    // Plano de acompanhamento: câmera mantém um deslocamento relativo ao robô.
    followObject(object, offset, targetOffset = [0, 0.75, 0], fov = 38, lambda = 1.6) {
        this.follow = { object, offset: new THREE.Vector3(...offset), targetOffset: new THREE.Vector3(...targetOffset) };
        this.goalFov = fov;
        this.lambda = lambda;
        this.currentShot = "follow";
    }

    cut() {
        this.position.copy(this.goalPosition);
        this.target.copy(this.goalTarget);
        this.camera.fov = this.goalFov;
    }

    setMode(mode) {
        this.mode = mode;
        if (mode === "free") {
            const offset = this.position.clone().sub(this.target);
            this.orbit.radius = offset.length();
            this.orbit.theta = Math.atan2(offset.x, offset.z);
            this.orbit.phi = Math.acos(clamp(offset.y / this.orbit.radius, -1, 1));
            this.freeTarget = this.target.clone();
        }
    }

    bindInput() {
        const el = this.element;
        el.addEventListener("pointerdown", (event) => {
            if (this.mode !== "free") return;
            this.orbit.dragging = true;
            this.orbit.x = event.clientX;
            this.orbit.y = event.clientY;
            el.setPointerCapture(event.pointerId);
        });
        el.addEventListener("pointermove", (event) => {
            if (!this.orbit.dragging) return;
            this.orbit.vTheta = -(event.clientX - this.orbit.x) * 0.005;
            this.orbit.vPhi = -(event.clientY - this.orbit.y) * 0.004;
            this.orbit.theta += this.orbit.vTheta;
            this.orbit.phi += this.orbit.vPhi;
            this.orbit.x = event.clientX;
            this.orbit.y = event.clientY;
        });
        const release = () => { this.orbit.dragging = false; };
        el.addEventListener("pointerup", release);
        el.addEventListener("pointercancel", release);
        el.addEventListener("wheel", (event) => {
            if (this.mode !== "free") return;
            event.preventDefault();
            this.orbit.radius = clamp(this.orbit.radius * (1 + event.deltaY * 0.001), 0.6, 6);
        }, { passive: false });
        el.addEventListener("keydown", (event) => {
            if (this.mode !== "free") return;
            const step = { ArrowLeft: [0.08, 0], ArrowRight: [-0.08, 0], ArrowUp: [0, -0.06], ArrowDown: [0, 0.06] }[event.key];
            if (step) {
                event.preventDefault();
                this.orbit.theta += step[0];
                this.orbit.phi += step[1];
            } else if (event.key === "+" || event.key === "=") {
                this.orbit.radius = clamp(this.orbit.radius * 0.9, 0.6, 6);
            } else if (event.key === "-") {
                this.orbit.radius = clamp(this.orbit.radius * 1.1, 0.6, 6);
            }
        });
    }

    update(dt, time) {
        if (this.mode === "free") {
            if (!this.orbit.dragging) {
                this.orbit.vTheta *= Math.exp(-6 * dt);
                this.orbit.vPhi *= Math.exp(-6 * dt);
                this.orbit.theta += this.orbit.vTheta * 0.4;
                this.orbit.phi += this.orbit.vPhi * 0.4;
            }
            this.orbit.phi = clamp(this.orbit.phi, 0.35, 1.52);
            const { theta, phi, radius } = this.orbit;
            this.goalTarget.copy(this.freeTarget);
            this.goalPosition.set(
                this.freeTarget.x + radius * Math.sin(phi) * Math.sin(theta),
                this.freeTarget.y + radius * Math.cos(phi),
                this.freeTarget.z + radius * Math.sin(phi) * Math.cos(theta),
            );
            // Mantém a câmera dentro da cozinha.
            this.goalPosition.x = clamp(this.goalPosition.x, -3.7, 3.5);
            this.goalPosition.y = clamp(this.goalPosition.y, 0.25, 2.5);
            this.goalPosition.z = clamp(this.goalPosition.z, -1.4, 4.6);
            this.position.lerp(this.goalPosition, 1 - Math.exp(-12 * dt));
            this.target.lerp(this.goalTarget, 1 - Math.exp(-12 * dt));
        } else {
            if (this.follow) {
                const origin = this.follow.object.position;
                this.goalTarget.copy(origin).add(this.follow.targetOffset);
                this.goalPosition.copy(origin).add(this.follow.offset);
            }
            const lambda = this.reducedMotion ? 30 : this.lambda;
            this.position.lerp(this.goalPosition, 1 - Math.exp(-lambda * dt));
            this.target.lerp(this.goalTarget, 1 - Math.exp(-lambda * 1.15 * dt));
        }
        this.camera.fov = damp(this.camera.fov, this.goalFov, 2.2, dt);
        this.camera.position.copy(this.position);
        // Respiração: deriva mínima, como uma câmera em estabilizador.
        if (this.mode === "demo" && !this.reducedMotion) {
            this.camera.position.x += Math.sin(time * 0.37) * 0.006;
            this.camera.position.y += Math.sin(time * 0.53) * 0.004;
        }
        this.camera.lookAt(this.target);
        this.camera.updateProjectionMatrix();
    }
}
