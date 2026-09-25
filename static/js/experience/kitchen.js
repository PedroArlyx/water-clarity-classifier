// Cozinha contemporânea em escala real (metros). Paleta neutra: marcenaria
// grafite, quartzo claro, carvalho, parede mineral e metais escovados.
import * as THREE from "/static/vendor/three.module.js";
import { mergeGeometries } from "/static/vendor/addons/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "/static/vendor/addons/RoundedBoxGeometry.js";
import * as tex from "./textures.js";

export const LAYOUT = Object.freeze({
    backZ: -2.2,
    counterY: 0.92,
    counterFrontZ: -1.56,
    sink: { x: 0.7, z: -1.86, w: 0.62, d: 0.4, depth: 0.19 },
    faucet: { x: 0.7, z: -2.1 },
    window: { x0: 0.15, x1: 1.25, y0: 1.12, y1: 2.05 },
    island: { x0: -1.0, x1: 1.1, z0: 0.35, z1: 1.25, top: 0.92 },
    cupStart: new THREE.Vector3(-1.3, 0.924, -1.76),
    stationCup: new THREE.Vector3(-0.72, 0.934, 0.64),
    dock: new THREE.Vector3(1.6, 0, -0.62),
});

function linearShadowTexture() {
    const element = document.createElement("canvas");
    element.width = 4;
    element.height = 64;
    const ctx = element.getContext("2d");
    const gradient = ctx.createLinearGradient(0, 0, 0, 64);
    gradient.addColorStop(0, "rgba(0,0,0,0.55)");
    gradient.addColorStop(0.35, "rgba(0,0,0,0.22)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 4, 64);
    const texture = new THREE.CanvasTexture(element);
    texture.colorSpace = THREE.NoColorSpace;
    return texture;
}

export function createMaterials(quality) {
    const floorTex = tex.oakPlanks({ size: quality === "low" ? 512 : 1024 });
    floorTex.map.repeat.set(6.5, 2.9);
    floorTex.roughnessMap.repeat.set(6.5, 2.9);
    const veneer = tex.oakVeneer();
    const quartz = tex.quartz();
    const plaster = tex.plaster();
    plaster.map.repeat.set(3, 1.5);
    const brushed = tex.brushedRoughness();
    brushed.repeat.set(2, 2);
    return {
        floor: new THREE.MeshStandardMaterial({ map: floorTex.map, roughnessMap: floorTex.roughnessMap, roughness: 1, metalness: 0 }),
        wall: new THREE.MeshStandardMaterial({ map: plaster.map, roughness: 0.94, metalness: 0 }),
        ceiling: new THREE.MeshStandardMaterial({ color: 0xf1efeb, roughness: 0.95 }),
        quartz: new THREE.MeshPhysicalMaterial({ map: quartz.map, roughness: 0.32, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.28 }),
        graphite: new THREE.MeshStandardMaterial({ color: 0x3d3f43, roughness: 0.58, metalness: 0.05 }),
        graphiteDeep: new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.8 }),
        whiteMatte: new THREE.MeshStandardMaterial({ color: 0xebe9e4, roughness: 0.58 }),
        oak: new THREE.MeshStandardMaterial({ map: veneer.map, roughness: 0.62, metalness: 0 }),
        chrome: new THREE.MeshStandardMaterial({ color: 0xeef0f2, metalness: 1, roughness: 0.08, envMapIntensity: 1.3 }),
        steel: new THREE.MeshStandardMaterial({ color: 0xd9dcde, metalness: 1, roughness: 0.4, roughnessMap: brushed, envMapIntensity: 1.25 }),
        blackMetal: new THREE.MeshStandardMaterial({ color: 0x1b1c1e, metalness: 0.6, roughness: 0.42 }),
        ceramic: new THREE.MeshPhysicalMaterial({ color: 0xf4f2ee, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.2 }),
        stoneware: new THREE.MeshStandardMaterial({ color: 0x8d8579, roughness: 0.78 }),
        terracotta: new THREE.MeshStandardMaterial({ color: 0xa87d64, roughness: 0.85 }),
        leaf: new THREE.MeshStandardMaterial({ color: 0x55694a, roughness: 0.7 }),
        jarGlass: new THREE.MeshPhysicalMaterial({ color: 0x000000, roughness: 0.04, transparent: true, opacity: 0.1, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, depthWrite: false }),
        windowGlass: new THREE.MeshPhysicalMaterial({ color: 0x000000, roughness: 0.02, transparent: true, opacity: 0.06, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, depthWrite: false }),
        ledWarm: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffe4c4).multiplyScalar(2.2) }),
        bulb: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd9b0).multiplyScalar(3) }),
        backlight: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(1.25) }),
        stationLed: new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9aa3ab) }),
        shadow: new THREE.MeshBasicMaterial({ map: tex.contactShadow(), transparent: true, depthWrite: false, color: 0x000000, opacity: 1 }),
        linearShadow: new THREE.MeshBasicMaterial({ alphaMap: linearShadowTexture(), transparent: true, depthWrite: false, color: 0x000000 }),
        outside: new THREE.MeshBasicMaterial({ map: tex.outsideView(), color: new THREE.Color(1.9, 1.9, 1.9) }),
    };
}

