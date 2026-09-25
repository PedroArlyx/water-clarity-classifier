// Máquina de estados da tarefa "pegue um copo de água". Cada estado aciona
// robô, câmera e interface. A classificação vem exclusivamente da API: a
// aparência escolhida só altera o material da água antes da captura.
import * as THREE from "/static/vendor/three.module.js";
import { ease } from "./anim.js";
import { LAYOUT } from "./kitchen.js";

export const STATES = {
    idle: "Aguardando solicitação",
    request: "Solicitação recebida",
    toCup: "Indo até o copo",
    pick: "Pegando o copo",
    toSink: "Levando o copo à pia",
    open: "Abrindo a torneira",
    fill: "Enchendo o copo",
    close: "Fechando a torneira",
    toStation: "Levando à estação de visão",
    place: "Posicionando o copo",
    capture: "Capturando imagem",
    classify: "Consultando o modelo",
    decide: "Decidindo",
    deliver: "Entregando o copo",
    delivered: "Copo entregue",
    alert: "Entrega interrompida",
    error: "Falha na tarefa",
};

class Cancelled extends Error {}

export class Director {
    constructor(world, ui, audio) {
        this.world = world;
        this.ui = ui;
        this.audio = audio;
        this.token = 0;
        this.busy = false;
        this.idleTimer = 0;
        this.idleIndex = 0;
        world.onFrame((dt) => this.tickIdle(dt));
        world.stream.onImpact = null;
    }

    get A() { return this.world.animator; }

    check(token) {
        if (token !== this.token) throw new Cancelled();
    }

    async step(token, promise) {
        await promise;
        this.check(token);
    }

    state(key, detail) {
        this.current = key;
        this.ui.setState(key, STATES[key], detail);
    }

    // Olhar ocioso: o robô alterna o foco entre pontos de interesse.
    tickIdle(dt) {
        if (this.busy || (this.current && this.current !== "idle")) return;
        this.idleTimer -= dt;
        if (this.idleTimer > 0) return;
        const { robot, camera } = this.world;
        const targets = [camera.position, new THREE.Vector3(0.7, 1.5, -2.3), LAYOUT.cupStart.clone().setY(1), null];
        const target = targets[this.idleIndex % targets.length];
        robot.lookAt(target, target ? 0.8 : 0);
        this.idleIndex += 1;
        this.idleTimer = 2.8 + Math.random() * 2.2;
    }

    cancel() {
        this.token += 1;
        this.world.animator.cancelAll();
        this.busy = false;
    }

