// Texturas procedurais geradas em canvas: nenhum arquivo externo é baixado.
// Cada função devolve texturas prontas para materiais PBR (cor + rugosidade).
import * as THREE from "/static/vendor/three.module.js";

function rng(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Value noise 2D com interpolação suave; suficiente para veios e manchas.
function valueNoise(seed) {
    const random = rng(seed);
    const size = 256;
    const table = new Float32Array(size * size);
    for (let i = 0; i < table.length; i += 1) table[i] = random();
    const at = (x, y) => table[((y & (size - 1)) * size) + (x & (size - 1))];
    return (x, y) => {
        const xi = Math.floor(x);
        const yi = Math.floor(y);
        const xf = x - xi;
        const yf = y - yi;
        const u = xf * xf * (3 - 2 * xf);
        const v = yf * yf * (3 - 2 * yf);
        const a = at(xi, yi);
        const b = at(xi + 1, yi);
        const c = at(xi, yi + 1);
        const d = at(xi + 1, yi + 1);
        return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
}

function fbm(noise, x, y, octaves = 4) {
    let value = 0;
    let amplitude = 0.5;
    let frequency = 1;
    for (let i = 0; i < octaves; i += 1) {
        value += amplitude * noise(x * frequency, y * frequency);
        frequency *= 2;
        amplitude *= 0.5;
    }
    return value;
}

function canvas(width, height = width) {
    const element = document.createElement("canvas");
    element.width = width;
    element.height = height;
    return element;
}

function toTexture(source, { color = true, repeat = [1, 1], anisotropy = 4 } = {}) {
    const texture = new THREE.CanvasTexture(source);
    texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(...repeat);
    texture.anisotropy = anisotropy;
    return texture;
}

// Tábuas de carvalho claro: cada tábua tem tom próprio, veios alongados e
// juntas discretas. A rugosidade acompanha os veios para quebrar o reflexo.
export function oakPlanks({ size = 1024, planks = 6, seed = 7, base = [196, 166, 128] } = {}) {
    const colorCanvas = canvas(size);
    const roughCanvas = canvas(size);
    const colorCtx = colorCanvas.getContext("2d");
    const roughCtx = roughCanvas.getContext("2d");
    const colorData = colorCtx.createImageData(size, size);
    const roughData = roughCtx.createImageData(size, size);
    const noise = valueNoise(seed);
    const random = rng(seed + 11);
    const plankWidth = size / planks;
    const plankTone = Array.from({ length: planks * 4 }, () => 0.93 + random() * 0.11);
    const plankOffset = Array.from({ length: planks }, () => random() * size);
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const plank = Math.floor(x / plankWidth);
            const localX = x - plank * plankWidth;
            const shiftedY = (y + plankOffset[plank]) % size;
            const segment = Math.floor(shiftedY / (size / 2));
            const tone = plankTone[(plank * 4 + segment) % plankTone.length];
            const warp = fbm(noise, x * 0.012, y * 0.0025, 3) * 26;
            const grain = Math.sin((localX + warp + plank * 13) * 0.55) * 0.5 + 0.5;
            const fine = fbm(noise, x * 0.35, y * 0.02, 2);
            const knot = fbm(noise, x * 0.004 + plank, y * 0.004, 3);
            let shade = tone * (0.9 + grain * 0.07 + fine * 0.08 - Math.max(0, knot - 0.62) * 0.4);
            const seam = localX < 1.5 || Math.abs(shiftedY % (size / 2)) < 1.5;
            if (seam) shade *= 0.72;
            const index = (y * size + x) * 4;
            colorData.data[index] = Math.min(255, base[0] * shade);
            colorData.data[index + 1] = Math.min(255, base[1] * shade);
            colorData.data[index + 2] = Math.min(255, base[2] * shade);
            colorData.data[index + 3] = 255;
            const rough = seam ? 235 : 150 + grain * 40 + fine * 30;
            roughData.data[index] = rough;
            roughData.data[index + 1] = rough;
            roughData.data[index + 2] = rough;
            roughData.data[index + 3] = 255;
        }
    }
    colorCtx.putImageData(colorData, 0, 0);
    roughCtx.putImageData(roughData, 0, 0);
    return { map: toTexture(colorCanvas), roughnessMap: toTexture(roughCanvas, { color: false }) };
}