function add(parent, geometry, material, [x, y, z], { cast = true, receive = true, rotation } = {}) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    if (rotation) mesh.rotation.set(...rotation);
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    parent.add(mesh);
    return mesh;
}

// Caixa definida por limites (x0..x1, y0..y1, z0..z1), mais legível para layout.
function slab(parent, material, [x0, x1], [y0, y1], [z0, z1], options) {
    return add(parent, new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), material, [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], options);
}

function rounded(parent, material, [w, h, d], position, radius = 0.004, options) {
    return add(parent, new RoundedBoxGeometry(w, h, d, 2, radius), material, position, options);
}

function floorShadow(parent, material, width, depth, [x, y, z], rotationY = 0) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), material);
    mesh.rotation.set(-Math.PI / 2, 0, rotationY);
    mesh.position.set(x, y, z);
    mesh.renderOrder = 1;
    parent.add(mesh);
    return mesh;
}

function buildRoom(group, m) {
    const { backZ, window: win } = LAYOUT;
    const floor = add(group, new THREE.PlaneGeometry(7.8, 7), m.floor, [-0.1, 0, 1.3], { cast: false, rotation: [-Math.PI / 2, 0, 0] });
    floor.name = "floor";
    add(group, new THREE.PlaneGeometry(7.8, 7), m.ceiling, [-0.1, 2.7, 1.3], { cast: false, rotation: [Math.PI / 2, 0, 0] });
    // Parede de fundo em blocos, deixando o vão da janela aberto para o sol.
    const t = [backZ - 0.14, backZ];
    slab(group, m.wall, [-4, win.x0], [0, 2.7], t);
    slab(group, m.wall, [win.x1, 3.8], [0, 2.7], t);
    slab(group, m.wall, [win.x0, win.x1], [0, win.y0], t);
    slab(group, m.wall, [win.x0, win.x1], [win.y1, 2.7], t);
    add(group, new THREE.PlaneGeometry(7, 2.7), m.wall, [-4, 1.35, 1.3], { cast: false, rotation: [0, Math.PI / 2, 0] });
    add(group, new THREE.PlaneGeometry(7, 2.7), m.wall, [3.8, 1.35, 1.3], { cast: false, rotation: [0, -Math.PI / 2, 0] });
    // Rodapé discreto.
    slab(group, m.whiteMatte, [-4, 3.8], [0, 0.06], [backZ, backZ + 0.012], { cast: false });

    // Janela: caixilho preto fino, vidro com reflexo e paisagem desfocada.
    const frame = 0.028;
    const fz = [backZ - 0.1, backZ - 0.06];
    slab(group, m.blackMetal, [win.x0, win.x1], [win.y0, win.y0 + frame], fz);
    slab(group, m.blackMetal, [win.x0, win.x1], [win.y1 - frame, win.y1], fz);
    slab(group, m.blackMetal, [win.x0, win.x0 + frame], [win.y0, win.y1], fz);
    slab(group, m.blackMetal, [win.x1 - frame, win.x1], [win.y0, win.y1], fz);
    const mid = (win.x0 + win.x1) / 2;
    slab(group, m.blackMetal, [mid - 0.012, mid + 0.012], [win.y0, win.y1], fz);
    add(group, new THREE.PlaneGeometry(win.x1 - win.x0, win.y1 - win.y0), m.windowGlass, [mid, (win.y0 + win.y1) / 2, backZ - 0.08], { cast: false, receive: false });
    add(group, new THREE.PlaneGeometry(6, 3.6), m.outside, [mid, 1.7, -3.9], { cast: false, receive: false });
    // Peitoril em quartzo.
    slab(group, m.quartz, [win.x0, win.x1], [win.y0 - 0.02, win.y0], [backZ - 0.12, backZ + 0.03]);
}

