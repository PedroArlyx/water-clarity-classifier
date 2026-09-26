// Fluxo de água da torneira. A coluna é uma malha com shader próprio:
// brilho por fresnel, estrias que descem e leve ondulação. A frente e a cauda
// caem com gravidade real, então abrir/fechar a torneira começa e termina de
// forma progressiva. Respingos e anéis aparecem no ponto de impacto.
import * as THREE from "/static/vendor/three.module.js";
import { clamp, damp } from "./anim.js";

const GRAVITY = 9.8;

const streamVertex = /* glsl */ `
uniform float uTime;
uniform float uLength;
uniform float uRadius;
varying vec3 vNormalView;
varying vec3 vViewDir;
varying float vAlong;
void main() {
    vAlong = uv.y;
    float along = 1.0 - uv.y;
    // A coluna afina levemente ao acelerar (conservação de vazão).
    float taper = mix(1.0, 0.72, clamp(along * uLength / 0.18, 0.0, 1.0));
    vec3 p = position;
    p.xz *= uRadius * taper;
    p.y *= uLength;
    float wobble = sin(p.y * 90.0 + uTime * 30.0) * 0.00045 * along;
    p.x += wobble;
    p.z += cos(p.y * 70.0 + uTime * 24.0) * 0.00035 * along;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vNormalView = normalize(normalMatrix * normal);
    vViewDir = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
}`;

const streamFragment = /* glsl */ `
uniform float uTime;
uniform float uOpacity;
uniform float uLength;
uniform vec3 uTint;
varying vec3 vNormalView;
varying vec3 vViewDir;
varying float vAlong;
float hash(float n) { return fract(sin(n) * 43758.5453); }
void main() {
    float fresnel = pow(1.0 - abs(dot(vNormalView, vViewDir)), 2.0);
    float y = (1.0 - vAlong) * uLength;
    float streak = 0.5 + 0.5 * sin(y * 420.0 - uTime * 38.0 + hash(floor(gl_FragCoord.x * 0.25)) * 6.0);
    float highlight = smoothstep(0.55, 1.0, fresnel) * 0.9 + streak * 0.12;
    vec3 base = uTint * 0.72;
    vec3 color = mix(base, vec3(1.0), clamp(highlight, 0.0, 1.0));
    float alpha = (0.18 + fresnel * 0.62 + streak * 0.06) * uOpacity;
    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}`;

const particleVertex = /* glsl */ `
attribute float aLife;
uniform float uSize;
varying float vLife;
void main() {
    vLife = aLife;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize * (1.0 / -mv.z) * step(0.001, aLife);
    gl_Position = projectionMatrix * mv;
}`;

const particleFragment = /* glsl */ `
uniform vec3 uTint;
varying float vLife;
void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float alpha = smoothstep(0.5, 0.1, d) * vLife * 0.75;
    gl_FragColor = vec4(mix(uTint, vec3(1.0), 0.6), alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}`;

