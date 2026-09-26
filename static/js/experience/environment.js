// Iluminação baseada em imagem gerada a partir de uma "sala" com painéis
// emissivos (janela, teto e rebatimento quente). O PMREM resultante fornece
// reflexos coerentes para vidro, água, metal e cerâmica sem baixar HDRI.
import * as THREE from "/static/vendor/three.module.js";

function panel(scene, { width, height, position, lookAt, color, intensity }) {
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    mesh.position.set(...position);
    mesh.lookAt(...lookAt);
    scene.add(mesh);
}

export function buildEnvironment(renderer) {
    const envScene = new THREE.Scene();
    const room = new THREE.Mesh(
        new THREE.BoxGeometry(12, 6, 12),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(0xc4c2bd).multiplyScalar(0.62), side: THREE.BackSide }),
    );
    room.position.y = 2.6;
    envScene.add(room);
    const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(12, 12),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(0xa08a70).multiplyScalar(0.4) }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.35;
    envScene.add(floor);
    // Janela: fonte dominante, fria e larga, atrás da bancada (-z).
    panel(envScene, { width: 3.2, height: 2.2, position: [0.6, 2.2, -5.9], lookAt: [0.6, 2.2, 0], color: 0xf4f7fb, intensity: 9 });
    // Softboxes de teto: realces longos em superfícies curvas (robô, copo).
    panel(envScene, { width: 4.5, height: 0.5, position: [0, 5.55, -1], lookAt: [0, 0, -1], color: 0xffffff, intensity: 3.2 });
    panel(envScene, { width: 4.5, height: 0.5, position: [0, 5.55, 1.5], lookAt: [0, 0, 1.5], color: 0xffffff, intensity: 2.2 });
    // Rebatimento quente lateral (madeira e parede iluminadas pelo sol).
    panel(envScene, { width: 2.5, height: 3, position: [-5.9, 2, 1], lookAt: [0, 2, 1], color: 0xffe9d2, intensity: 1.2 });
    panel(envScene, { width: 2, height: 2.5, position: [5.9, 2, 2], lookAt: [0, 2, 2], color: 0xe9eef5, intensity: 1.1 });

    const generator = new THREE.PMREMGenerator(renderer);
    const target = generator.fromScene(envScene, 0.035);
    generator.dispose();
    envScene.traverse((object) => {
        if (object.isMesh) {
            object.geometry.dispose();
            object.material.dispose();
        }
    });
    return target.texture;
}
