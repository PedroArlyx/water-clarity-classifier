// Robô assistente doméstico. Estilizado, mas com materiais premium: casca
// cerâmica com verniz, grafite acetinado, visor de vidro escuro e alumínio.
// Os braços usam IK analítico de dois segmentos, então as mãos alcançam
// pontos reais da cena (copo, alavanca, estação) sem animações pré-gravadas.
import * as THREE from "/static/vendor/three.module.js";
import { clamp, damp, dampAngle, ease, lerp } from "./anim.js";

const STATUS_COLORS = {
    idle: new THREE.Color(0xc9d3dc).multiplyScalar(1.1),
    working: new THREE.Color(0xdfe8ef).multiplyScalar(1.5),
    analyzing: new THREE.Color(0x8fd3ff).multiplyScalar(1.8),
    success: new THREE.Color(0x7fe0b0).multiplyScalar(1.6),
    alert: new THREE.Color(0xffb347).multiplyScalar(1.8),
};

function lathe(points, segments = 48) {
    return new THREE.LatheGeometry(points.map(([x, y]) => new THREE.Vector2(x, y)), segments);
}

function part(parent, geometry, material, position = [0, 0, 0], rotation) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    if (rotation) mesh.rotation.set(...rotation);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
}

class Arm {
    constructor(robot, side, materials) {
        this.robot = robot;
        this.side = side;
        this.L1 = 0.3;
        this.L2 = 0.28;
        this.socketOffset = 0.082;
        this.level = 0;
        this.grip = 0;
        this.wobble = 0;
        this.clamped = false;
        this.goalFrom = null;
        this.goalTo = null;
        this.blend = 1;
        this.cache = new THREE.Vector3();
        this.tmp = new THREE.Vector3();

        const { shell, graphite, metal } = materials;
        this.pivot = new THREE.Group();
        this.pivot.position.set(side * 0.215, 0.6, 0.0);
        this.pivot.rotation.order = "YXZ";
        robot.torso.add(this.pivot);
        part(this.pivot, new THREE.SphereGeometry(0.046, 28, 18), graphite);
        part(this.pivot, new THREE.TorusGeometry(0.043, 0.006, 10, 36), metal, [side * 0.012, 0, 0], [0, Math.PI / 2, 0]);
        part(this.pivot, new THREE.CapsuleGeometry(0.031, 0.2, 8, 20), shell, [0, -this.L1 / 2, 0]);

        this.elbow = new THREE.Group();
        this.elbow.position.y = -this.L1;
        this.pivot.add(this.elbow);
        part(this.elbow, new THREE.SphereGeometry(0.034, 24, 16), graphite);
        part(this.elbow, new THREE.CapsuleGeometry(0.027, 0.19, 8, 20), shell, [0, -this.L2 / 2 + 0.005, 0]);

        this.wrist = new THREE.Group();
        this.wrist.position.y = -this.L2;
        this.elbow.add(this.wrist);
        part(this.wrist, new THREE.CylinderGeometry(0.024, 0.024, 0.012, 24), metal, [0, 0.004, 0]);
        part(this.wrist, new THREE.SphereGeometry(0.026, 20, 14), graphite, [0, -0.012, 0]).scale.set(1.25, 0.9, 1.25);
        // Garra de dois dedos com almofadas: fecham em volta do copo.
        this.fingers = [];
        for (const s of [-1, 1]) {
            const finger = new THREE.Group();
            finger.position.set(s * 0.05, -0.03, 0);
            this.wrist.add(finger);
            part(finger, new THREE.BoxGeometry(0.008, 0.07, 0.036), graphite, [0, -0.032, 0]);
            part(finger, new THREE.BoxGeometry(0.003, 0.04, 0.03), materials.pad, [-s * 0.0055, -0.042, 0]);
            this.fingers.push({ group: finger, side: s });
        }
        this.socket = new THREE.Object3D();
        this.socket.position.set(0, -this.socketOffset, 0);
        this.wrist.add(this.socket);
    }

    // Um objetivo é um ponto no mundo ou no espaço do robô ("body"),
    // opcionalmente dinâmico (função), para acompanhar alavancas em movimento.
    resolveGoal(goal, out) {
        if (!goal) return out.set(0, 0, 0);
        const value = typeof goal.point === "function" ? goal.point() : goal.point;
        out.copy(value);
        if (goal.space === "body") this.robot.root.localToWorld(out);
        return out;
    }

