// A synthesized switch click. No audio file, no network. Two short bursts: the snap and the seat.
let ctx: AudioContext | null = null;

export function playClick(on: boolean): void {
  try {
    ctx ??= new AudioContext();
    const t0 = ctx.currentTime;
    const burst = (at: number, freq: number, gain: number, dur: number) => {
      const len = Math.floor(ctx!.sampleRate * dur);
      const buf = ctx!.createBuffer(1, len, ctx!.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 6);
      const src = ctx!.createBufferSource();
      src.buffer = buf;
      const bp = ctx!.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = freq;
      bp.Q.value = 1.2;
      const g = ctx!.createGain();
      g.gain.value = gain;
      src.connect(bp).connect(g).connect(ctx!.destination);
      src.start(at);
    };
    burst(t0, on ? 2400 : 1800, 0.5, 0.03);
    burst(t0 + 0.035, on ? 900 : 700, 0.35, 0.05);
  } catch {
    /* sound is a nicety; never let it break the switch */
  }
}