function buildBaseRun(group, m) {
    const { backZ, counterY } = LAYOUT;
    const frontZ = backZ + 0.6;
    const x0 = -2.8;
    const x1 = 2.6;
    // Corpo, rodapé recuado e canal "gola" sob o tampo (sem puxadores).
    slab(group, m.graphiteDeep, [x0, x1], [0.1, 0.885], [backZ, frontZ - 0.02]);
    slab(group, m.graphiteDeep, [x0, x1], [0, 0.1], [backZ, frontZ - 0.07], { cast: false });
    const modules = [
        [-2.8, -2.2, "drawers"], [-2.2, -1.6, "door"], [-1.6, -1.0, "drawers"], [-1.0, -0.4, "door"],
        [-0.4, 0.3, "panel"], [0.3, 1.1, "pair"], [1.1, 1.7, "drawers"], [1.7, 2.2, "door"], [2.2, 2.6, "door"],
    ];
    const gap = 0.0035;
    const fy0 = 0.103;
    const fy1 = 0.852;
    const fz = frontZ - 0.009;
    for (const [a, b, type] of modules) {
        const width = b - a - gap;
        const cx = (a + b) / 2;
        if (type === "drawers") {
            const cuts = [fy0, 0.36, 0.62, fy1];
            for (let i = 0; i < 3; i += 1) {
                const h = cuts[i + 1] - cuts[i] - gap;
                rounded(group, m.graphite, [width, h, 0.018], [cx, (cuts[i] + cuts[i + 1]) / 2, fz], 0.003);
            }
            // Canais horizontais entre gavetas funcionam como puxadores.
            slab(group, m.steel, [a + 0.02, b - 0.02], [0.618, 0.622], [fz + 0.006, fz + 0.01], { cast: false });
            slab(group, m.steel, [a + 0.02, b - 0.02], [0.358, 0.362], [fz + 0.006, fz + 0.01], { cast: false });
        } else if (type === "pair") {
            const half = (b - a) / 2;
            rounded(group, m.graphite, [half - gap, fy1 - fy0, 0.018], [a + half / 2, (fy0 + fy1) / 2, fz], 0.003);
            rounded(group, m.graphite, [half - gap, fy1 - fy0, 0.018], [b - half / 2, (fy0 + fy1) / 2, fz], 0.003);
        } else {
            rounded(group, m.graphite, [width, fy1 - fy0, 0.018], [cx, (fy0 + fy1) / 2, fz], 0.003);
        }
    }
    slab(group, m.steel, [x0, x1], [0.876, 0.88], [frontZ - 0.03, frontZ - 0.026], { cast: false });

    // Tampo em quartzo com recorte real para a cuba (quatro placas).
    const { sink } = LAYOUT;
    const top = [counterY - 0.035, counterY];
    const tz = [backZ, backZ + 0.64];
    slab(group, m.quartz, [x0 - 0.02, sink.x - sink.w / 2], top, tz);
    slab(group, m.quartz, [sink.x + sink.w / 2, x1 + 0.02], top, tz);
    slab(group, m.quartz, [sink.x - sink.w / 2, sink.x + sink.w / 2], top, [backZ, sink.z - sink.d / 2]);
    slab(group, m.quartz, [sink.x - sink.w / 2, sink.x + sink.w / 2], top, [sink.z + sink.d / 2, backZ + 0.64]);

    // Cuba de aço escovado embutida.
    const floorY = counterY - 0.035 - sink.depth;
    const sx0 = sink.x - sink.w / 2 + 0.01;
    const sx1 = sink.x + sink.w / 2 - 0.01;
    const sz0 = sink.z - sink.d / 2 + 0.01;
    const sz1 = sink.z + sink.d / 2 - 0.01;
    slab(group, m.steel, [sx0, sx1], [floorY - 0.004, floorY], [sz0, sz1], { cast: false });
    slab(group, m.steel, [sx0 - 0.004, sx0], [floorY, counterY - 0.035], [sz0, sz1], { cast: false });
    slab(group, m.steel, [sx1, sx1 + 0.004], [floorY, counterY - 0.035], [sz0, sz1], { cast: false });
    slab(group, m.steel, [sx0, sx1], [floorY, counterY - 0.035], [sz0 - 0.004, sz0], { cast: false });
    slab(group, m.steel, [sx0, sx1], [floorY, counterY - 0.035], [sz1, sz1 + 0.004], { cast: false });
    add(group, new THREE.CylinderGeometry(0.032, 0.032, 0.004, 32), m.chrome, [sink.x + 0.12, floorY + 0.002, sink.z + 0.05], { cast: false });

    // Faixa de quartzo como backsplash, contornando o peitoril da janela.
    const { window: win } = LAYOUT;
    const bz = [backZ, backZ + 0.012];
    slab(group, m.quartz, [x0 - 0.02, win.x0], [counterY, 1.45], bz, { cast: false });
    slab(group, m.quartz, [win.x1, x1 + 0.02], [counterY, 1.45], bz, { cast: false });
    slab(group, m.quartz, [win.x0, win.x1], [counterY, win.y0 - 0.02], bz, { cast: false });

    floorShadow(group, m.linearShadow, x1 - x0 + 0.1, 0.35, [(x0 + x1) / 2, 0.002, frontZ + 0.1]);
}

