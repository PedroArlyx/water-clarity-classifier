// Copo de vidro e água. O vidro é uma casca de revolução com parede e fundo
// espessos (superfícies externa e interna), renderizada como reflexo
// especular sobre o fundo (blending pré-multiplicado). A água usa
// transmissão física (IOR 1,33) com atenuação volumétrica: a cor nasce da
// absorção ao atravessar o líquido, não de "opacity".
import * as THREE from "/static/vendor/three.module.js";
import { clamp, damp, lerp } from "./anim.js";

export const CUP = Object.freeze({
    height: 0.12,
    bottomY: 0.0125,
    maxWaterY: 0.106,
    innerRadius(y) {
        const t = clamp((y - 0.014) / (0.119 - 0.014), 0, 1);
        return lerp(0.0298, 0.0365, t);
    },
});

const APPEARANCE = {
    clean: {
        color: new THREE.Color(0xffffff),
        transmission: 1,
        roughness: 0.02,
        attenuationColor: new THREE.Color(0xe4f3f4),
        attenuationDistance: 0.55,
        particles: 0,
    },
    dirty: {
        // Turbidez: parte da luz é espalhada (componente difusa amarronzada),
        // o restante atravessa com forte absorção nos azuis.
        color: new THREE.Color(0xd6cbb0),
        transmission: 0.62,
        roughness: 0.32,
        attenuationColor: new THREE.Color(0xbba57c),
        attenuationDistance: 0.11,
        particles: 1,
    },
};

function circleSprite() {
    const element = document.createElement("canvas");
    element.width = 32;
    element.height = 32;
    const ctx = element.getContext("2d");
    const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.6, "rgba(255,255,255,0.6)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(element);
}

function glassProfile() {
    const points = [
        [0, 0], [0.026, 0], [0.0302, 0.0012], [0.0318, 0.005],
        [0.0322, 0.012], [0.0391, 0.1185], [0.039, 0.1196], [0.0382, 0.12], [0.0372, 0.1196], [0.0366, 0.119],
        [0.0299, 0.0148], [0.0292, 0.0128], [0.026, 0.0122], [0, 0.0122],
    ];
    return points.map(([x, y]) => new THREE.Vector2(x, y));
}

function waterProfile(level) {
    const top = lerp(CUP.bottomY + 0.002, CUP.maxWaterY, level);
    const bottom = CUP.bottomY + 0.0006;
    const inset = 0.0005;
    const rb = CUP.innerRadius(bottom) - inset - 0.0015;
    const rt = CUP.innerRadius(top) - inset;
    // Menisco: a água sobe levemente junto à parede (tensão superficial).
    return [
        [0, bottom], [rb, bottom], [rb + 0.0012, bottom + 0.0012], [rt, top], [rt - 0.0015, top - 0.0012], [rt * 0.6, top - 0.0017], [0, top - 0.0018],
    ].map(([x, y]) => new THREE.Vector2(x, y));
}

