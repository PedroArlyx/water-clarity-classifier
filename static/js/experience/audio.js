// Áudio ambiente sintetizado (WebAudio), sem arquivos externos. Volume baixo
// e nunca usado como único canal de informação.
export class AmbientAudio {
    constructor() {
        this.enabled = false;
        this.ctx = null;
    }

    ensure() {
        if (this.ctx) return true;
        const Context = window.AudioContext || window.webkitAudioContext;
        if (!Context) return false;
        this.ctx = new Context();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0;
        this.master.connect(this.ctx.destination);

        // Água: ruído filtrado cuja frequência sobe conforme o copo enche.
        const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
        this.noise = this.ctx.createBufferSource();
        this.noise.buffer = buffer;
        this.noise.loop = true;
        this.waterFilter = this.ctx.createBiquadFilter();
        this.waterFilter.type = "bandpass";
        this.waterFilter.frequency.value = 900;
        this.waterFilter.Q.value = 0.8;
        this.waterGain = this.ctx.createGain();
        this.waterGain.gain.value = 0;
        this.noise.connect(this.waterFilter).connect(this.waterGain).connect(this.master);
        this.noise.start();

        // Servo: zumbido grave e filtrado que acompanha a velocidade do robô.
        this.servo = this.ctx.createOscillator();
        this.servo.type = "sawtooth";
        this.servo.frequency.value = 70;
        const servoFilter = this.ctx.createBiquadFilter();
        servoFilter.type = "lowpass";
        servoFilter.frequency.value = 320;
        this.servoGain = this.ctx.createGain();
        this.servoGain.gain.value = 0;
        this.servo.connect(servoFilter).connect(this.servoGain).connect(this.master);
        this.servo.start();
        return true;
    }

    setEnabled(enabled) {
        this.enabled = enabled;
        if (enabled && !this.ensure()) return;
        if (!this.ctx) return;
        if (enabled && this.ctx.state === "suspended") this.ctx.resume();
        this.master.gain.setTargetAtTime(enabled ? 0.55 : 0, this.ctx.currentTime, 0.15);
    }

    update({ flow = 0, fill = 0, speed = 0 }) {
        if (!this.ctx || !this.enabled) return;
        const now = this.ctx.currentTime;
        this.waterGain.gain.setTargetAtTime(flow * 0.1, now, 0.08);
        this.waterFilter.frequency.setTargetAtTime(700 + fill * 1400, now, 0.2);
        this.servoGain.gain.setTargetAtTime(Math.min(1, speed * 60) * 0.022, now, 0.1);
        this.servo.frequency.setTargetAtTime(62 + Math.min(1, speed * 60) * 30, now, 0.1);
    }

    tone(frequencies, { duration = 0.35, gap = 0.12, volume = 0.05, type = "sine" } = {}) {
        if (!this.ctx || !this.enabled) return;
        frequencies.forEach((frequency, index) => {
            const start = this.ctx.currentTime + index * gap;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = type;
            osc.frequency.value = frequency;
            gain.gain.setValueAtTime(0, start);
            gain.gain.linearRampToValueAtTime(volume, start + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
            osc.connect(gain).connect(this.master);
            osc.start(start);
            osc.stop(start + duration + 0.05);
        });
    }

    click() { this.tone([1800], { duration: 0.05, volume: 0.03, type: "triangle" }); }
    capture() { this.tone([1320, 1760], { duration: 0.12, gap: 0.07, volume: 0.025 }); }
    success() { this.tone([660, 880], { duration: 0.5, gap: 0.14, volume: 0.04 }); }
    alert() { this.tone([440, 370], { duration: 0.45, gap: 0.18, volume: 0.04, type: "triangle" }); }
}