function buildTallAndUpper(group, m) {
    const { backZ } = LAYOUT;
    // Coluna alta (geladeira embutida) no mesmo acabamento grafite.
    slab(group, m.graphiteDeep, [-3.6, -2.82], [0, 2.3], [backZ, backZ + 0.6]);
    rounded(group, m.graphite, [0.37, 1.32, 0.02], [-3.405, 0.77, backZ + 0.61], 0.003);
    rounded(group, m.graphite, [0.37, 1.32, 0.02], [-3.015, 0.77, backZ + 0.61], 0.003);
    rounded(group, m.graphite, [0.776, 0.84, 0.02], [-3.21, 1.87, backZ + 0.61], 0.003);
    add(group, new THREE.CylinderGeometry(0.008, 0.008, 0.7, 12), m.steel, [-3.23, 0.95, backZ + 0.64]);
    add(group, new THREE.CylinderGeometry(0.008, 0.008, 0.7, 12), m.steel, [-3.19, 0.95, backZ + 0.64]);
    slab(group, m.whiteMatte, [-3.62, -2.8], [2.3, 2.7], [backZ, backZ + 0.6]);
    floorShadow(group, m.linearShadow, 0.9, 0.35, [-3.21, 0.002, backZ + 0.7]);

    // Armário superior branco à direita da janela, com LED sob o módulo.
    const u0 = 1.45;
    const u1 = 2.2;
    const uz = [backZ, backZ + 0.34];
    slab(group, m.whiteMatte, [1.42, 2.62], [u0, u1], uz);
    rounded(group, m.whiteMatte, [0.595, u1 - u0 - 0.006, 0.018], [1.72, (u0 + u1) / 2, backZ + 0.35], 0.003);
    rounded(group, m.whiteMatte, [0.595, u1 - u0 - 0.006, 0.018], [2.32, (u0 + u1) / 2, backZ + 0.35], 0.003);
    slab(group, m.ledWarm, [1.46, 2.58], [u0 - 0.004, u0], [backZ + 0.28, backZ + 0.3], { cast: false, receive: false });
    slab(group, m.whiteMatte, [1.42, 2.62], [u1, 2.7], uz);

    // Prateleiras de carvalho à esquerda da janela.
    for (const y of [1.52, 1.92]) {
        slab(group, m.oak, [-2.6, -0.25], [y - 0.035, y], [backZ, backZ + 0.26]);
    }
}

function lathe(points, segments = 40) {
    return new THREE.LatheGeometry(points.map(([x, y]) => new THREE.Vector2(x, y)), segments);
}