export class Cup {
    constructor(quality = "high") {
        this.group = new THREE.Group();
        this.group.name = "cup";
        this.level = 0;
        this.renderedLevel = -1;
        this.turbidity = 0;
        this.targetTurbidity = 0;
        this.bubbleActivity = 0;
        this.particleScale = { low: 0.4, medium: 0.7, high: 1 }[quality] ?? 1;

        const glassMaterial = new THREE.MeshPhysicalMaterial({
            color: 0x000000,
            metalness: 0,
            roughness: 0.015,
            ior: 1.5,
            specularIntensity: 1,
            envMapIntensity: 1.6,
            transparent: true,
            opacity: 0.08,
            blending: THREE.CustomBlending,
            blendSrc: THREE.OneFactor,
            blendDst: THREE.OneMinusSrcAlphaFactor,
            depthWrite: false,
            side: THREE.FrontSide,
        });
        this.glass = new THREE.Mesh(new THREE.LatheGeometry(glassProfile(), 72), glassMaterial);
        this.glass.renderOrder = 3;
        this.glass.castShadow = true;
        this.group.add(this.glass);

        this.waterMaterial = new THREE.MeshPhysicalMaterial({
            color: 0xffffff,
            metalness: 0,
            roughness: 0.02,
            transmission: 1,
            ior: 1.333,
            thickness: 0.065,
            attenuationColor: APPEARANCE.clean.attenuationColor.clone(),
            attenuationDistance: APPEARANCE.clean.attenuationDistance,
            specularIntensity: 1,
            envMapIntensity: 1.2,
        });
        this.water = new THREE.Mesh(new THREE.BufferGeometry(), this.waterMaterial);
        this.water.renderOrder = 2;
        this.water.visible = false;
        this.group.add(this.water);

        const sprite = circleSprite();
        // Partículas em suspensão (turbidez) — visíveis só na água turva.
        const suspendedCount = Math.round(260 * this.particleScale);
        this.suspended = this.makePoints(suspendedCount, 0.0016, 0x8a6a42, 0.55, sprite);
        this.suspendedSeeds = Float32Array.from({ length: suspendedCount * 3 }, () => Math.random());
        // Bolhas finas que sobem durante o enchimento.
        const bubbleCount = Math.round(70 * this.particleScale);
        this.bubbles = this.makePoints(bubbleCount, 0.0013, 0xffffff, 0.7, sprite);
        this.bubbleState = Float32Array.from({ length: bubbleCount * 3 }, () => Math.random());

        const shadow = new THREE.Mesh(
            new THREE.PlaneGeometry(0.13, 0.13),
            new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, depthWrite: false, opacity: 0.5 }),
        );
        shadow.rotation.x = -Math.PI / 2;
        shadow.position.y = 0.0008;
        shadow.renderOrder = 1;
        this.shadow = shadow;
        this.group.add(shadow);
        this.setLevel(0, true);
    }

    setShadowTexture(texture) {
        this.shadow.material.alphaMap = texture;
        this.shadow.material.needsUpdate = true;
    }

    makePoints(count, size, color, opacity, sprite) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
        const material = new THREE.PointsMaterial({ size, color, transparent: true, opacity, map: sprite, depthWrite: false, sizeAttenuation: true });
        const points = new THREE.Points(geometry, material);
        points.frustumCulled = false;
        points.renderOrder = 4;
        points.visible = false;
        this.group.add(points);
        return points;
    }

    get surfaceY() {
        return lerp(CUP.bottomY + 0.002, CUP.maxWaterY, this.level);
    }

    setLevel(level, force = false) {
        this.level = clamp(level, 0, 1);
        // Reconstrói a malha só quando a variação é perceptível.
        if (!force && Math.abs(this.level - this.renderedLevel) < 0.004) return;
        this.renderedLevel = this.level;
        this.water.visible = this.level > 0.01;
        const geometry = new THREE.LatheGeometry(waterProfile(this.level), 64);
        this.water.geometry.dispose();
        this.water.geometry = geometry;
    }

    setAppearance(mode, immediate = false) {
        this.targetTurbidity = mode === "dirty" ? 1 : 0;
        if (immediate) this.turbidity = this.targetTurbidity;
        this.applyAppearance();
    }

    applyAppearance() {
        const t = this.turbidity;
        const a = APPEARANCE.clean;
        const b = APPEARANCE.dirty;
        const m = this.waterMaterial;
        m.color.copy(a.color).lerp(b.color, t);
        m.transmission = lerp(a.transmission, b.transmission, t);
        m.roughness = lerp(a.roughness, b.roughness, t);
        m.attenuationColor.copy(a.attenuationColor).lerp(b.attenuationColor, t);
        // Interpolação logarítmica: a distância de atenuação varia em ordens de grandeza.
        m.attenuationDistance = Math.exp(lerp(Math.log(a.attenuationDistance), Math.log(b.attenuationDistance), t));
    }

    update(dt, time, reducedMotion) {
        if (Math.abs(this.turbidity - this.targetTurbidity) > 0.001) {
            this.turbidity = damp(this.turbidity, this.targetTurbidity, 3, dt);
            this.applyAppearance();
        }
        const surface = this.surfaceY;
        const hasWater = this.level > 0.02;

        // Suspensão: partículas lentas, sempre abaixo da superfície atual.
        this.suspended.visible = hasWater && this.turbidity > 0.05;
        if (this.suspended.visible) {
            this.suspended.material.opacity = 0.55 * this.turbidity;
            const positions = this.suspended.geometry.attributes.position.array;
            const drift = reducedMotion ? 0 : time;
            for (let i = 0; i < positions.length; i += 3) {
                const seed = this.suspendedSeeds;
                const y = CUP.bottomY + 0.003 + ((seed[i + 1] + drift * 0.004 * (0.3 + seed[i])) % 1) * (surface - CUP.bottomY - 0.005);
                const radius = Math.sqrt(seed[i]) * (CUP.innerRadius(y) - 0.002);
                const angle = seed[i + 2] * Math.PI * 2 + drift * 0.05 * (seed[i] - 0.5);
                positions[i] = Math.cos(angle) * radius;
                positions[i + 1] = y;
                positions[i + 2] = Math.sin(angle) * radius;
            }
            this.suspended.geometry.attributes.position.needsUpdate = true;
        }

        // Bolhas: nascem perto do fundo enquanto a água entra e somem na superfície.
        this.bubbles.visible = hasWater && this.bubbleActivity > 0.02 && !reducedMotion;
        if (this.bubbles.visible) {
            this.bubbles.material.opacity = 0.7 * this.bubbleActivity;
            const positions = this.bubbles.geometry.attributes.position.array;
            const state = this.bubbleState;
            for (let i = 0; i < positions.length; i += 3) {
                state[i + 1] += dt * (0.25 + state[i] * 0.5);
                if (state[i + 1] > 1) {
                    state[i + 1] = 0;
                    state[i] = Math.random();
                    state[i + 2] = Math.random();
                }
                const y = CUP.bottomY + 0.004 + state[i + 1] * (surface - CUP.bottomY - 0.006);
                const radius = Math.sqrt(state[i]) * (CUP.innerRadius(y) - 0.004);
                const angle = state[i + 2] * Math.PI * 2 + state[i + 1] * 2;
                positions[i] = Math.cos(angle) * radius;
                positions[i + 1] = y;
                positions[i + 2] = Math.sin(angle) * radius;
            }
            this.bubbles.geometry.attributes.position.needsUpdate = true;
        }
        this.bubbleActivity = Math.max(0, this.bubbleActivity - dt * 0.35);
    }
}