    setGoal(goal, duration, animator, easing = ease.inOutCubic) {
        const from = this.currentGoalWorld().clone();
        this.goalFrom = { point: from, space: "world" };
        this.goalTo = goal;
        this.blend = 0;
        if (!animator || duration <= 0) {
            this.blend = 1;
            return Promise.resolve();
        }
        return animator.tween(duration, (t) => { this.blend = t; }, easing);
    }

    currentGoalWorld() {
        if (!this.goalTo) return this.cache;
        const to = this.resolveGoal(this.goalTo, this.tmp);
        if (this.blend >= 1 || !this.goalFrom) return this.cache.copy(to);
        const from = this.resolveGoal(this.goalFrom, new THREE.Vector3());
        // Arco suave: a mão sobe um pouco no meio do trajeto (não atravessa objetos).
        const lift = Math.sin(Math.PI * this.blend) * Math.min(0.08, from.distanceTo(to) * 0.25);
        return this.cache.copy(from).lerp(to, this.blend).add(new THREE.Vector3(0, lift, 0));
    }

    solve() {
        const goal = this.currentGoalWorld();
        const local = this.robot.torso.worldToLocal(goal.clone()).sub(this.pivot.position);
        const horizontal = Math.hypot(local.x, local.z);
        const dirX = horizontal > 1e-4 ? local.x / horizontal : 0;
        const dirZ = horizontal > 1e-4 ? local.z / horizontal : 1;
        // Com a mão nivelada, o alvo é o centro do objeto: o punho fica atrás dele.
        const offset = this.socketOffset * this.level;
        const wx = local.x - dirX * offset;
        const wz = local.z - dirZ * offset;
        const f = Math.max(0.02, Math.hypot(wx, wz));
        // Alvos quase abaixo do ombro: yaw converge para frente e evita giros bruscos.
        const rawYaw = Math.atan2(wx, wz);
        const yaw = f < 0.08 ? rawYaw * (f / 0.08) : rawYaw;
        const v = local.y;
        const reach = this.L1 + this.L2 - 0.002;
        const rawDistance = Math.hypot(f, v);
        this.clamped = rawDistance > reach + 0.01;
        const D = clamp(rawDistance, 0.12, reach);
        const gamma = Math.acos(clamp((this.L1 ** 2 + this.L2 ** 2 - D ** 2) / (2 * this.L1 * this.L2), -1, 1));
        const theta2 = Math.PI - gamma;
        const phi = Math.atan2(f, -v);
        const alpha = Math.acos(clamp((this.L1 ** 2 + D ** 2 - this.L2 ** 2) / (2 * this.L1 * D), -1, 1));
        const theta1 = phi - alpha;
        this.pivot.rotation.set(-theta1, yaw, this.side * 0.04);
        this.elbow.rotation.x = -theta2;
        const levelPitch = theta1 + theta2 - Math.PI / 2;
        this.wrist.rotation.x = lerp(0.12, levelPitch, this.level) + this.wobble;
        this.wrist.rotation.z = -this.side * 0.04 * this.level;
        const open = 0.05;
        const closed = 0.0392;
        for (const finger of this.fingers) finger.group.position.x = finger.side * lerp(open, closed, this.grip);
    }
}