function buildProps(group, m) {
    const { backZ, counterY } = LAYOUT;
    const shelf1 = 1.52;
    const shelf2 = 1.92;
    // Pratos empilhados.
    for (let i = 0; i < 5; i += 1) {
        add(group, lathe([[0, 0], [0.1, 0], [0.12, 0.012], [0.118, 0.014], [0.098, 0.004], [0, 0.004]], 48), m.ceramic, [-2.2, shelf1 + i * 0.014, backZ + 0.14]);
    }
    // Tigelas em cerâmica.
    const bowl = lathe([[0, 0], [0.035, 0], [0.07, 0.04], [0.075, 0.06], [0.07, 0.06], [0.064, 0.042], [0.03, 0.008], [0, 0.008]], 40);
    add(group, bowl, m.stoneware, [-1.82, shelf1, backZ + 0.13]);
    add(group, bowl, m.ceramic, [-1.62, shelf1, backZ + 0.13]);
    add(group, bowl, m.ceramic, [-1.62, shelf1 + 0.035, backZ + 0.13]).scale.setScalar(0.85);
    // Potes de vidro com grãos.
    for (const [x, h, color] of [[-1.05, 0.2, 0x6b4f35], [-0.86, 0.16, 0xd8c7a1], [-0.7, 0.13, 0x3d3a36]]) {
        add(group, new THREE.CylinderGeometry(0.048, 0.048, h * 0.6, 28), new THREE.MeshStandardMaterial({ color, roughness: 0.95 }), [x, shelf1 + h * 0.3, backZ + 0.13]);
        add(group, new THREE.CylinderGeometry(0.052, 0.052, h, 28, 1, false), m.jarGlass, [x, shelf1 + h / 2, backZ + 0.13], { cast: false });
        add(group, new THREE.CylinderGeometry(0.054, 0.054, 0.018, 28), m.oak, [x, shelf1 + h + 0.009, backZ + 0.13]);
    }
    // Planta pendente na prateleira superior.
    add(group, lathe([[0, 0], [0.06, 0], [0.075, 0.12], [0.07, 0.12], [0, 0.11]], 32), m.terracotta, [-1.3, shelf2, backZ + 0.13]);
    const leafGeometry = new THREE.IcosahedronGeometry(0.03, 1);
    const random = (() => { let s = 5; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
    for (let i = 0; i < 26; i += 1) {
        const angle = random() * Math.PI * 2;
        const drop = random() < 0.4 ? random() * 0.28 : random() * 0.06;
        const radius = 0.05 + random() * 0.06 + drop * 0.1;
        const leaf = add(group, leafGeometry, m.leaf, [-1.3 + Math.cos(angle) * radius, shelf2 + 0.14 - drop, backZ + 0.13 + Math.sin(angle) * radius * 0.7 + drop * 0.25]);
        leaf.scale.set(1, 0.45, 1.4);
        leaf.rotation.set(random(), random() * 3, random());
    }
    // Livros de receitas.
    for (const [x, w, h, color] of [[-0.55, 0.035, 0.24, 0x3f4a43], [-0.51, 0.03, 0.22, 0xc8b89c], [-0.475, 0.04, 0.25, 0x2b2c2e]]) {
        rounded(group, new THREE.MeshStandardMaterial({ color, roughness: 0.85 }), [w, h, 0.17], [x, shelf2 + h / 2, backZ + 0.11], 0.004);
    }

    // Bancada: tábua de corte apoiada, porta-sabão, chaleira e base do copo.
    const board = rounded(group, m.oak, [0.34, 0.46, 0.022], [-0.62, counterY + 0.228, backZ + 0.04], 0.01);
    board.rotation.x = -0.12;
    add(group, lathe([[0, 0], [0.028, 0], [0.03, 0.11], [0.012, 0.13], [0, 0.13]], 28), m.graphite, [1.13, counterY, backZ + 0.1]);
    add(group, new THREE.CylinderGeometry(0.004, 0.004, 0.04, 8), m.chrome, [1.13, counterY + 0.15, backZ + 0.1]);
    const kettle = lathe([[0, 0], [0.085, 0], [0.095, 0.02], [0.098, 0.12], [0.08, 0.2], [0.03, 0.215], [0, 0.215]], 44);
    add(group, kettle, m.whiteMatte, [2.05, counterY + 0.012, backZ + 0.3]);
    add(group, new THREE.CylinderGeometry(0.1, 0.1, 0.012, 40), m.graphite, [2.05, counterY + 0.006, backZ + 0.3]);
    const handle = add(group, new THREE.TorusGeometry(0.065, 0.011, 12, 28, Math.PI), m.graphite, [2.05, counterY + 0.13, backZ + 0.3]);
    handle.rotation.z = -Math.PI / 2;
    handle.position.x += 0.098;
    add(group, new THREE.CylinderGeometry(0.05, 0.05, 0.008, 40), m.oak, [LAYOUT.cupStart.x, counterY + 0.002, LAYOUT.cupStart.z]);

    // Vaso de ervas no peitoril.
    const { window: win } = LAYOUT;
    add(group, lathe([[0, 0], [0.045, 0], [0.055, 0.09], [0.05, 0.09], [0, 0.085]], 28), m.ceramic, [win.x1 - 0.14, win.y0, backZ - 0.03]);
    for (let i = 0; i < 12; i += 1) {
        const angle = random() * Math.PI * 2;
        const leaf = add(group, leafGeometry, m.leaf, [win.x1 - 0.14 + Math.cos(angle) * 0.03, win.y0 + 0.11 + random() * 0.07, backZ - 0.03 + Math.sin(angle) * 0.03]);
        leaf.scale.set(0.6, 0.9, 0.3);
        leaf.rotation.set(0, angle, 0.4);
    }
}

function buildFaucet(group, m) {
    const { faucet, counterY } = LAYOUT;
    const root = new THREE.Group();
    root.position.set(faucet.x, counterY, faucet.z);
    group.add(root);
    add(root, new THREE.CylinderGeometry(0.03, 0.032, 0.012, 36), m.chrome, [0, 0.006, 0]);
    add(root, new THREE.CylinderGeometry(0.021, 0.024, 0.13, 32), m.chrome, [0, 0.07, 0]);
    const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0.12, 0), new THREE.Vector3(0, 0.26, 0), new THREE.Vector3(0, 0.345, 0.015),
        new THREE.Vector3(0, 0.385, 0.085), new THREE.Vector3(0, 0.375, 0.17), new THREE.Vector3(0, 0.335, 0.23),
        new THREE.Vector3(0, 0.3, 0.245),
    ], false, "centripetal");
    add(root, new THREE.TubeGeometry(curve, 96, 0.0135, 24, false), m.chrome, [0, 0, 0]);
    // Aerador: pequeno cilindro escuro na ponta, voltado para baixo.
    add(root, new THREE.CylinderGeometry(0.0145, 0.0145, 0.018, 24), m.chrome, [0, 0.297, 0.245]);
    add(root, new THREE.CylinderGeometry(0.011, 0.011, 0.002, 24), m.blackMetal, [0, 0.2875, 0.245], { cast: false });
    const outlet = new THREE.Object3D();
    outlet.position.set(0, 0.286, 0.245);
    root.add(outlet);

    // Alavanca monocomando lateral: gira no eixo X (levantar = abrir).
    const lever = new THREE.Group();
    lever.position.set(-0.024, 0.1, 0);
    root.add(lever);
    add(lever, new THREE.CylinderGeometry(0.017, 0.017, 0.022, 28), m.chrome, [-0.011, 0, 0], { rotation: [0, 0, Math.PI / 2] });
    const arm = add(lever, new THREE.CapsuleGeometry(0.0055, 0.085, 6, 12), m.chrome, [-0.016, 0.004, 0.05], { rotation: [Math.PI / 2 - 0.12, 0, 0] });
    arm.scale.set(1, 1, 0.7);
    const tip = new THREE.Object3D();
    tip.position.set(-0.016, 0.012, 0.095);
    lever.add(tip);
    return { root, outlet, lever, leverTip: tip };
}