    cupCenterWorld() {
        return this.world.cup.group.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.06, 0));
    }

    async grab(token, arm, center) {
        const { robot, cup } = this.world;
        const A = this.A;
        const toRobot = robot.root.position.clone().sub(center).setY(0).normalize();
        const pre = center.clone().addScaledVector(toRobot, 0.08).add(new THREE.Vector3(0, 0.03, 0));
        this.A.tween(0.8, (t) => { arm.level = Math.max(arm.level, t); }, ease.inOutSine);
        await this.step(token, arm.setGoal({ point: pre, space: "world" }, 1.0, A));
        await this.step(token, arm.setGoal({ point: center.clone(), space: "world" }, 0.55, A, ease.outCubic));
        await this.step(token, A.tween(0.3, (t) => { arm.grip = t; }, ease.outCubic));
        this.audio.click();
        arm.socket.attach(cup.group);
        cup.held = true;
        // Pequena inclinação ao tirar o copo da superfície.
        A.tween(0.7, (t) => { arm.wobble = Math.sin(t * Math.PI * 2) * 0.05 * (1 - t); }, ease.linear);
        await this.step(token, arm.setGoal({ point: center.clone().add(new THREE.Vector3(0, 0.1, 0)), space: "world" }, 0.6, A));
    }

    async release(token, arm, center) {
        const { robot, cup, scene } = this.world;
        const A = this.A;
        await this.step(token, arm.setGoal({ point: center.clone().add(new THREE.Vector3(0, 0.05, 0)), space: "world" }, 0.9, A));
        await this.step(token, arm.setGoal({ point: center.clone().add(new THREE.Vector3(0, 0.002, 0)), space: "world" }, 0.5, A, ease.outCubic));
        scene.attach(cup.group);
        cup.held = false;
        // Assentamento: alinha o copo à superfície sem salto perceptível.
        const startPosition = cup.group.position.clone();
        const startQuaternion = cup.group.quaternion.clone();
        const endPosition = center.clone().sub(new THREE.Vector3(0, 0.06, 0));
        const identity = new THREE.Quaternion();
        A.tween(0.2, (t) => {
            cup.group.position.lerpVectors(startPosition, endPosition, t);
            cup.group.quaternion.slerpQuaternions(startQuaternion, identity, t);
        }, ease.outCubic);
        await this.step(token, A.tween(0.3, (t) => { arm.grip = 1 - t; }, ease.inOutSine));
        this.audio.click();
        const toRobot = robot.root.position.clone().sub(center).setY(0).normalize();
        await this.step(token, arm.setGoal({ point: center.clone().addScaledVector(toRobot, 0.1).add(new THREE.Vector3(0, 0.04, 0)), space: "world" }, 0.5, A));
        A.tween(0.6, (t) => { arm.level = 1 - t; }, ease.inOutSine);
        await this.step(token, arm.setGoal(robot.restGoal(arm), 0.9, A));
    }

    async operateLever(token, open) {
        const { robot, kitchen, stream } = this.world;
        const A = this.A;
        const arm = robot.arms.left;
        const lever = kitchen.faucet.lever;
        const tip = () => kitchen.faucet.leverTip.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.012, -0.03));
        A.tween(0.8, (t) => { robot.reachLean = 0.14 * t; }, ease.inOutSine);
        robot.lookAt(kitchen.faucet.leverTip.getWorldPosition(new THREE.Vector3()), 0.9);
        await this.step(token, arm.setGoal({ point: tip, space: "world" }, 1.1, A));
        this.audio.click();
        const from = lever.rotation.x;
        const to = open ? -0.5 : 0;
        await this.step(token, A.tween(open ? 0.7 : 0.55, (t) => {
            lever.rotation.x = from + (to - from) * t;
            stream.targetFlow = open ? t : 1 - t;
        }, ease.inOutSine));
        const rest = robot.restGoal(arm);
        A.tween(0.8, (t) => { robot.reachLean = 0.14 * (1 - t); }, ease.inOutSine);
        await this.step(token, arm.setGoal(rest, 0.9, A));
    }

    async waitFor(token, condition, timeout = 12) {
        let elapsed = 0;
        while (!condition() && elapsed < timeout) {
            await this.step(token, this.A.wait(0.05));
            elapsed += 0.05;
        }
    }

    async run({ appearance, upload, classify }) {
        this.cancel();
        const token = this.token;
        this.busy = true;
        const { world, ui, audio } = this;
        const { robot, rig, cup, stream, kitchen } = world;
        const A = this.A;
        const right = robot.arms.right;
        try {
            cup.setAppearance(appearance, true);
            stream.setTint(appearance);
            robot.setStatus("working");
            this.state("request");
            ui.say("Claro. Vou verificar a água antes de entregá-la.");
            rig.shot("greet");
            robot.lookAt(world.camera.position, 1);
            await this.step(token, A.wait(0.7));
            await this.step(token, robot.nod(A));

            // 1. Até o copo.
            this.state("toCup");
            const cupCenter = this.cupCenterWorld();
            robot.lookAt(cupCenter, 0.75);
            rig.followObject(robot.root, [1.05, 0.95, 1.9], [0, 0.72, 0], 40, 1.4);
            const pickStand = robot.standPoint(cupCenter, Math.PI, -0.12, 0.5);
            const walk = robot.moveAlong([new THREE.Vector3(1.1, 0, -0.9), new THREE.Vector3(-0.3, 0, -1.05), pickStand], A, { finalYaw: Math.PI });
            A.wait(3.2).then(() => { if (token === this.token && this.current === "toCup") rig.shot("pickup"); });
            await this.step(token, walk);

            // 2. Pega o copo.
            this.state("pick");
            rig.shot("pickup");
            robot.lookAt(cupCenter, 1);
            await this.grab(token, right, cupCenter);
            await this.step(token, right.setGoal(robot.carryGoal(right), 0.8, A));

            // 3. Até a pia.
            this.state("toSink");
            const outlet = kitchen.faucet.outlet.getWorldPosition(new THREE.Vector3());
            const fillCenter = new THREE.Vector3(outlet.x, LAYOUT.counterY + 0.115, outlet.z);
            const sinkStand = robot.standPoint(fillCenter, Math.PI, -0.12, 0.5);
            robot.lookAt(outlet, 0.6);
            rig.followObject(robot.root, [0.9, 0.85, 1.7], [0, 0.75, -0.3], 38, 1.5);
            await this.step(token, robot.moveAlong([sinkStand], A, { finalYaw: Math.PI }));
            rig.shot("sink");
            robot.lookAt(fillCenter, 1);
            await this.step(token, right.setGoal({ point: fillCenter, space: "world" }, 1.0, A));

            // 4. Abre a torneira e observa o enchimento.
            this.state("open");
            await this.operateLever(token, true);
            this.state("fill");
            rig.shot("fill");
            robot.lookAt(fillCenter, 1);
            await this.waitFor(token, () => cup.level >= 0.84);

            // 5. Fecha a torneira.
            this.state("close");
            await this.operateLever(token, false);
            await this.waitFor(token, () => !stream.mesh.visible, 3);
            cup.setLevel(Math.min(cup.level, 0.9));

            // 6. Estação de visão.
            this.state("toStation");
            rig.followObject(robot.root, [-0.2, 1.05, 2.1], [0, 0.7, 0.2], 40, 1.3);
            await this.step(token, right.setGoal(robot.carryGoal(right), 0.8, A));
            const stationCenter = LAYOUT.stationCup.clone().add(new THREE.Vector3(0, 0.06, 0));
            const stationStand = robot.standPoint(stationCenter, 0, -0.12, 0.55);
            robot.lookAt(stationCenter, 0.7);
            await this.step(token, robot.moveAlong([new THREE.Vector3(0.35, 0, -0.55), stationStand], A, { finalYaw: 0 }));
            this.state("place");
            rig.shot("toStation");
            robot.lookAt(stationCenter, 1);
            await this.release(token, right, stationCenter);

            // 7. Captura e classificação real.
            rig.shot("analysis");
            robot.setStatus("analyzing");
            world.setStationLed(true);
            await this.step(token, A.wait(1.1));
            this.state("capture");
            ui.pipeline("capture", "active");
            audio.capture();
            const image = upload || await world.capture();
            this.check(token);
            ui.showCapture(image, upload ? "Fotografia enviada" : "Câmera da estação · 512×512");
            ui.pipeline("capture", "done");
            this.state("classify");
            const prediction = await classify(image);
            this.check(token);
            await ui.revealAnalysis(prediction, (seconds) => this.step(token, A.wait(seconds)));
            world.setStationLed(false);

            // 8. Decisão.
            this.state("decide");
            rig.shot("result");
            robot.lookAt(world.camera.position, 0.9);
            ui.pipeline("decision", "done");
            if (prediction.classification === "limpo") {
                robot.setStatus("success");
                A.tween(0.4, (t) => { robot.expression = t; });
                audio.success();
                ui.showResult(prediction);
                ui.say("Água classificada visualmente como LIMPA. Vou entregar o copo.");
                await this.step(token, A.wait(1.6));
                this.state("deliver");
                robot.lookAt(stationCenter, 1);
                await this.grab(token, right, stationCenter);
                await this.step(token, right.setGoal(robot.carryGoal(right), 0.7, A));
                rig.shot("delivery");
                const handoff = new THREE.Vector3(-1.2, 0, 1.95);
                robot.lookAt(world.camera.position, 0.6);
                await this.step(token, robot.moveAlong([new THREE.Vector3(-1.38, 0, 0.2), new THREE.Vector3(-1.45, 0, 1.05), handoff], A, { finalYaw: 0.35 }));
                robot.lookAt(world.camera.position, 1);
                await this.step(token, right.setGoal({ point: new THREE.Vector3(-0.02, 1.02, 0.48), space: "body" }, 1.1, A, ease.anticipate));
                await this.step(token, robot.nod(A));
                this.state("delivered");
                ui.say("Aqui está. Lembre-se: a análise é apenas visual.");
            } else {
                robot.setStatus("alert");
                audio.alert();
                rig.shot("alert");
                ui.showResult(prediction);
                ui.say("Água classificada visualmente como SUJA. Não vou entregar este copo.");
                robot.headTilt = 0;
                A.tween(0.5, (t) => { robot.headTilt = 0.12 * t; });
                await this.step(token, robot.shake(A));
                this.state("alert");
            }
        } catch (error) {
            if (error instanceof Cancelled) return;
            stream.targetFlow = 0;
            robot.setStatus("alert");
            this.state("error");
            ui.showError(error instanceof Error ? error.message : "A demonstração não pôde ser concluída.");
        } finally {
            if (token === this.token) {
                this.busy = false;
                ui.finished();
            }
        }
    }
}