export class Robot {
    constructor() {
        this.root = new THREE.Group();
        this.root.name = "robot";
        this.yaw = 0;
        this.lean = 0;
        this.leanTarget = 0;
        this.speed = 0;
        this.lookTarget = null;
        this.lookWeight = 0;
        this.headYaw = 0;
        this.headPitch = 0;
        this.headTilt = 0;
        this.blinkTimer = 2.5;
        this.blink = 0;
        this.expression = 0;
        this.status = "idle";
        this.statusColor = STATUS_COLORS.idle.clone();
        this.moving = false;
        this.gesture = { nod: 0, shake: 0 };

        const materials = {
            shell: new THREE.MeshPhysicalMaterial({ color: 0xf2f1ee, roughness: 0.34, metalness: 0, clearcoat: 0.85, clearcoatRoughness: 0.14 }),
            graphite: new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.46, metalness: 0.35 }),
            metal: new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.28, metalness: 1 }),
            visor: new THREE.MeshPhysicalMaterial({ color: 0x07080a, roughness: 0.05, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.03 }),
            pad: new THREE.MeshStandardMaterial({ color: 0x4a4d52, roughness: 0.9 }),
            eye: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xdff3ff).multiplyScalar(2.4) }),
            ring: new THREE.MeshBasicMaterial({ color: STATUS_COLORS.idle.clone() }),
        };
        this.materials = materials;

        // Base omnidirecional (as rodas ficam ocultas sob a saia).
        part(this.root, lathe([[0, 0.012], [0.19, 0.012], [0.228, 0.03], [0.24, 0.08], [0.232, 0.17], [0.2, 0.245], [0.16, 0.285], [0.12, 0.3], [0, 0.3]], 56), materials.graphite);
        this.ring = part(this.root, new THREE.TorusGeometry(0.2405, 0.0035, 10, 72), materials.ring, [0, 0.06, 0], [Math.PI / 2, 0, 0]);
        this.ring.castShadow = false;

        this.torso = new THREE.Group();
        this.torso.position.y = 0.3;
        this.root.add(this.torso);
        part(this.torso, new THREE.TorusGeometry(0.135, 0.012, 14, 56), materials.metal, [0, 0.004, 0], [Math.PI / 2, 0, 0]);
        part(this.torso, lathe([[0, 0], [0.14, 0], [0.185, 0.05], [0.208, 0.16], [0.213, 0.33], [0.2, 0.5], [0.172, 0.6], [0.125, 0.675], [0.065, 0.712], [0, 0.72]], 64), materials.shell);
        part(this.torso, new THREE.CylinderGeometry(0.05, 0.058, 0.07, 32), materials.graphite, [0, 0.74, 0]);

        // Display curvo no peito: estado do agente desenhado em canvas.
        this.displayCanvas = document.createElement("canvas");
        this.displayCanvas.width = 256;
        this.displayCanvas.height = 96;
        this.displayTexture = new THREE.CanvasTexture(this.displayCanvas);
        this.displayTexture.colorSpace = THREE.SRGBColorSpace;
        part(this.torso, new THREE.CylinderGeometry(0.2155, 0.2155, 0.085, 40, 1, true, -0.42, 0.84), materials.visor, [0, 0.4, 0]);
        const display = part(this.torso, new THREE.CylinderGeometry(0.2165, 0.2165, 0.07, 40, 1, true, -0.38, 0.76), new THREE.MeshBasicMaterial({ map: this.displayTexture, transparent: true }), [0, 0.4, 0]);
        display.castShadow = false;

        // Cabeça: casca, visor, olhos e "orelhas" sensoriais.
        this.neck = new THREE.Group();
        this.neck.position.y = 0.76;
        this.neck.rotation.order = "YXZ";
        this.torso.add(this.neck);
        this.head = new THREE.Group();
        this.head.position.y = 0.125;
        this.head.scale.set(1.12, 0.9, 1);
        this.neck.add(this.head);
        part(this.head, new THREE.SphereGeometry(0.15, 48, 32), materials.shell);
        part(this.head, new THREE.SphereGeometry(0.1512, 48, 24, Math.PI / 2 - 0.95, 1.9, 0.98, 1.0), materials.visor);
        this.eyes = [];
        for (const s of [-1, 1]) {
            const eye = part(this.head, new THREE.CapsuleGeometry(0.0115, 0.018, 6, 16), materials.eye, [s * 0.05, 0.004, 0.1455], [0, 0, Math.PI / 2]);
            eye.scale.z = 0.35;
            eye.rotation.y = s * 0.33;
            eye.castShadow = false;
            this.eyes.push(eye);
        }
        for (const s of [-1, 1]) {
            part(this.head, new THREE.CylinderGeometry(0.036, 0.036, 0.02, 32), materials.graphite, [s * 0.146, 0, 0], [0, 0, Math.PI / 2]);
            part(this.head, new THREE.TorusGeometry(0.024, 0.0025, 8, 32), materials.ring, [s * 0.157, 0, 0], [0, Math.PI / 2, 0]).castShadow = false;
        }

        this.arms = { left: new Arm(this, 1, materials), right: new Arm(this, -1, materials) };
        for (const arm of Object.values(this.arms)) arm.setGoal(this.restGoal(arm), 0);

        this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.85), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, depthWrite: false, opacity: 0.85 }));
        this.shadow.rotation.x = -Math.PI / 2;
        this.shadow.position.y = 0.003;
        this.shadow.renderOrder = 1;
        this.root.add(this.shadow);
        this.drawDisplay(0);
    }

    setShadowTexture(texture) {
        this.shadow.material.alphaMap = texture;
        this.shadow.material.needsUpdate = true;
    }

    restGoal(arm) {
        return { point: new THREE.Vector3(arm.side * 0.255, 0.5, 0.07), space: "body" };
    }

    carryGoal(arm) {
        return { point: new THREE.Vector3(arm.side * 0.12, 0.86, 0.36), space: "body" };
    }

    place(position, yaw) {
        this.root.position.set(position.x, 0, position.z);
        this.yaw = yaw;
        this.root.rotation.y = yaw;
    }

    setStatus(status) {
        this.status = status;
    }

    lookAt(target, weight = 1) {
        this.lookTarget = target ? target.clone() : null;
        this.lookWeight = target ? weight : 0;
    }

    // Posição onde o robô deve parar para que um ponto fique à frente, deslocado
    // lateralmente (lado da mão usada) e a uma distância de alcance confortável.
    standPoint(worldPoint, yaw, lateral, forward) {
        const cos = Math.cos(yaw);
        const sin = Math.sin(yaw);
        const x = worldPoint.x - (lateral * cos + forward * sin);
        const z = worldPoint.z - (-lateral * sin + forward * cos);
        return new THREE.Vector3(x, 0, z);
    }

    // Percurso com aceleração/desaceleração suaves, direção acompanhando a
    // tangente e inclinação do tronco proporcional à aceleração.
    async moveAlong(points, animator, { finalYaw = null, speed = 0.55 } = {}) {
        const curve = new THREE.CatmullRomCurve3([this.root.position.clone(), ...points].map((p) => new THREE.Vector3(p.x, 0, p.z)), false, "centripetal", 0.4);
        const length = curve.getLength();
        if (length < 0.02) {
            if (finalYaw !== null) await this.turnTo(finalYaw, animator);
            return;
        }
        // Antecipação: pequena inclinação para trás antes de partir.
        this.leanTarget = -0.035;
        await animator.wait(0.22);
        const duration = Math.max(1.4, length / speed + 0.8);
        this.moving = true;
        let previous = 0;
        let previousVelocity = 0;
        const tangent = new THREE.Vector3();
        await animator.tween(duration, (s, raw) => {
            const point = curve.getPointAt(s);
            this.root.position.set(point.x, 0, point.z);
            curve.getTangentAt(Math.min(s, 0.999), tangent);
            let heading = Math.atan2(tangent.x, tangent.z);
            if (finalYaw !== null && raw > 0.82) {
                const k = ease.inOutSine((raw - 0.82) / 0.18);
                heading = this.blendAngle(heading, finalYaw, k);
            }
            this.targetYaw = heading;
            const velocity = (s - previous) * length;
            this.leanTarget = clamp((velocity - previousVelocity) * 12, -0.07, 0.07) + clamp(velocity * 1.4, 0, 0.03);
            this.speed = velocity;
            previous = s;
            previousVelocity = velocity;
        }, ease.inOutSine);
        this.moving = false;
        this.speed = 0;
        this.leanTarget = -0.02;
        if (finalYaw !== null) await this.turnTo(finalYaw, animator, 0.35);
        this.leanTarget = 0;
    }

    blendAngle(a, b, t) {
        let delta = (b - a) % (Math.PI * 2);
        if (delta > Math.PI) delta -= Math.PI * 2;
        if (delta < -Math.PI) delta += Math.PI * 2;
        return a + delta * t;
    }

    async turnTo(yaw, animator, duration = 0.7) {
        const start = this.targetYaw ?? this.yaw;
        await animator.tween(duration, (t) => { this.targetYaw = this.blendAngle(start, yaw, t); }, ease.inOutSine);
    }

    nod(animator) {
        return animator.tween(0.8, (t) => { this.gesture.nod = Math.sin(t * Math.PI * 2) * 0.12 * (1 - t); }, ease.linear);
    }

    shake(animator) {
        return animator.tween(1.1, (t) => { this.gesture.shake = Math.sin(t * Math.PI * 4) * 0.2 * (1 - t); }, ease.linear);
    }

    drawDisplay(time) {
        const ctx = this.displayCanvas.getContext("2d");
        const { width, height } = this.displayCanvas;
        ctx.clearRect(0, 0, width, height);
        const color = `#${this.statusColor.clone().multiplyScalar(0.62).getHexString()}`;
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 7;
        ctx.lineCap = "round";
        const cx = width / 2;
        const cy = height / 2;
        if (this.status === "analyzing") {
            ctx.beginPath();
            ctx.arc(cx, cy, 24, time * 5, time * 5 + Math.PI * 1.3);
            ctx.stroke();
        } else if (this.status === "success") {
            ctx.beginPath();
            ctx.moveTo(cx - 22, cy + 2);
            ctx.lineTo(cx - 6, cy + 18);
            ctx.lineTo(cx + 24, cy - 16);
            ctx.stroke();
        } else if (this.status === "alert") {
            ctx.beginPath();
            ctx.moveTo(cx, cy - 22);
            ctx.lineTo(cx, cy + 6);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(cx, cy + 20, 4.5, 0, Math.PI * 2);
            ctx.fill();
        } else {
            for (let i = -1; i <= 1; i += 1) {
                const pulse = this.status === "working" ? 0.5 + 0.5 * Math.sin(time * 5 - i * 0.9) : 0.55;
                ctx.globalAlpha = 0.35 + pulse * 0.65;
                ctx.beginPath();
                ctx.arc(cx + i * 26, cy, 6, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
        }
        this.displayTexture.needsUpdate = true;
    }

    update(dt, time, reducedMotion) {
        if (this.targetYaw === undefined) this.targetYaw = this.yaw;
        this.yaw = dampAngle(this.yaw, this.targetYaw, 9, dt);
        this.root.rotation.y = this.yaw;
        this.lean = damp(this.lean, this.leanTarget, 6, dt);
        const breathing = reducedMotion ? 0 : Math.sin(time * 1.6) * 0.0035;
        this.torso.position.y = 0.3 + breathing;
        this.torso.rotation.x = this.lean + (this.reachLean || 0);
        this.torso.rotation.z = reducedMotion || this.moving ? 0 : Math.sin(time * 0.7) * 0.006;

        // Cabeça: acompanha o alvo com amortecimento, limites anatômicos e
        // pequena deriva ociosa. Gestos (acenar/negar) somam por cima.
        let yaw = reducedMotion ? 0 : Math.sin(time * 0.43) * 0.08;
        let pitch = reducedMotion ? 0 : Math.sin(time * 0.31) * 0.03;
        if (this.lookTarget && this.lookWeight > 0) {
            const local = this.torso.worldToLocal(this.lookTarget.clone()).sub(this.neck.position).sub(new THREE.Vector3(0, 0.12, 0));
            yaw = lerp(yaw, clamp(Math.atan2(local.x, local.z), -1.25, 1.25), this.lookWeight);
            pitch = lerp(pitch, clamp(Math.atan2(-local.y, Math.hypot(local.x, local.z)), -0.45, 0.6), this.lookWeight);
        }
        this.headYaw = damp(this.headYaw, yaw, 5, dt);
        this.headPitch = damp(this.headPitch, pitch, 5, dt);
        this.neck.rotation.set(this.headPitch + this.gesture.nod, this.headYaw + this.gesture.shake, this.headTilt);

        // Piscar ocasional e expressão (olhos semicerrados = sorriso discreto).
        this.blinkTimer -= dt;
        if (this.blinkTimer <= 0 && !reducedMotion) {
            this.blink = 1;
            this.blinkTimer = 2.8 + Math.random() * 3.5;
        }
        this.blink = Math.max(0, this.blink - dt * 7);
        const openness = 1 - Math.sin(this.blink * Math.PI) * 0.92;
        for (const eye of this.eyes) {
            eye.scale.y = openness * (1 - this.expression * 0.35);
            eye.position.y = 0.004 + this.expression * 0.004;
        }

        const target = STATUS_COLORS[this.status] || STATUS_COLORS.idle;
        this.statusColor.lerp(target, 1 - Math.exp(-4 * dt));
        const pulse = this.status === "analyzing" && !reducedMotion ? 0.75 + 0.25 * Math.sin(time * 6) : 1;
        this.materials.ring.color.copy(this.statusColor).multiplyScalar(pulse);
        this.eyeTint = this.status === "alert" ? 1 : 0;
        this.materials.eye.color.setRGB(2.1 + this.eyeTint * 0.3, 2.3 - this.eyeTint * 0.7, 2.4 - this.eyeTint * 1.5);
        this.displayTimer = (this.displayTimer || 0) - dt;
        if (this.displayTimer <= 0) {
            this.drawDisplay(time);
            this.displayTimer = 1 / 20;
        }

        this.root.updateMatrixWorld(true);
        for (const arm of Object.values(this.arms)) arm.solve();
    }
}