function buildIsland(group, m) {
    const { island } = LAYOUT;
    const top = island.top;
    slab(group, m.quartz, [island.x0 - 0.02, island.x1 + 0.02], [top - 0.04, top], [island.z0, island.z1]);
    slab(group, m.quartz, [island.x0 - 0.02, island.x0 + 0.02], [0, top - 0.04], [island.z0, island.z1]);
    slab(group, m.quartz, [island.x1 - 0.02, island.x1 + 0.02], [0, top - 0.04], [island.z0, island.z1]);
    slab(group, m.oak, [island.x0 + 0.02, island.x1 - 0.02], [0.08, top - 0.04], [island.z0 + 0.04, island.z1 - 0.02]);
    slab(group, m.graphiteDeep, [island.x0 + 0.02, island.x1 - 0.02], [0, 0.08], [island.z0 + 0.08, island.z1 - 0.06], { cast: false });
    // Ripas verticais no painel frontal da ilha.
    for (let x = island.x0 + 0.06; x < island.x1 - 0.04; x += 0.07) {
        slab(group, m.oak, [x, x + 0.045], [0.08, top - 0.05], [island.z1 - 0.022, island.z1 - 0.004]);
    }
    const shadowMesh = floorShadow(group, m.shadow, island.x1 - island.x0 + 0.6, island.z1 - island.z0 + 0.6, [(island.x0 + island.x1) / 2, 0.003, (island.z0 + island.z1) / 2]);
    shadowMesh.material = m.shadow.clone();
    shadowMesh.material.opacity = 0.75;

    // Fruteira em cerâmica.
    add(group, lathe([[0, 0], [0.06, 0], [0.13, 0.05], [0.14, 0.075], [0.132, 0.075], [0.12, 0.052], [0.055, 0.008], [0, 0.008]], 48), m.stoneware, [0.62, top, 0.82]);
    for (const [dx, dz, color, r] of [[0.02, 0.01, 0xd1a23a, 0.036], [-0.045, 0.03, 0xc98f2d, 0.034], [0.035, -0.045, 0x9aa24a, 0.033], [-0.02, -0.03, 0xd6aa42, 0.035]]) {
        add(group, new THREE.SphereGeometry(r, 24, 16), new THREE.MeshStandardMaterial({ color, roughness: 0.55 }), [0.62 + dx, top + 0.045 + r * 0.5, 0.82 + dz]);
    }

    // Luminárias pendentes: cúpula grafite, interior quente e lâmpada emissiva.
    const shade = lathe([[0.004, 0.2], [0.03, 0.2], [0.07, 0.14], [0.12, 0.02], [0.125, 0], [0.12, 0.002], [0.066, 0.135], [0.028, 0.193], [0.004, 0.193]], 48);
    const lights = [];
    for (const x of [-0.4, 0.5]) {
        add(group, new THREE.CylinderGeometry(0.0025, 0.0025, 0.75, 6), m.blackMetal, [x, 2.325, 0.8], { cast: false });
        add(group, shade, m.graphite, [x, 1.75, 0.8], { cast: false });
        add(group, new THREE.SphereGeometry(0.03, 20, 14), m.bulb, [x, 1.8, 0.8], { cast: false, receive: false });
        const light = new THREE.PointLight(0xffd2a1, 1.1, 0, 2);
        light.position.set(x, 1.76, 0.8);
        group.add(light);
        lights.push(light);
    }
    return lights;
}