// Madeira contínua (prateleiras, tábua de corte, ilha) sem juntas.
export function oakVeneer({ size = 512, seed = 21, base = [186, 152, 112] } = {}) {
    const colorCanvas = canvas(size);
    const ctx = colorCanvas.getContext("2d");
    const data = ctx.createImageData(size, size);
    const noise = valueNoise(seed);
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const warp = fbm(noise, x * 0.01, y * 0.004, 3) * 30;
            const grain = Math.sin((y + warp) * 0.42) * 0.5 + 0.5;
            const fine = fbm(noise, x * 0.03, y * 0.4, 2);
            const shade = 0.9 + grain * 0.07 + fine * 0.07;
            const index = (y * size + x) * 4;
            data.data[index] = base[0] * shade;
            data.data[index + 1] = base[1] * shade;
            data.data[index + 2] = base[2] * shade;
            data.data[index + 3] = 255;
        }
    }
    ctx.putImageData(data, 0, 0);
    return { map: toTexture(colorCanvas) };
}

// Quartzo claro com pontilhado fino e veio amplo de baixíssimo contraste.
export function quartz({ size = 512, seed = 3 } = {}) {
    const colorCanvas = canvas(size);
    const ctx = colorCanvas.getContext("2d");
    const data = ctx.createImageData(size, size);
    const noise = valueNoise(seed);
    const random = rng(seed + 5);
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const cloud = fbm(noise, x * 0.008, y * 0.008, 4);
            const vein = Math.pow(1 - Math.abs(Math.sin((x * 0.6 + y * 0.35 + cloud * 160) * 0.02)), 18);
            const speck = random() > 0.985 ? -(18 + random() * 30) : 0;
            const value = 236 - cloud * 10 - vein * 14 + speck;
            const index = (y * size + x) * 4;
            data.data[index] = value;
            data.data[index + 1] = value - 2;
            data.data[index + 2] = value - 6;
            data.data[index + 3] = 255;
        }
    }
    ctx.putImageData(data, 0, 0);
    return { map: toTexture(colorCanvas) };
}

// Reboco/pintura mineral: variação sutil para a parede não parecer um plano CG.
export function plaster({ size = 512, seed = 9, base = [236, 232, 225] } = {}) {
    const colorCanvas = canvas(size);
    const ctx = colorCanvas.getContext("2d");
    const data = ctx.createImageData(size, size);
    const noise = valueNoise(seed);
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const shade = 0.965 + fbm(noise, x * 0.02, y * 0.02, 4) * 0.05;
            const index = (y * size + x) * 4;
            data.data[index] = base[0] * shade;
            data.data[index + 1] = base[1] * shade;
            data.data[index + 2] = base[2] * shade;
            data.data[index + 3] = 255;
        }
    }
    ctx.putImageData(data, 0, 0);
    return { map: toTexture(colorCanvas) };
}

// Aço escovado: riscos horizontais na rugosidade simulam o acabamento anisotrópico.
export function brushedRoughness({ size = 256, seed = 17 } = {}) {
    const roughCanvas = canvas(size);
    const ctx = roughCanvas.getContext("2d");
    const data = ctx.createImageData(size, size);
    const noise = valueNoise(seed);
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const streak = fbm(noise, x * 0.01, y * 0.9, 3);
            const value = 70 + streak * 70;
            const index = (y * size + x) * 4;
            data.data[index] = value;
            data.data[index + 1] = value;
            data.data[index + 2] = value;
            data.data[index + 3] = 255;
        }
    }
    ctx.putImageData(data, 0, 0);
    return toTexture(roughCanvas, { color: false });
}

// Sombra de contato: gradiente radial usado sob robô, copo e objetos soltos.
export function contactShadow(size = 128) {
    const shadowCanvas = canvas(size);
    const ctx = shadowCanvas.getContext("2d");
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, "rgba(0,0,0,0.62)");
    gradient.addColorStop(0.45, "rgba(0,0,0,0.3)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    const texture = new THREE.CanvasTexture(shadowCanvas);
    texture.colorSpace = THREE.NoColorSpace;
    return texture;
}

// Vista externa desfocada (céu claro e vegetação), como uma janela fora de foco.
export function outsideView({ width = 512, height = 384, seed = 31 } = {}) {
    const viewCanvas = canvas(width, height);
    const ctx = viewCanvas.getContext("2d");
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, "#eef3f8");
    sky.addColorStop(0.6, "#f7f8f6");
    sky.addColorStop(1, "#dfe3da");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);
    const random = rng(seed);
    ctx.filter = "blur(18px)";
    for (let i = 0; i < 26; i += 1) {
        const x = random() * width;
        const y = height * (0.45 + random() * 0.6);
        const radius = 40 + random() * 90;
        const green = 150 + random() * 50;
        ctx.fillStyle = `rgba(${green * 0.78}, ${green}, ${green * 0.72}, 0.28)`;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.filter = "none";
    const texture = new THREE.CanvasTexture(viewCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}
