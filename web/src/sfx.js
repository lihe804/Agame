/* 程序化音效（WebAudio 合成，无外部素材） */

let ctx = null;
let master = null;
let muted = false;

export function initAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.22;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
}

export function toggleMute() {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 0.22;
  return muted;
}

function noiseBuffer(dur) {
  const n = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  return buf;
}

/** 脚步：沙滩闷响 / 水中哗啦 */
export function footstep(inWater) {
  if (!ctx || muted) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(0.13);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = inWater ? 1100 : 460;
  const g = ctx.createGain();
  g.gain.setValueAtTime(inWater ? 0.5 : 0.34, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
  src.connect(f);
  f.connect(g);
  g.connect(master);
  src.start(t);
}

/** 跳起：短促上扬音 */
export function jumpSfx() {
  if (!ctx || muted) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(250, t);
  o.frequency.exponentialRampToValueAtTime(540, t + 0.14);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.16, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.17);
  o.connect(g);
  g.connect(master);
  o.start(t);
  o.stop(t + 0.2);
}

/** 落地：低频闷响 + 沙粒声 */
export function landSfx() {
  if (!ctx || muted) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(150, t);
  o.frequency.exponentialRampToValueAtTime(55, t + 0.12);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.3, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
  o.connect(g);
  g.connect(master);
  o.start(t);
  o.stop(t + 0.16);

  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(0.1);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 600;
  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(0.2, t);
  g2.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
  src.connect(f);
  f.connect(g2);
  g2.connect(master);
  src.start(t);
}

/** 落水：扑通 */
export function splashSfx() {
  if (!ctx || muted) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(0.35);
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.setValueAtTime(900, t);
  f.frequency.exponentialRampToValueAtTime(300, t + 0.3);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.4, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
  src.connect(f);
  f.connect(g);
  g.connect(master);
  src.start(t);

  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(220, t);
  o.frequency.exponentialRampToValueAtTime(70, t + 0.18);
  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(0.25, t);
  g2.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
  o.connect(g2);
  g2.connect(master);
  o.start(t);
  o.stop(t + 0.22);
}

/** 通关：上行琶音庆祝 */
export function goalSfx() {
  if (!ctx || muted) return;
  const t = ctx.currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
  notes.forEach((f, i) => {
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f;
    const g = ctx.createGain();
    const s = t + i * 0.11;
    g.gain.setValueAtTime(0.0001, s);
    g.gain.linearRampToValueAtTime(0.18, s + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, s + 0.5);
    o.connect(g);
    g.connect(master);
    o.start(s);
    o.stop(s + 0.55);
  });
}

/** 阶段宝箱：短促金币声 + 两音上扬 */
export function rewardSfx(final = false) {
  if (!ctx || muted) return;
  const t = ctx.currentTime;
  const notes = final ? [698.46, 880, 1174.66] : [659.25, 987.77];
  notes.forEach((f, i) => {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f, t + i * 0.07);
    const g = ctx.createGain();
    const s = t + i * 0.07;
    g.gain.setValueAtTime(0.0001, s);
    g.gain.linearRampToValueAtTime(0.16, s + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, s + 0.24);
    o.connect(g);
    g.connect(master);
    o.start(s);
    o.stop(s + 0.26);
  });
}

/** 开/关门：木头吱呀声 */
export function doorSfx(opening) {
  if (!ctx || muted) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(opening ? 80 : 150, t);
  o.frequency.linearRampToValueAtTime(opening ? 150 : 70, t + 0.32);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 520;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.12, t + 0.05);
  g.gain.linearRampToValueAtTime(0.0001, t + 0.38);
  o.connect(f);
  f.connect(g);
  g.connect(master);
  o.start(t);
  o.stop(t + 0.4);
}
