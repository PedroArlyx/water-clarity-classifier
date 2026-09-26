// Tweens e esperas avançam pelo relógio da cena (não por setTimeout), então
// tudo fica sincronizado, pode ser acelerado (timeScale) e nunca se sobrepõe.
export const ease = {
    linear: (t) => t,
    inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
    inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    outCubic: (t) => 1 - Math.pow(1 - t, 3),
    inCubic: (t) => t * t * t,
    smoother: (t) => t * t * t * (t * (t * 6 - 15) + 10),
    // Antecipação curta seguida de avanço: usado em gestos (alavanca, entrega).
    anticipate: (t) => {
        const s = 1.4;
        return t < 0.5 ? (Math.pow(2 * t, 2) * ((s + 1) * 2 * t - s)) / 2 : (Math.pow(2 * t - 2, 2) * ((s + 1) * (t * 2 - 2) + s) + 2) / 2;
    },
    outBack: (t) => {
        const c1 = 1.2;
        const c3 = c1 + 1;
        return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    },
};

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (current, target, lambda, dt) => lerp(current, target, 1 - Math.exp(-lambda * dt));

export function dampAngle(current, target, lambda, dt) {
    let delta = (target - current) % (Math.PI * 2);
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;
    return current + delta * (1 - Math.exp(-lambda * dt));
}

export class Animator {
    constructor() {
        this.tasks = new Set();
        this.timeScale = 1;
        this.time = 0;
    }

    update(rawDt) {
        const dt = rawDt * this.timeScale;
        this.time += dt;
        for (const task of [...this.tasks]) {
            task.elapsed += dt;
            const progress = task.duration <= 0 ? 1 : clamp(task.elapsed / task.duration, 0, 1);
            task.onUpdate?.(task.ease(progress), progress);
            if (progress >= 1) {
                this.tasks.delete(task);
                task.resolve();
            }
        }
        return dt;
    }

    tween(duration, onUpdate, easing = ease.inOutCubic) {
        return new Promise((resolve) => {
            this.tasks.add({ duration, onUpdate, ease: easing, elapsed: 0, resolve });
        });
    }

    wait(duration) {
        return this.tween(duration, null, ease.linear);
    }

    cancelAll() {
        for (const task of this.tasks) task.resolve();
        this.tasks.clear();
    }
}