// Estação de visão: base branca, painel de luz de fundo (backlight) e câmera.
// É o mesmo arranjo usado em inspeção visual de líquidos: fundo uniforme e
// luz transmitida tornam a turbidez mensurável pela câmera.
function buildVisionStation(group, m) {
    const cup = LAYOUT.stationCup;
    const top = LAYOUT.island.top;
    const station = new THREE.Group();
    group.add(station);
    rounded(station, m.whiteMatte, [0.36, 0.014, 0.22], [cup.x - 0.02, top + 0.007, cup.z], 0.005);
    const panelX = cup.x + 0.13;
    rounded(station, m.whiteMatte, [0.03, 0.31, 0.29], [panelX + 0.014, top + 0.165, cup.z], 0.01);
    add(station, new THREE.PlaneGeometry(0.25, 0.27), m.backlight, [panelX - 0.0015, top + 0.165, cup.z], { cast: false, receive: false, rotation: [0, -Math.PI / 2, 0] });
    const camX = cup.x - 0.17;
    add(station, new THREE.CylinderGeometry(0.009, 0.012, 0.05, 16), m.steel, [camX, top + 0.039, cup.z]);
    rounded(station, m.graphite, [0.046, 0.036, 0.05], [camX, top + 0.078, cup.z], 0.008);
    add(station, new THREE.CylinderGeometry(0.013, 0.013, 0.016, 28), m.blackMetal, [camX + 0.03, top + 0.078, cup.z], { rotation: [0, 0, Math.PI / 2] });
    add(station, new THREE.CircleGeometry(0.009, 24), new THREE.MeshPhysicalMaterial({ color: 0x0a0d12, roughness: 0.05, clearcoat: 1, metalness: 0.2 }), [camX + 0.0385, top + 0.078, cup.z], { cast: false, rotation: [0, Math.PI / 2, 0] });
    add(station, new THREE.CircleGeometry(0.004, 16), m.stationLed, [cup.x - 0.02, top + 0.0145, cup.z + 0.1], { cast: false, receive: false, rotation: [-Math.PI / 2, 0, 0] });

    const sensor = new THREE.PerspectiveCamera(44, 1, 0.01, 3);
    sensor.position.set(camX + 0.04, top + 0.078, cup.z);
    sensor.lookAt(cup.x, cup.y + 0.058, cup.z);
    group.add(sensor);
    return { sensor, led: m.stationLed, backlight: m.backlight };
}

