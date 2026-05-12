// Lightweight Web Audio sound effects (no asset files).
let ctx: AudioContext | null = null;
function getCtx() {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch {
      return null;
    }
  }
  return ctx;
}

function blip(freq: number, dur = 0.08, type: OscillatorType = "square", vol = 0.06) {
  const c = getCtx();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(vol, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
  o.connect(g).connect(c.destination);
  o.start();
  o.stop(c.currentTime + dur);
}

export const sfx = {
  type: () => blip(880 + Math.random() * 120, 0.04, "square", 0.03),
  destroy: () => {
    blip(660, 0.08, "sawtooth", 0.06);
    setTimeout(() => blip(990, 0.1, "sine", 0.05), 40);
  },
  typo: () => blip(160, 0.18, "sawtooth", 0.08),
  hpLoss: () => blip(110, 0.3, "triangle", 0.1),
  levelUp: () => {
    blip(660, 0.1, "sine", 0.06);
    setTimeout(() => blip(880, 0.1, "sine", 0.06), 80);
    setTimeout(() => blip(1320, 0.15, "sine", 0.06), 160);
  },
  gameOver: () => {
    blip(330, 0.2, "sawtooth", 0.08);
    setTimeout(() => blip(220, 0.3, "sawtooth", 0.08), 150);
  },
  bonus: () => blip(1320, 0.15, "sine", 0.07),
};