export class WaterStream {
    constructor(scene, outlet, quality = "high") {
        this.scene = scene;
        this.outlet = outlet;
        this.flow = 0;
        this.targetFlow = 0;
        this.headY = null;
        this.headVelocity = 0;
        this.tailY = null;
        this.tailVelocity = 0;
        this.reached = false;
        this.impactY = () => 0.73;
        this.onImpact = null;
        this.origin = new THREE.Vector3();

        const geometry = new THREE.CylinderGeometry(1, 1, 1, 14, 24, true);
        geometry.translate(0, -0.5, 0);
        this.uniforms = {
            uTime: { value: 0 },
            uLength: { value: 0.1 },
            uRadius: { value: 0.006 },
            uOpacity: { value: 1 },
            uTint: { value: new THREE.Color(0xdfeef2) },
        };
        this.mesh = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
            uniforms: this.uniforms,
            vertexShader: streamVertex,
            fragmentShader: streamFragment,
            transparent: true,
            depthWrite: false,
        }));
        this.mesh.renderOrder = 5;
        this.mesh.frustumCulled = false;
        this.mesh.visible = false;
        scene.add(this.mesh);

        const count = { low: 24, medium: 48, high: 80 }[quality] ?? 60;
        const positions = new Float32Array(count * 3);
        this.velocities = new Float32Array(count * 3);
        this.life = new Float32Array(count);
        const particleGeometry = new THREE.BufferGeometry();
        particleGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        particleGeometry.setAttribute("aLife", new THREE.BufferAttribute(this.life, 1));
        this.particleUniforms = { uSize: { value: 5.5 * window.devicePixelRatio }, uTint: this.uniforms.uTint };
        this.particles = new THREE.Points(particleGeometry, new THREE.ShaderMaterial({
            uniforms: this.particleUniforms,
            vertexShader: particleVertex,
            fragmentShader: particleFragment,
            transparent: true,
            depthWrite: false,
        }));
        this.particles.frustumCulled = false;
        this.particles.renderOrder = 6;
        scene.add(this.particles);
        this.spawnAccumulator = 0;

        this.ripples = [];
        for (let i = 0; i < 3; i += 1) {
            const ripple = new THREE.Mesh(
                new THREE.RingGeometry(0.8, 1, 40),
                new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }),
            );
            ripple.rotation.x = -Math.PI / 2;
            ripple.renderOrder = 4;
            ripple.userData.age = 1;
            scene.add(ripple);
            this.ripples.push(ripple);
        }
        this.rippleTimer = 0;
    }

    setTint(mode) {
        this.uniforms.uTint.value.set(mode === "dirty" ? 0xa98457 : 0xdfeef2);
    }

    reset() {
        this.flow = 0;
        this.targetFlow = 0;
        this.headY = null;
        this.tailY = null;
        this.reached = false;
        this.mesh.visible = false;
        this.life.fill(0);
        this.particles.geometry.attributes.aLife.needsUpdate = true;
    }

    update(dt, time, reducedMotion) {
        this.uniforms.uTime.value = time;
        this.outlet.getWorldPosition(this.origin);
        const top = this.origin.y;
        const impact = this.impactY();
        this.flow = damp(this.flow, this.targetFlow, 6, dt);
        const flowing = this.targetFlow > 0.02;

        if (flowing) {
            this.tailY = null;
            if (this.headY === null) {
                this.headY = top;
                this.headVelocity = 0.25;
            }
            if (this.headY > impact) {
                this.headVelocity += GRAVITY * dt;
                this.headY -= this.headVelocity * dt;
            }
            this.reached = this.headY <= impact;
            this.drawColumn(top, Math.max(this.headY, impact));
        } else if (this.headY !== null) {
            // Torneira fechada: a cauda se solta do bico e cai até o impacto.
            if (this.tailY === null) {
                this.tailY = top;
                this.tailVelocity = 0.2;
            }
            this.tailVelocity += GRAVITY * dt;
            this.tailY -= this.tailVelocity * dt;
            const bottom = Math.max(this.headY, impact);
            if (this.tailY <= bottom + 0.002) {
                this.headY = null;
                this.tailY = null;
                this.reached = false;
                this.mesh.visible = false;
            } else {
                this.reached = this.headY <= impact;
                this.drawColumn(this.tailY, bottom);
            }
        }

        this.updateSplash(dt, impact, reducedMotion);
    }

    drawColumn(top, bottom) {
        const length = Math.max(0.001, top - bottom);
        this.mesh.visible = true;
        this.mesh.position.set(this.origin.x, top, this.origin.z);
        this.uniforms.uLength.value = length;
        this.uniforms.uRadius.value = 0.0022 + 0.0042 * clamp(this.flow, 0, 1);
        this.uniforms.uOpacity.value = clamp(this.flow * 1.6, 0.25, 1);
    }

    updateSplash(dt, impact, reducedMotion) {
        const positions = this.particles.geometry.attributes.position.array;
        const count = this.life.length;
        if (this.reached && this.mesh.visible && !reducedMotion) {
            this.spawnAccumulator += dt * 260 * this.flow;
            this.onImpact?.(this.flow);
        }
        for (let i = 0; i < count; i += 1) {
            if (this.life[i] <= 0 && this.spawnAccumulator >= 1) {
                this.spawnAccumulator -= 1;
                const angle = Math.random() * Math.PI * 2;
                const speed = 0.08 + Math.random() * 0.22;
                positions[i * 3] = this.origin.x + Math.cos(angle) * 0.004;
                positions[i * 3 + 1] = impact + 0.001;
                positions[i * 3 + 2] = this.origin.z + Math.sin(angle) * 0.004;
                this.velocities[i * 3] = Math.cos(angle) * speed;
                this.velocities[i * 3 + 1] = 0.25 + Math.random() * 0.45;
                this.velocities[i * 3 + 2] = Math.sin(angle) * speed;
                this.life[i] = 1;
            }
            if (this.life[i] > 0) {
                this.velocities[i * 3 + 1] -= GRAVITY * dt;
                positions[i * 3] += this.velocities[i * 3] * dt;
                positions[i * 3 + 1] += this.velocities[i * 3 + 1] * dt;
                positions[i * 3 + 2] += this.velocities[i * 3 + 2] * dt;
                this.life[i] -= dt * 3.2;
                if (positions[i * 3 + 1] < impact - 0.003) this.life[i] = 0;
            }
        }
        this.spawnAccumulator = Math.min(this.spawnAccumulator, 4);
        this.particles.geometry.attributes.position.needsUpdate = true;
        this.particles.geometry.attributes.aLife.needsUpdate = true;

        this.rippleTimer -= dt;
        if (this.reached && this.mesh.visible && this.rippleTimer <= 0 && !reducedMotion) {
            this.rippleTimer = 0.16;
            const ripple = this.ripples.find((item) => item.userData.age >= 1);
            if (ripple) {
                ripple.userData.age = 0;
                ripple.position.set(this.origin.x, impact + 0.0012, this.origin.z);
            }
        }
        for (const ripple of this.ripples) {
            if (ripple.userData.age < 1) {
                ripple.userData.age += dt * 2.2;
                const age = Math.min(1, ripple.userData.age);
                ripple.scale.setScalar(0.006 + age * 0.024);
                ripple.material.opacity = (1 - age) * 0.35;
                ripple.position.y = impact + 0.0012;
            } else {
                ripple.material.opacity = 0;
            }
        }
    }
}