function buildLights(scene, quality) {
    const hemi = new THREE.HemisphereLight(0xf2efe9, 0x8a7560, 0.35);
    scene.add(hemi);
    // Sol entrando pela janela: projeta o recorte do vão na bancada e no piso.
    const sun = new THREE.DirectionalLight(0xfff0dc, 3.4);
    sun.position.set(2.8, 5.2, -6.2);
    sun.target.position.set(0.1, 0.4, -0.2);
    sun.castShadow = true;
    const size = { low: 1024, medium: 2048, high: 2048 }[quality] || 2048;
    sun.shadow.mapSize.set(size, size);
    sun.shadow.camera.left = -3.2;
    sun.shadow.camera.right = 3.2;
    sun.shadow.camera.top = 3.4;
    sun.shadow.camera.bottom = -3.4;
    sun.shadow.camera.near = 2;
    sun.shadow.camera.far = 14;
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = 4;
    scene.add(sun, sun.target);
    // Preenchimento frontal suave (luz do ambiente atrás da câmera).
    const fill = new THREE.DirectionalLight(0xe8eef5, 0.55);
    fill.position.set(1.5, 2.5, 5);
    scene.add(fill);
    return { sun, hemi, fill };
}

export function buildKitchen(scene, quality) {
    const materials = createMaterials(quality);
    const group = new THREE.Group();
    group.name = "kitchen";
    scene.add(group);
    buildRoom(group, materials);
    buildBaseRun(group, materials);
    buildTallAndUpper(group, materials);
    buildProps(group, materials);
    const faucet = buildFaucet(group, materials);
    const pendants = buildIsland(group, materials);
    const station = buildVisionStation(group, materials);
    const lights = buildLights(scene, quality);
    group.updateMatrixWorld(true);
    const stats = mergeStatic(group);
    // Geometria estática: congelar matrizes reduz custo por frame.
    group.traverse((object) => {
        if (object === faucet.lever || faucet.lever.getObjectById(object.id)) return;
        object.matrixAutoUpdate = false;
    });
    return { group, materials, faucet, station, lights: { ...lights, pendants }, stats };
}

// Mescla malhas opacas estáticas que compartilham material (e flags de
// sombra) em uma única geometria: de ~200 para poucas dezenas de draw calls
// por passe (sombra, transmissão e principal), sem alterar a aparência.
function mergeStatic(group) {
    const buckets = new Map();
    for (const mesh of [...group.children]) {
        if (!mesh.isMesh || mesh.material.transparent || Array.isArray(mesh.material)) continue;
        const key = `${mesh.material.uuid}|${mesh.castShadow}|${mesh.receiveShadow}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(mesh);
    }
    let merged = 0;
    for (const meshes of buckets.values()) {
        if (meshes.length < 2) continue;
        const geometries = meshes.map((mesh) => {
            const source = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
            for (const name of Object.keys(source.attributes)) {
                if (!["position", "normal", "uv"].includes(name)) source.deleteAttribute(name);
            }
            source.applyMatrix4(mesh.matrixWorld);
            return source;
        });
        const geometry = mergeGeometries(geometries, false);
        geometries.forEach((item) => item.dispose());
        if (!geometry) continue;
        const combined = new THREE.Mesh(geometry, meshes[0].material);
        combined.castShadow = meshes[0].castShadow;
        combined.receiveShadow = meshes[0].receiveShadow;
        meshes.forEach((mesh) => group.remove(mesh));
        group.add(combined);
        merged += meshes.length;
    }
    return { merged };
}
