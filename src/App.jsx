import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";

/* ═══════════  tokens  ═══════════ */

const LIGHT = {
  bg: "#EDF1F8",
  card: "#FFFFFF",
  ink: "#1B2440",
  accent: "#2F7BF6",
  go: "#0E9F6E",
  stop: "#F2761B",
  danger: "#FF4D6A",
  gold: "#FFC24B",
  flow: "#8B5CF6",
  muted: "#8A93AC",
  dot: "#D5DBE8",
  line: "#E6EBF4",
  gridLine: "#B9C6E0",
  overlay: "rgba(255,255,255,0.96)",
  coachBg: "#E9F1FF",
};

/* High contrast — vivid arrows on near-black, easier in low light and for
   anyone who finds the pale board hard to read. */
const DARK = {
  bg: "#080C1A",
  card: "#121A31",
  ink: "#EAF0FF",
  accent: "#4C8DFF",
  go: "#22C58A",
  stop: "#FF9B3D",
  danger: "#FF5C7A",
  gold: "#FFC24B",
  flow: "#A78BFA",
  muted: "#8592BC",
  dot: "#27334F",
  line: "#222E4C",
  gridLine: "#3C4E76",
  overlay: "rgba(8,12,26,0.96)",
  coachBg: "#16223F",
};

const C = { ...LIGHT, __dark: false };

const DIRS = {
  right: { dx: 1, dy: 0, angle: 0 },
  left: { dx: -1, dy: 0, angle: 180 },
  up: { dx: 0, dy: -1, angle: -90 },
  down: { dx: 0, dy: 1, angle: 90 },
};
const DIR_NAMES = Object.keys(DIRS);
const U = 100;

let HAPTICS = true;
const buzz = (ms) => {
  if (!HAPTICS) return;
  try {
    navigator?.vibrate?.(ms);
  } catch {}
};

/* ═══════════  audio — everything synthesized, zero audio files  ═══════════ */

const Snd = (() => {
  let ctx = null;
  let master = null;
  let sfxBus = null;
  let musicBus = null;
  let noiseBuf = null;
  let sfxOn = true;
  let musicOn = true;
  let timer = null;
  let step = 0;

  function ensure() {
    if (ctx) {
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      return ctx;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.85;
      master.connect(ctx.destination);
      sfxBus = ctx.createGain();
      sfxBus.gain.value = 0.5;
      sfxBus.connect(master);
      musicBus = ctx.createGain();
      musicBus.gain.value = 0.0001;
      musicBus.connect(master);

      const len = Math.floor(ctx.sampleRate * 0.5);
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch {
      ctx = null;
    }
    return ctx;
  }

  function tone(freq, { type = "triangle", dur = 0.3, peak = 0.3, glide = 0, delay = 0, bus } = {}) {
    const c = ensure();
    if (!c) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(freq * glide, 20), t + dur * 0.8);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(bus || sfxBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  function whoosh(from = 700, to = 2600, dur = 0.3, peak = 0.16) {
    const c = ensure();
    if (!c || !noiseBuf) return;
    const t = c.currentTime;
    const s = c.createBufferSource();
    s.buffer = noiseBuf;
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 1.1;
    bp.frequency.setValueAtTime(from, t);
    bp.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(bp);
    bp.connect(g);
    g.connect(sfxBus);
    s.start(t);
    s.stop(t + dur + 0.05);
  }

  /* pitch climbs a semitone per chain step — the chain literally sounds like it's building */
  function depart(chain = 1) {
    if (!sfxOn) return;
    const base = 392 * Math.pow(2, Math.min(chain - 1, 11) / 12);
    tone(base, { type: "triangle", dur: 0.26, peak: 0.3, glide: 1.5 });
    tone(base * 2, { type: "sine", dur: 0.18, peak: 0.1, delay: 0.02 });
    whoosh(600, 2400, 0.26, 0.13);
  }

  function blocked() {
    if (!sfxOn) return;
    tone(150, { type: "sine", dur: 0.26, peak: 0.4, glide: 0.55 });
    whoosh(300, 140, 0.16, 0.1);
  }

  function undo() {
    if (!sfxOn) return;
    tone(660, { type: "sine", dur: 0.16, peak: 0.16, glide: 0.7 });
  }

  function shieldUp() {
    if (!sfxOn) return;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      tone(f, { type: "sine", dur: 0.4, peak: 0.16, delay: i * 0.06 })
    );
  }

  function shieldUsed() {
    if (!sfxOn) return;
    tone(880, { type: "sine", dur: 0.3, peak: 0.2, glide: 0.6 });
    whoosh(1800, 500, 0.28, 0.12);
  }

  function win() {
    if (!sfxOn) return;
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) =>
      tone(f, { type: "triangle", dur: 0.55, peak: 0.2, delay: i * 0.085 })
    );
  }

  function lose() {
    if (!sfxOn) return;
    [392, 311.13, 261.63].forEach((f, i) =>
      tone(f, { type: "triangle", dur: 0.45, peak: 0.22, delay: i * 0.13 })
    );
  }

  /* slow ambient pads — Am · F · C · G, low and filtered */
  const CHORDS = [
    [220, 261.63, 329.63],
    [174.61, 220, 261.63],
    [196, 246.94, 293.66],
    [164.81, 196, 246.94],
  ];

  function pad(freqs) {
    const c = ensure();
    if (!c) return;
    const t = c.currentTime;
    const dur = 7.4;
    freqs.forEach((f, i) => {
      const o = c.createOscillator();
      o.type = i === 0 ? "sine" : "triangle";
      o.frequency.value = f;
      o.detune.value = (i - 1) * 4;
      const lp = c.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 760;
      lp.Q.value = 0.5;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.13, t + 2.4);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(lp);
      lp.connect(g);
      g.connect(musicBus);
      o.start(t);
      o.stop(t + dur + 0.1);
    });
  }

  function startMusic() {
    const c = ensure();
    if (!c || timer) return;
    musicBus.gain.cancelScheduledValues(c.currentTime);
    musicBus.gain.setValueAtTime(Math.max(musicBus.gain.value, 0.0001), c.currentTime);
    musicBus.gain.exponentialRampToValueAtTime(0.42, c.currentTime + 2);
    pad(CHORDS[step++ % 4]);
    timer = setInterval(() => pad(CHORDS[step++ % 4]), 6400);
  }

  function stopMusic() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (ctx && musicBus) {
      musicBus.gain.cancelScheduledValues(ctx.currentTime);
      musicBus.gain.setValueAtTime(musicBus.gain.value, ctx.currentTime);
      musicBus.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.2);
    }
  }

  return {
    unlock: ensure,
    setSfx: (v) => {
      sfxOn = v;
    },
    setMusic: (v) => {
      musicOn = v;
      if (v) startMusic();
      else stopMusic();
    },
    suspend: () => {
      if (ctx && ctx.state === "running") ctx.suspend().catch(() => {});
    },
    resume: () => {
      if (ctx && ctx.state === "suspended" && (sfxOn || musicOn)) ctx.resume().catch(() => {});
    },
    depart,
    blocked,
    undo,
    shieldUp,
    shieldUsed,
    win,
    lose,
  };
})();

let RND = Math.random;
const hashStr = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

function cropMask(set, W, H) {
  let x0 = W, x1 = -1, y0 = H, y1 = -1;
  set.forEach((i) => {
    const x = i % W, y = (i / W) | 0;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  });
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const out = new Set();
  set.forEach((i) => {
    const x = i % W - x0, y = ((i / W) | 0) - y0;
    out.add(y * w + x);
  });
  return { cols: w, rows: h, cells: out };
}

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ═══════════  parametric artwork  ═══════════
   A seed picks a family and its proportions, so every generated board is a
   recognisable subject rather than a blob — and the supply never runs out. */

function ArtCanvas(size, ss) {
  const S = size * ss;
  return { n: size, ss, S, buf: new Uint8Array(S * S) };
}
function aToS(c, v) { return (v / 100) * c.S; }

function aEll(c, x0, y0, x1, y1, val) {
  const cx = aToS(c, (x0 + x1) / 2), cy = aToS(c, (y0 + y1) / 2);
  const rx = Math.max(aToS(c, (x1 - x0) / 2), 0.5), ry = Math.max(aToS(c, (y1 - y0) / 2), 0.5);
  const a = Math.max(0, Math.floor(cx - rx)), b = Math.min(c.S - 1, Math.ceil(cx + rx));
  const p = Math.max(0, Math.floor(cy - ry)), q = Math.min(c.S - 1, Math.ceil(cy + ry));
  for (let y = p; y <= q; y++) for (let x = a; x <= b; x++) {
    const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
    if (dx * dx + dy * dy <= 1) c.buf[y * c.S + x] = val;
  }
}

function aRect(c, x0, y0, x1, y1, val) {
  const a = Math.max(0, Math.floor(aToS(c, x0))), b = Math.min(c.S - 1, Math.ceil(aToS(c, x1)));
  const p = Math.max(0, Math.floor(aToS(c, y0))), q = Math.min(c.S - 1, Math.ceil(aToS(c, y1)));
  for (let y = p; y <= q; y++) for (let x = a; x <= b; x++) c.buf[y * c.S + x] = val;
}

function aPoly(c, pts, val) {
  const P = pts.map(([x, y]) => [aToS(c, x), aToS(c, y)]);
  let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
  for (const [x, y] of P) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
  const a = Math.max(0, Math.floor(minx)), b = Math.min(c.S - 1, Math.ceil(maxx));
  const p = Math.max(0, Math.floor(miny)), q = Math.min(c.S - 1, Math.ceil(maxy));
  for (let y = p; y <= q; y++) for (let x = a; x <= b; x++) {
    let inside = false;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      const [xi, yi] = P[i], [xj, yj] = P[j];
      if ((yi > y + 0.5) !== (yj > y + 0.5) &&
          x + 0.5 < ((xj - xi) * (y + 0.5 - yi)) / (yj - yi) + xi) inside = !inside;
    }
    if (inside) c.buf[y * c.S + x] = val;
  }
}

function aHarvest(c, thresh) {
  const { n: size, ss, S, buf } = c;
  const rows = [];
  for (let gy = 0; gy < size; gy++) {
    let line = "";
    for (let gx = 0; gx < size; gx++) {
      let hit = 0;
      for (let y = 0; y < ss; y++) for (let x = 0; x < ss; x++) {
        if (buf[(gy * ss + y) * S + gx * ss + x]) hit++;
      }
      line += hit / (ss * ss) >= thresh ? "#" : ".";
    }
    rows.push(line);
  }
  return rows;
}

function aTidy(rows) {
  while (rows.length && !rows[0].includes("#")) rows.shift();
  while (rows.length && !rows[rows.length - 1].includes("#")) rows.pop();
  if (!rows.length) return null;
  const w = rows[0].length;
  let lo = w, hi = -1;
  for (const r of rows) for (let i = 0; i < w; i++) if (r[i] === "#") { lo = Math.min(lo, i); hi = Math.max(hi, i); }
  const cropped = rows.map((r) => r.slice(lo, hi + 1));
  const cols = cropped[0].length, rw = cropped.length;
  const cells = new Set();
  cropped.forEach((r, y) => [...r].forEach((ch, x) => ch === "#" && cells.add(y * cols + x)));
  // keep the largest island so stray specks never appear
  const seen = new Set(); let best = [];
  for (const st of cells) {
    if (seen.has(st)) continue;
    const stack = [st], comp = []; seen.add(st);
    while (stack.length) {
      const i = stack.pop(); comp.push(i);
      const x = i % cols, y = (i / cols) | 0;
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rw) continue;
        const j = ny * cols + nx;
        if (cells.has(j) && !seen.has(j)) { seen.add(j); stack.push(j); }
      }
    }
    if (comp.length > best.length) best = comp;
  }
  return { cols, rows: rw, cells: new Set(best) };
}

/* ── families: each returns a drawing function given a seeded rng ── */

const ART_FAMILIES = [
  ["Cat", (c, r) => {
    const ear = 18 + r() * 12, hw = 20 + r() * 8, tail = r() < 0.75;
    aPoly(c, [[50 - hw, 30], [50 - hw + 3, 30 - ear], [50 - 2, 24]], 1);
    aPoly(c, [[50 + hw, 30], [50 + hw - 3, 30 - ear], [50 + 2, 24]], 1);
    aEll(c, 50 - hw, 16, 50 + hw, 56, 1);
    const bw = 12 + r() * 10;
    aPoly(c, [[50 - bw, 50], [50 + bw, 50], [50 + bw + 12, 94], [50 - bw - 12, 94]], 1);
    if (tail) { aRect(c, 62 + r() * 6, 60, 74 + r() * 6, 94, 1); aEll(c, 60, 84, 84, 97, 1); }
  }],
  ["Dog", (c, r) => {
    const droop = 40 + r() * 22;
    aEll(c, 30, 12, 70, 50, 1);
    aEll(c, 16 + r() * 6, 20, 34, droop, 1);
    aEll(c, 66, 20, 84 - r() * 6, droop, 1);
    aEll(c, 41, 34, 59, 56, 1);
    const bw = 12 + r() * 8;
    aPoly(c, [[50 - bw, 50], [50 + bw, 50], [50 + bw + 10, 94], [50 - bw - 10, 94]], 1);
    if (r() < 0.6) aRect(c, 68, 66, 80, 94, 1);
  }],
  ["Bird", (c, r) => {
    aEll(c, 26, 32, 84, 78, 1);
    const hs = 14 + r() * 8;
    aEll(c, 20, 14, 20 + hs * 2, 14 + hs * 2, 1);
    aPoly(c, [[14, 24 + hs * 0.4], [1, 30 + hs * 0.4], [14, 36 + hs * 0.4]], 1);
    aPoly(c, [[42, 40], [86 + r() * 10, 26], [66, 64]], 1);
    aPoly(c, [[70, 62], [98, 76 + r() * 12], [66, 78]], 1);
  }],
  ["Fish", (c, r) => {
    const bh = 22 + r() * 14;
    aEll(c, 4, 50 - bh, 70, 50 + bh, 1);
    aPoly(c, [[60, 50], [98, 50 - bh - 8], [90, 50], [98, 50 + bh + 8]], 1);
    aPoly(c, [[26, 50 - bh + 4], [46, 50 - bh - 22], [54, 50 - bh + 4]], 1);
    if (r() < 0.6) aPoly(c, [[28, 50 + bh - 4], [46, 50 + bh + 20], [54, 50 + bh - 4]], 1);
  }],
  ["Tree", (c, r) => {
    const lobes = 2 + ((r() * 3) | 0);
    for (let i = 0; i < lobes; i++) {
      const cx = 24 + (52 / Math.max(lobes - 1, 1)) * i, w = 20 + r() * 16;
      aEll(c, cx - w, 8 + r() * 16, cx + w, 54 + r() * 14, 1);
    }
    const tw = 4 + r() * 6;
    aRect(c, 50 - tw, 54, 50 + tw, 96, 1);
  }],
  ["Flower", (c, r) => {
    const petals = 5 + ((r() * 4) | 0), pr = 16 + r() * 8;
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * Math.PI * 2 - Math.PI / 2;
      const cx = 50 + Math.cos(a) * 22, cy = 40 + Math.sin(a) * 22;
      aEll(c, cx - pr, cy - pr, cx + pr, cy + pr, 1);
    }
    aEll(c, 38, 28, 62, 52, 1);
    aRect(c, 46, 46, 54, 96, 1);
    if (r() < 0.7) aEll(c, 22, 62, 50, 78, 1);
  }],
  ["Vessel", (c, r) => {
    const bowl = 22 + r() * 12, deep = 30 + r() * 18;
    aPoly(c, [[50 - bowl, 12], [50 + bowl, 12], [50 + bowl * 0.6, 12 + deep], [50 - bowl * 0.6, 12 + deep]], 1);
    if (r() < 0.7) {
      aRect(c, 50 - bowl - 16, 16, 50 - bowl + 2, 24, 1);
      aRect(c, 50 - bowl - 16, 16, 50 - bowl - 8, 40, 1);
      aRect(c, 50 + bowl - 2, 16, 50 + bowl + 16, 24, 1);
      aRect(c, 50 + bowl + 8, 16, 50 + bowl + 16, 40, 1);
    }
    aRect(c, 44, 12 + deep, 56, 74, 1);
    aRect(c, 30, 74, 70, 83, 1);
    aRect(c, 20, 83, 80, 94, 1);
  }],
  ["Crown", (c, r) => {
    const spikes = 3 + ((r() * 3) | 0), dip = 48 + r() * 14;
    const pts = [[8, 82]];
    for (let i = 0; i <= spikes; i++) {
      const x = 8 + (84 / spikes) * i;
      pts.push([x, 14 + r() * 12]);
      if (i < spikes) pts.push([x + 84 / spikes / 2, dip]);
    }
    pts.push([92, 82]);
    aPoly(c, pts, 1);
    aRect(c, 8, 78, 92, 94, 1);
  }],
  ["Rocket", (c, r) => {
    const w = 14 + r() * 8, nose = 2 + r() * 12;
    aPoly(c, [[50, nose], [50 + w, 34], [50 + w, 74], [50 - w, 74], [50 - w, 34]], 1);
    aPoly(c, [[50 - w, 46], [50 - w - 18, 82], [50 - w, 74]], 1);
    aPoly(c, [[50 + w, 46], [50 + w + 18, 82], [50 + w, 74]], 1);
    aPoly(c, [[50 - 12, 74], [50 + 12, 74], [50, 98]], 1);
  }],
  ["Mushroom", (c, r) => {
    const cap = 36 + r() * 12, st = 10 + r() * 8;
    aEll(c, 50 - cap, 8, 50 + cap, 8 + cap * 1.5, 1);
    aRect(c, 50 - cap, 8 + cap * 0.75, 50 + cap, 8 + cap * 0.8, 0);
    aRect(c, 50 - st, 40, 50 + st, 94, 1);
    aEll(c, 50 - cap, 8, 50 + cap, 60, 1);
    aRect(c, 0, 42, 100, 100, 0);
    aRect(c, 50 - st, 40, 50 + st, 94, 1);
    aEll(c, 50 - cap, 8, 50 + cap, 68, 1);
    aRect(c, 0, 44, 100, 100, 0);
    aRect(c, 50 - st, 42, 50 + st, 94, 1);
  }],
  ["Butterfly", (c, r) => {
    const up = 34 + r() * 12, lo = 26 + r() * 12;
    aEll(c, 50 - up * 1.3, 8, 50 - 4, 8 + up * 1.2, 1);
    aEll(c, 50 + 4, 8, 50 + up * 1.3, 8 + up * 1.2, 1);
    aEll(c, 50 - lo * 1.2, 46, 50 - 4, 46 + lo * 1.4, 1);
    aEll(c, 50 + 4, 46, 50 + lo * 1.2, 46 + lo * 1.4, 1);
    aRect(c, 46, 12, 54, 88, 1);
    aEll(c, 44, 4, 56, 18, 1);
  }],
  ["Key", (c, r) => {
    const bow = 20 + r() * 12;
    aEll(c, 4, 46 - bow, 4 + bow * 2, 46 + bow, 1);
    aEll(c, 4 + bow * 0.6, 46 - bow * 0.4, 4 + bow * 1.4, 46 + bow * 0.4, 0);
    aRect(c, 4 + bow * 1.4, 40, 96, 52, 1);
    aRect(c, 70, 50, 79, 50 + 14 + r() * 10, 1);
    aRect(c, 85, 50, 93, 50 + 10 + r() * 10, 1);
  }],
];

const ART_ADJ = ["Little", "Broad", "Tall", "Round", "Slim", "Wide", "Bold", "Fine", "Grand", "Neat"];

function artMask(seed) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const r = mulberry32(seed * 2654435761 + attempt * 97);
    const [name, draw] = ART_FAMILIES[(r() * ART_FAMILIES.length) | 0];
    const size = 18 + ((r() * 9) | 0);
    const c = ArtCanvas(size, 3);
    draw(c, r);
    const m = aTidy(aHarvest(c, 0.42));
    if (!m) continue;
    if (m.cells.size < 90 || m.cells.size > 430) continue;
    if (m.cols < 9 || m.rows < 9) continue;
    return { ...m, name: `${ART_ADJ[(seed * 7) % ART_ADJ.length]} ${name}`, procedural: true };
  }
  return null;
}

/* ═══════════  generation  ═══════════ */

const shuffle = (a) => [...a].sort(() => RND() - 0.5);

function step(idx, dx, dy, cols, rows) {
  const c = (idx % cols) + dx;
  const r = Math.floor(idx / cols) + dy;
  if (c < 0 || c >= cols || r < 0 || r >= rows) return null;
  return r * cols + c;
}

function exitLine(head, d, cols, rows) {
  const D = DIRS[d];
  const out = [];
  let cur = head;
  for (;;) {
    cur = step(cur, D.dx, D.dy, cols, rows);
    if (cur === null) return out;
    out.push(cur);
  }
}

function buildBoard(mask, { maxLen, coverage, tightness, pieces: target }) {
  const { cols, rows, cells } = mask;
  const occupied = new Map();
  const pieces = [];
  const all = [...cells];
  const fillTarget = Math.round(cells.size * coverage);
  const BANDS = [[0.3, 0.6], [0.6, 1.0], [1.0, 1.5], [1.5, 2.3]];
  // average snake length needed to cover the shape in `target` arrows
  const avgLen = Math.min(maxLen, Math.max(1.6, (fillTarget / Math.max(target || 40, 6)) * 1.55));
  let filled = 0;
  let fails = 0;

  const edgeDist = (c) => {
    const x = c % cols;
    const y = Math.floor(c / cols);
    return Math.min(x, cols - 1 - x, y, rows - 1 - y);
  };

  while (filled < fillTarget && fails < 700) {
    const free = all.filter((c) => !occupied.has(c));
    if (!free.length) break;
    // sample a few and take the most central — interior lanes must be claimed early
    let head = free[(RND() * free.length) | 0];
    for (let t = 0; t < 5; t++) {
      const cand = free[(RND() * free.length) | 0];
      if (edgeDist(cand) > edgeDist(head)) head = cand;
    }
    let options = [];
    for (const d of DIR_NAMES) {
      const lane = exitLine(head, d, cols, rows);
      if (lane.some((c) => occupied.has(c))) continue;
      const D0 = DIRS[d];
      const back = step(head, -D0.dx, -D0.dy, cols, rows);
      options.push({ d, len: lane.length, grow: back !== null && cells.has(back) && !occupied.has(back) });
    }
    if (!options.length) {
      fails++;
      continue;
    }
    // when space runs short, stop insisting the body can grow
    if (fails < 60 && options.some((o) => o.grow)) options = options.filter((o) => o.grow);
    options.sort((a, b) => b.len - a.len);
    const chosen = RND() < tightness ? options[0] : options[(RND() * options.length) | 0];
    const D = DIRS[chosen.d];
    const ownLane = new Set(exitLine(head, chosen.d, cols, rows));

    const body = [head];
    const used = new Set([head]);
    // size classes — a board of all-same-length snakes reads flat and easy
    // early = long runs while there is space, later = shorter fillers.
    // repeated failures mean the board is tight, so shrink further.
    const prog = filled / fillTarget;
    const squeeze = fails > 120 ? 0.25 : fails > 45 ? 0.5 : fails > 15 ? 0.75 : 1;
    const band = BANDS[Math.max(0, Math.min(3, Math.floor((1 - prog) * 4 + (RND() * 1.4 - 0.7))))];
    const want = Math.max(1, Math.min(maxLen,
      Math.round(avgLen * squeeze * (band[0] + RND() * (band[1] - band[0])))));
    if (want > 1) {
      const back = step(head, -D.dx, -D.dy, cols, rows);
      if (back !== null && cells.has(back) && !occupied.has(back) && !ownLane.has(back)) {
        body.push(back);
        used.add(back);
        let cur = back;
        let run = { dx: -D.dx, dy: -D.dy };   // direction the body is travelling
        while (body.length < want) {
          const open = [];
          for (const nm of DIR_NAMES) {
            const d = DIRS[nm];
            const nx = step(cur, d.dx, d.dy, cols, rows);
            if (nx === null || !cells.has(nx) || occupied.has(nx) || used.has(nx) || ownLane.has(nx)) continue;
            open.push({ nx, d });
          }
          if (!open.length) break;
          const straight = open.find((o) => o.d.dx === run.dx && o.d.dy === run.dy);
          // keep going straight most of the time — bends become deliberate, not noise
          const pick = straight && RND() < 0.68 ? straight : open[(RND() * open.length) | 0];
          cur = pick.nx;
          run = { dx: pick.d.dx, dy: pick.d.dy };
          body.push(cur);
          used.add(cur);
        }
      }
    }
    const id = pieces.length;
    body.forEach((c) => occupied.set(c, id));
    pieces.push({ id, cells: body, dir: chosen.d });
    filled += body.length;
    fails = 0;
  }
  return pieces;
}

function measureBoard(pieces, cols, rows) {
  if (!pieces.length) return { freedom: 1, forced: 0 };
  const lanes = pieces.map((p) => exitLine(p.cells[0], p.dir, cols, rows));
  const owner = new Map();
  pieces.forEach((p) => p.cells.forEach((c) => owner.set(c, p.id)));
  const alive = new Set(pieces.map((p) => p.id));
  const isFree = (id) =>
    lanes[id].every((c) => {
      const o = owner.get(c);
      return o === undefined || !alive.has(o);
    });
  let sum = 0;
  let n = 0;
  let forced = 0;   // moments where the board allows almost no choice
  while (alive.size) {
    const free = [...alive].filter(isFree);
    if (!free.length) return { freedom: 1, forced: 0 };
    sum += free.length / alive.size;
    if (free.length <= 2) forced++;
    n++;
    alive.delete(free[(RND() * free.length) | 0]);
  }
  return n ? { freedom: sum / n, forced: forced / n } : { freedom: 1, forced: 0 };
}


/* Big artwork on an easy level would mean 150+ arrows. Resample the mask down
   to the tier's budget instead — the same subject, drawn with less detail. */
function fitMask(mask, maxCells) {
  if (!maxCells || mask.cells.size <= maxCells) return mask;

  const sample = (k) => {
    const c2 = Math.max(5, Math.round(mask.cols * k));
    const r2 = Math.max(5, Math.round(mask.rows * k));
    const out = new Set();
    for (let y = 0; y < r2; y++) {
      for (let x = 0; x < c2; x++) {
        const x0 = Math.floor((x * mask.cols) / c2), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * mask.cols) / c2));
        const y0 = Math.floor((y * mask.rows) / r2), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * mask.rows) / r2));
        let hit = 0, tot = 0;
        for (let b = y0; b < y1; b++) for (let a = x0; a < x1; a++) { tot++; if (mask.cells.has(b * mask.cols + a)) hit++; }
        if (tot && hit / tot >= 0.4) out.add(y * c2 + x);
      }
    }
    return { c2, r2, out };
  };

  // downsampling thickens edges, so one pass usually lands over budget.
  // correct against the measured result instead of trusting the estimate.
  let k = Math.sqrt(maxCells / mask.cells.size);
  let best = null;
  for (let pass = 0; pass < 5; pass++) {
    const r = sample(k);
    if (r.out.size >= 18) best = r;
    if (r.out.size <= maxCells || r.out.size < 18) break;
    k *= Math.sqrt((maxCells / r.out.size) * 0.97);
  }
  if (!best || best.out.size < 18) return mask;
  const t = cropMask(best.out, best.c2, best.r2);
  return { ...t, name: mask.name, procedural: mask.procedural };
}


function makeLevelFromMask(rawMask, tierIdx = 7) {
  const idx = Math.max(0, Math.min(TIERS.length - 1, tierIdx | 0));
  const tier = TIERS[idx];
  const mask = fitMask(rawMask, tier.maxCells);
  let best = null;
  for (let i = 0; i < (mask.cells.size > 240 ? 2 : 5); i++) {
    const pieces = buildBoard(mask, tier);
    if (pieces.length < 3) continue;
    const mb = measureBoard(pieces, mask.cols, mask.rows);
    const fill = pieces.reduce((a, p) => a + p.cells.length, 0) / mask.cells.size;
    // prefer the target openness, reward boards with more forced moments, and
    // heavily punish a board that leaves the shape half empty
    const gap = Math.abs(mb.freedom - tier.freedom) - mb.forced * 0.35 + Math.max(0, tier.coverage - 0.06 - fill) * 4;
    if (!best || gap < best.gap) best = { pieces, gap };
  }
  if (!best) best = { pieces: buildBoard(mask, tier), gap: 1 };
  return {
    mask, pieces: best.pieces, tier, tierIndex: idx, stepInTier: 1,
    hearts: tier.hearts, hints: tier.hints, undos: tier.undos,
  };
}

function makeLevel(level, seed) {
  if (seed !== undefined) RND = mulberry32(seed);
  const { tier, index, step: stepInTier } = tierFor(level);
  const raw =
    seed === undefined && level > CURATED_UNTIL
      ? artMask(level) || proceduralMask(level)
      : parseMask(tier.pool[(seed !== undefined ? seed : level - 1) % tier.pool.length]);
  const mask = fitMask(raw, tier.maxCells);
  const tries = mask.cells.size > 240 ? 2 : mask.cells.size > 90 ? 4 : 7;

  let best = null;
  for (let i = 0; i < tries; i++) {
    const pieces = buildBoard(mask, tier);
    if (pieces.length < 3) continue;
    const mb = measureBoard(pieces, mask.cols, mask.rows);
    const fill = pieces.reduce((a, p) => a + p.cells.length, 0) / mask.cells.size;
    // prefer the target openness, reward boards with more forced moments, and
    // heavily punish a board that leaves the shape half empty
    const gap = Math.abs(mb.freedom - tier.freedom) - mb.forced * 0.35 + Math.max(0, tier.coverage - 0.06 - fill) * 4;
    if (!best || gap < best.gap) best = { pieces, gap };
  }
  if (!best) best = { pieces: buildBoard(mask, tier), gap: 1 };
  RND = Math.random;

  return { mask, pieces: best.pieces, tier, tierIndex: index, stepInTier, hearts: tier.hearts, hints: tier.hints, undos: tier.undos };
}

/* how many arrows a removal sets free — the heart of chain scoring */
function countFreed(pieces, aliveSet, removedId, cols, rows) {
  const occBefore = new Map();
  const occAfter = new Map();
  pieces.forEach((p) => {
    if (!aliveSet.has(p.id)) return;
    p.cells.forEach((c) => {
      occBefore.set(c, p.id);
      if (p.id !== removedId) occAfter.set(c, p.id);
    });
  });
  const blocked = (p, occ) => {
    for (const c of exitLine(p.cells[0], p.dir, cols, rows)) {
      const o = occ.get(c);
      if (o !== undefined && o !== p.id) return true;
    }
    return false;
  };
  let n = 0;
  for (const p of pieces) {
    if (!aliveSet.has(p.id) || p.id === removedId) continue;
    if (blocked(p, occBefore) && !blocked(p, occAfter)) n++;
  }
  return n;
}


/* ═══════════  chapters, stickers, badges  ═══════════
   Levels group into chapters of 25. Finishing one earns a sticker whose art is
   generated from the chapter number, so the road never runs out. Badges are
   deliberately few — a wall of meaningless medals is the thing players in this
   genre complain about most. */

const CHAPTER_LEN = 25;
const chapterOf = (lvl) => Math.floor((lvl - 1) / CHAPTER_LEN) + 1;

function chapterInfo(ch) {
  const m = artMask(ch * 977 + 13) || proceduralMask(ch * 977 + 13);
  return {
    ch,
    from: (ch - 1) * CHAPTER_LEN + 1,
    to: ch * CHAPTER_LEN,
    name: m ? m.name : `Chapter ${ch}`,
    mask: m,
    hue: TIER_HUE[(ch - 1) % TIER_HUE.length],
  };
}

const BADGES = [
  { id: "first",   name: "First Clear",      need: "Clear your first board" },
  { id: "flaw5",   name: "Five Flawless",    need: "Five flawless boards in a row" },
  { id: "gold",    name: "Gold Standard",    need: "Earn a gold shape" },
  { id: "streak7", name: "Seven Days",       need: "A seven-day daily streak" },
  { id: "hard",    name: "Into the Deep",    need: "Clear a board at Hard or above" },
  { id: "pro",     name: "Pro Board",        need: "Clear a board at Pro" },
  { id: "k1",      name: "Thousand Arrows",  need: "Clear 1,000 arrows in total" },
  { id: "chain12", name: "Long Chain",       need: "Reach a twelve-arrow chain" },
  { id: "purist",  name: "Purist",           need: "Clear 20 boards without undo" },
  { id: "maker",   name: "Designer",         need: "Play a board you drew yourself" },
];


/* ═══════════  save storage  ═══════════
   window.storage only exists inside the Claude artifact viewer. In a real
   build it is absent, so every read throws and the game silently forgets
   everything on close. Fall back to localStorage, then to memory. */

const SAVE_KEY = "arrowv2:save";

const Store = (() => {
  const mem = new Map();
  const hasArtifact = typeof window !== "undefined" && window.storage && typeof window.storage.get === "function";
  let hasLocal = false;
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("__t", "1");
      localStorage.removeItem("__t");
      hasLocal = true;
    }
  } catch {
    hasLocal = false;
  }
  return {
    async get(key) {
      if (hasArtifact) {
        try {
          const r = await window.storage.get(key);
          if (r && r.value != null) return r.value;
        } catch {}
      }
      if (hasLocal) {
        try {
          const v = localStorage.getItem(key);
          if (v != null) return v;
        } catch {}
      }
      return mem.get(key) ?? null;
    },
    async set(key, value) {
      mem.set(key, value);
      if (hasArtifact) {
        try { await window.storage.set(key, value); } catch {}
      }
      if (hasLocal) {
        try { localStorage.setItem(key, value); } catch {}
      }
    },
  };
})();


/* ═══════════  ads & purchase adapter  ═══════════
   Nothing here talks to a network. The game calls this object; a native layer
   fills it in. To wire AdMob in the Capacitor build, define window.ArrowAds
   before the app mounts:

     window.ArrowAds = {
       ready: true,                                  // a rewarded ad is loaded
       showRewarded:      (kind) => Promise<boolean>, // true = watched fully
       showInterstitial:  ()     => Promise<void>,
       purchaseRemoveAds: ()     => Promise<boolean>,
       restorePurchases:  ()     => Promise<boolean>,
     };

   Until then every call resolves false and the game plays exactly as it does
   now — no dead buttons, no crashes. */

const Ads = {
  get provider() {
    return typeof window !== "undefined" ? window.ArrowAds : undefined;
  },
  get ready() {
    return !!(Ads.provider && Ads.provider.ready);
  },
  async rewarded(kind) {
    try {
      if (Ads.provider?.showRewarded) return !!(await Ads.provider.showRewarded(kind));
    } catch {}
    return false;
  },
  async interstitial() {
    try {
      if (Ads.provider?.showInterstitial) await Ads.provider.showInterstitial();
    } catch {}
  },
  async buyRemoveAds() {
    try {
      if (Ads.provider?.purchaseRemoveAds) return !!(await Ads.provider.purchaseRemoveAds());
    } catch {}
    return false;
  },
  async restore() {
    try {
      if (Ads.provider?.restorePurchases) return !!(await Ads.provider.restorePurchases());
    } catch {}
    return false;
  },
};

/* Deliberately quiet. The reviews of every rival in this genre are dominated by
   ad complaints, so an interstitial needs BOTH gaps to pass, never appears
   after a loss, and never during the tutorial. */
const AD_EVERY_LEVELS = 4;
const AD_MIN_GAP_MS = 90000;

/* ═══════════  shapes  ═══════════ */

const SHAPES = {
  square4: { name: "Grid", rows: ["####", "####", "####", "####"] },
  square5: { name: "Grid", rows: ["#####", "#####", "#####", "#####", "#####"] },
  diamond7: { name: "Diamond", rows: ["...#...", "..###..", ".#####.", "#######", ".#####.", "..###..", "...#..."] },
  diamond11: {
    name: "Diamond",
    rows: [".....#.....", "....###....", "...#####...", "..#######..", ".#########.", "###########", ".#########.", "..#######..", "...#####...", "....###....", ".....#....."],
  },
  heart9: { name: "Heart", rows: [".##...##.", "#########", "#########", "#########", ".#######.", "..#####..", "...###...", "....#...."] },
  heart13: {
    name: "Heart",
    rows: ["..###...###..", ".#####.#####.", "#############", "#############", "#############", ".###########.", ".###########.", "..#########..", "...#######...", "....#####....", ".....###.....", "......#......"],
  },
  cross7: { name: "Cross", rows: ["..###..", "..###..", "#######", "#######", "#######", "..###..", "..###.."] },
  cross11: {
    name: "Cross",
    rows: ["....###....", "....###....", "....###....", "###########", "###########", "###########", "....###....", "....###....", "....###....", "....###....", "....###...."],
  },
  star: {
    name: "Star",
    rows: ["......#......", ".....###.....", ".....###.....", "#############", ".###########.", "..#########..", "..#########..", "..#########..", "...#######...", "..###...###..", "..###...###..", ".##.......##.", ".##.......##."],
  },
  ring11: {
    name: "Ring",
    rows: ["...#####...", ".#########.", "####...####", "###.....###", "##.......##", "##.......##", "##.......##", "###.....###", "####...####", ".#########.", "...#####..."],
  },
  triangle11: {
    name: "Triangle",
    rows: [".....#.....", "....###....", "....###....", "...#####...", "...#####...", "..#######..", "..#######..", ".#########.", ".#########.", "###########", "###########"],
  },
  bigarrow11: {
    name: "Arrow",
    rows: [".....#.....", "....###....", "...#####...", "..#######..", ".#########.", "###########", "....###....", "....###....", "....###....", "....###....", "....###...."],
  },
  hexagon11: {
    name: "Hexagon",
    rows: ["...#####...", "..#######..", ".#########.", "###########", "###########", "###########", ".#########.", "..#######..", "...#####..."],
  },
  bolt9: {
    name: "Bolt",
    rows: ["......###", ".....###.", "....###..", "...###...", "..######.", ".#######.", "....###..", "...###...", "..###....", ".###.....", "###......"],
  },
  house11: {
    name: "House",
    rows: [".....#.....", "....###....", "...#####...", "..#######..", ".#########.", "###########", "###########", "###########", "####...####", "####...####", "####...####"],
  },
  bell11: {
    name: "Bell",
    rows: [".....#.....", "....###....", "...#####...", "...#####...", "..#######..", "..#######..", ".#########.", ".#########.", "###########", ".....#.....", "....###...."],
  },
  moon11: {
    name: "Moon",
    rows: ["....###....", "..#####....", ".######....", "#####......", "####.......", "####.......", "####.......", "#####......", ".######....", "..#####....", "....###...."],
  },
  flower11: {
    name: "Flower",
    rows: ["...##.##...", "..#######..", ".#########.", "###########", ".#########.", "..#######..", "....###....", "....###....", "..######...", "....###....", "....###...."],
  },
  ghost11: {
    name: "Ghost",
    rows: ["...#####...", "..#######..", ".#########.", "###########", "###########", "###########", "###########", "###########", "###########", "##.##.##.##", "#..##.##..#"],
  },
  apple11: {
    name: "Apple",
    rows: [".....#.....", "...####....", ".#########.", "###########", "###########", "###########", "###########", "###########", ".#########.", "..##...##..", "..##...##.."],
  },
  catArt: { name: "Cat", rows: [".#.......#....", ".#.......#....", ".##..#..##....", ".#########....", ".#########....", "###########...", "###########...", "###########...", "###########...", ".#########....", ".#########....", "...#####......", "...#####......", "...#####......", "..#######.....", "..#######.##..", "..###########.", "..###########.", ".############.", ".############.", ".############.", ".#############", ".############."] },
  dogArt: { name: "Dog", rows: ["......#####......", ".....#######.....", "..#.#########.#..", ".###############.", ".###############.", ".################", "#################", "#################", ".###########.####", ".###..#####..###.", ".###.#######.###.", "..#..#######..#..", ".....#######.....", ".....########....", "....############.", "....############.", "....############.", "....############.", "...#############.", "...#############.", "...############.."] },
  elephantArt: { name: "Elephant", rows: ["..........#####....", "....#...########...", "..####.##########..", ".################..", ".#################.", ".#################.", "#################..", "#################..", ".###############...", ".#################.", ".#################.", "..################.", "....##############.", ".....#############.", ".....#############.", "....###############", "....###############", "....###############", "....###############", "....###############", ".....###.....###..."] },
  butterflyArt: { name: "Butterfly", rows: ["...........##...........", "..######..####..######..", ".########..##..########.", ".#########.##.##########", "##########.##.##########", "########################", "########################", "##########.##.##########", ".#########.##.#########.", "..#######..##..########.", "...#####...##...#####...", "....#####..##..#####....", "....######.##.#######...", "...##################...", "...##################...", "...##################...", "...##################...", "...##################...", "...##################...", "....######.##.######....", "....#####..##..#####...."] },
  umbrellaArt: { name: "Umbrella", rows: ["..........###..........", "......###########......", "....###############....", "...#################...", "..###################..", ".#####################.", ".#####################.", "#######################", "#######################", "#######################", "..........###..........", "..........###..........", "..........###..........", "..........###..........", "..........###..........", "..........###..........", "..........###..........", "..........###..........", "..........###..........", ".......######..........", "........#####..........", "........#####.........."] },
  anchorArt: { name: "Anchor", rows: [".........###.........", "........##.##........", "........##.##........", ".........###.........", ".........###.........", ".....###########.....", "....#############....", "....#############....", ".........###.........", ".........###.........", ".........###.........", ".........###.........", "###......###......###", "###......###......###", "###......###......###", "####.....###.....####", ".###.....###.....###.", ".####....###....####.", ".######..###..######.", "...###############...", ".....###########.....", ".......########......", "........#####........"] },
  trophyArt: { name: "Trophy", rows: [".....#############.....", ".....#############.....", ".#####################.", "#######################", "###...###########...###", "###...###########...###", "###...###########...###", "#####.###########.#####", "#######################", ".####..#########..####.", ".......#########.......", ".......#########.......", "..........###..........", "..........###..........", "..........###..........", "..........###..........", "......###########......", ".....#############.....", ".....#############.....", "...#################...", "...#################...", "....###############...."] },
  crownArt: { name: "Crown", rows: [".........##.........", ".........###........", "###......##......###", "###......##......###", ".#......####......#.", ".##.....####.....##.", ".##....######....##.", ".###...######...###.", ".###...######...###.", ".####.########.####.", ".##################.", "####################", "####################", "####################", "####################", "####################", "####################", "####################", "####################", "####################", "####################"] },
  treeArt: { name: "Tree", rows: ["..........###..........", ".......#########.......", "......###########......", ".....#############.....", "....###############....", "....###############....", "...#################...", "..###################..", ".#####################.", ".#####################.", "#######################", "#######################", ".#####################.", ".#####################.", "..###################..", "....#####.###.#####....", "..........###..........", "..........###..........", "..........###..........", "..........###..........", "..........###..........", "..........###..........", "..........###.........."] },
  fishArt: { name: "Fish", rows: ["...........#............", "..........##............", ".........###............", "........#####...........", ".......######...........", "......#######..........#", "....##########........##", "..##############....####", ".################..#####", ".################.######", "#######################.", "#######################.", "#######################.", "#######################.", ".################.######", ".################..#####", "..##############....####", "....##########........##", "......#######..........#", "........#####...........", ".........####...........", ".........###............", "..........##............", "...........#............"] },
  birdArt: { name: "Bird", rows: ["......####.............", ".....#######...........", "....########...........", "....#########..........", "##.##########.....###..", "##..################...", ".#..################...", ".....##############....", "......##############...", "......##############...", "......##############...", "......##############...", "......##############...", ".......############....", "........###########....", ".........############..", "............##..#######"] },
  guitarArt: { name: "Guitar", rows: ["....######....", "....######....", "......##......", "......##......", "......##......", "....######....", "...########...", "..##########..", "..##########..", "..##########..", "..##########..", "..##########..", "..##########..", ".############.", "##############", "##############", "##############", "##############", "##############", "##############", ".############.", "..##########..", "...########...", "......##......"] },
  hourglassArt: { name: "Hourglass", rows: ["#################", "#################", ".###############.", "..#############..", "...###########...", "....#########....", "....#########....", ".....#######.....", "......#####......", ".......###.......", ".......###.......", ".......###.......", "......#####......", ".....#######.....", "....#########....", "....#########....", "...###########...", "..#############..", ".###############.", "#################", "#################"] },
  keyArt: { name: "Key", rows: ["...#####...............", "..########.............", ".##########............", "#####..####............", "####....###############", "###.....###############", "###.....###############", "####...################", ".##########......###.##", ".#########.......###.##", "..#######........###.##", ".....##..........###.#.", "..................#...."] },
  mushroomArt: { name: "Mushroom", rows: ["......#########......", "....#############....", "..#################..", ".###################.", ".###################.", "#####################", "#####################", "#####################", ".......#######.......", ".......#######.......", ".......#######.......", ".......#######.......", ".......#######.......", ".......#######.......", ".......#######.......", ".......#######.......", ".......#######.......", ".......#######.......", ".......#######.......", "........#####........"] },
  rocketArt: { name: "Rocket", rows: [".......##.......", ".......##.......", "......####......", "......#####.....", ".....######.....", "....########....", "....########....", "....########....", "....########....", "....########....", "...##########...", "...##########...", "..############..", "..############..", ".##############.", ".##############.", "################", "##...######...##", "......####......", "......####......", ".......##.......", ".......##......."] },
};

const COLLECTABLE = ["Cat", "Dog", "Elephant", "Butterfly", "Umbrella", "Anchor", "Trophy", "Crown", "Tree", "Fish", "Bird", "Guitar", "Hourglass", "Key", "Mushroom", "Rocket", "Grid", "Diamond", "Heart", "Cross"];
const THUMB = { Cat: "catArt", Dog: "dogArt", Elephant: "elephantArt", Butterfly: "butterflyArt", Umbrella: "umbrellaArt", Anchor: "anchorArt", Trophy: "trophyArt", Crown: "crownArt", Tree: "treeArt", Fish: "fishArt", Bird: "birdArt", Guitar: "guitarArt", Hourglass: "hourglassArt", Key: "keyArt", Mushroom: "mushroomArt", Rocket: "rocketArt", Grid: "square5", Diamond: "diamond7", Heart: "heart9", Cross: "cross7" };

/* ═══════════  tiers  ═══════════ */

const TIERS = [
  { name: "Warm Up", span: 2, pool: ["rocketArt", "keyArt", "hourglassArt"],
    maxLen: 4, hearts: 3, hints: 3, undos: 3, coverage: 0.88, tightness: 0.62, freedom: 0.15, pieces: 22, maxCells: 70 },
  { name: "Little Easy", span: 3, pool: ["birdArt", "hourglassArt", "rocketArt", "mushroomArt"],
    maxLen: 4, hearts: 3, hints: 3, undos: 3, coverage: 0.89, tightness: 0.66, freedom: 0.1341, pieces: 26, maxCells: 88 },
  { name: "Easy", span: 4, pool: ["keyArt", "umbrellaArt", "birdArt", "guitarArt"],
    maxLen: 5, hearts: 3, hints: 3, undos: 2, coverage: 0.9, tightness: 0.7, freedom: 0.1199, pieces: 30, maxCells: 108 },
  { name: "Easy Plus", span: 5, pool: ["rocketArt", "birdArt", "hourglassArt", "heart9"],
    maxLen: 5, hearts: 3, hints: 2, undos: 2, coverage: 0.9, tightness: 0.74, freedom: 0.1072, pieces: 35, maxCells: 130 },
  { name: "Little Medium", span: 6, pool: ["mushroomArt", "birdArt", "keyArt", "umbrellaArt"],
    maxLen: 6, hearts: 3, hints: 2, undos: 2, coverage: 0.91, tightness: 0.77, freedom: 0.0958, pieces: 40, maxCells: 155 },
  { name: "Medium", span: 8, pool: ["catArt", "guitarArt", "anchorArt", "mushroomArt"],
    maxLen: 6, hearts: 3, hints: 2, undos: 2, coverage: 0.92, tightness: 0.8, freedom: 0.0857, pieces: 45, maxCells: 182 },
  { name: "Medium Plus", span: 10, pool: ["dogArt", "umbrellaArt", "crownArt", "catArt"],
    maxLen: 7, hearts: 3, hints: 2, undos: 2, coverage: 0.92, tightness: 0.83, freedom: 0.0766, pieces: 50, maxCells: 210 },
  { name: "Tricky", span: 12, pool: ["treeArt", "trophyArt", "fishArt", "dogArt"],
    maxLen: 8, hearts: 3, hints: 2, undos: 1, coverage: 0.93, tightness: 0.86, freedom: 0.0685, pieces: 56, maxCells: 240 },
  { name: "Tough", span: 14, pool: ["fishArt", "crownArt", "guitarArt", "treeArt"],
    maxLen: 9, hearts: 3, hints: 2, undos: 1, coverage: 0.94, tightness: 0.88, freedom: 0.0612, pieces: 62, maxCells: 272 },
  { name: "Hard", span: 17, pool: ["elephantArt", "butterflyArt", "catArt", "trophyArt"],
    maxLen: 10, hearts: 3, hints: 1, undos: 1, coverage: 0.94, tightness: 0.9, freedom: 0.0547, pieces: 68, maxCells: 305 },
  { name: "Very Hard", span: 20, pool: ["butterflyArt", "elephantArt", "dogArt", "fishArt"],
    maxLen: 11, hearts: 3, hints: 1, undos: 1, coverage: 0.95, tightness: 0.92, freedom: 0.0489, pieces: 74, maxCells: 340 },
  { name: "Super Hard", span: 24, pool: ["elephantArt", "butterflyArt", "treeArt", "catArt"],
    maxLen: 12, hearts: 3, hints: 1, undos: 1, coverage: 0.96, tightness: 0.94, freedom: 0.0437, pieces: 80, maxCells: 375 },
  { name: "Expert", span: 30, pool: ["butterflyArt", "elephantArt", "fishArt", "crownArt"],
    maxLen: 13, hearts: 3, hints: 1, undos: 1, coverage: 0.96, tightness: 0.96, freedom: 0.0391, pieces: 86, maxCells: 410 },
  { name: "Elite", span: 36, pool: ["elephantArt", "butterflyArt", "dogArt", "trophyArt"],
    maxLen: 14, hearts: 3, hints: 1, undos: 1, coverage: 0.97, tightness: 0.97, freedom: 0.035, pieces: 92, maxCells: 445 },
  { name: "Master", span: 45, pool: ["butterflyArt", "elephantArt", "catArt", "treeArt"],
    maxLen: 15, hearts: 3, hints: 1, undos: 1, coverage: 0.98, tightness: 0.99, freedom: 0.0312, pieces: 98, maxCells: 480 },
  { name: "Pro", span: Infinity, pool: ["elephantArt", "butterflyArt", "fishArt", "dogArt"],
    maxLen: 16, hearts: 3, hints: 1, undos: 1, coverage: 0.99, tightness: 1.0, freedom: 0.0279, pieces: 105, maxCells: 520 },
];
const MEDAL = { 1: "#CD7F32", 2: "#AEB6C4", 3: "#FFC24B" };
const TIER_HUE = ["#5FCB8A", "#4CC79B", "#3FBFD6", "#3EA8EE", "#3E9BF0", "#5580F2", "#6C7BF0", "#8470F2", "#9A6BF0", "#C07AD8", "#F0A93E", "#F2891B", "#F2761B", "#FF6A4A", "#FF3D9A", "#B14BFF"];

/* arrow palettes — competitors are all monochrome navy, this is free differentiation */
const PALETTES = {
  ink: { name: "Ink", base: "#1B2440" },
  candy: { name: "Candy", right: "#2F7BF6", left: "#FF4D6A", up: "#8B5CF6", down: "#F59E0B" },
  forest: { name: "Forest", right: "#0E9F6E", left: "#0EA5E9", up: "#65A30D", down: "#EAB308" },
  sunset: { name: "Sunset", right: "#F2761B", left: "#E11D74", up: "#7C3AED", down: "#FBBF24" },
};
const PALETTE_KEYS = Object.keys(PALETTES);
const toneFor = (dir, theme) => {
  const p = PALETTES[theme] || PALETTES.ink;
  return p.base ? C.ink : p[dir] || C.ink;
};


function tierFor(level) {
  let start = 1;
  for (let i = 0; i < TIERS.length; i++) {
    if (level < start + TIERS[i].span) return { tier: TIERS[i], index: i, start, step: level - start + 1 };
    start += TIERS[i].span;
  }
  const last = TIERS.length - 1;
  return { tier: TIERS[last], index: last, start, step: level - start + 1 };
}

function parseMask(key) {
  const s = SHAPES[key];
  const rows = s.rows.length;
  const cols = s.rows[0].length;
  const cells = new Set();
  s.rows.forEach((row, r) => [...row].forEach((ch, c) => ch === "#" && cells.add(r * cols + c)));
  return { name: s.name, rows, cols, cells };
}


/* ═══════════  endless shapes  ═══════════
   The 17 hand-drawn masks stay as the collectable set. Past level 60 the game
   builds new silhouettes from a seed — mirrored so they read as designed
   rather than random, then cleaned so there are no spurs or holes. Level 200
   is the same shape for every player, everywhere. */

const CURATED_UNTIL = 44; // hand-drawn art up to here, generated art beyond
const FORM_A = ["Twin", "Wide", "Tall", "Round", "Sharp", "Split", "Deep", "Open", "Half", "Broad"];
const FORM_B = ["Bloom", "Arch", "Crest", "Drift", "Prism", "Wave", "Knot", "Spire", "Vault", "Ridge"];

function refineMask(cells, W, H) {
  let set = new Set(cells);
  const nb = (i) => {
    const x = i % W, y = (i / W) | 0, out = [];
    if (x > 0) out.push(i - 1);
    if (x < W - 1) out.push(i + 1);
    if (y > 0) out.push(i - W);
    if (y < H - 1) out.push(i + W);
    return out;
  };
  for (let pass = 0; pass < 2; pass++) {       // close small holes
    const add = [];
    for (let i = 0; i < W * H; i++)
      if (!set.has(i) && nb(i).filter((n) => set.has(n)).length >= 3) add.push(i);
    add.forEach((i) => set.add(i));
  }
  for (let pass = 0; pass < 2; pass++) {       // shave lonely spurs
    const del = [];
    set.forEach((i) => {
      if (nb(i).filter((n) => set.has(n)).length < 2) del.push(i);
    });
    del.forEach((i) => set.delete(i));
  }
  const seen = new Set();                      // keep the largest island only
  let best = [];
  set.forEach((start) => {
    if (seen.has(start)) return;
    const stack = [start], comp = [];
    seen.add(start);
    while (stack.length) {
      const c = stack.pop();
      comp.push(c);
      nb(c).forEach((n) => {
        if (set.has(n) && !seen.has(n)) { seen.add(n); stack.push(n); }
      });
    }
    if (comp.length > best.length) best = comp;
  });
  return new Set(best);
}


function proceduralMask(seed) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const rnd = mulberry32(seed * 7919 + attempt);
    const W = 9 + ((rnd() * 5) | 0);
    const H = 9 + ((rnd() * 4) | 0);
    const fourFold = rnd() < 0.3;
    const half = Math.ceil(W / 2);
    const vHalf = fourFold ? Math.ceil(H / 2) : H;
    const raw = new Set();

    const blobs = 4 + ((rnd() * 3) | 0);
    for (let b = 0; b < blobs; b++) {
      const bx = rnd() * half;
      const by = rnd() * vHalf;
      const rx = 0.9 + rnd() * 1.7;
      const ry = 0.9 + rnd() * 2.1;
      for (let y = 0; y < vHalf; y++)
        for (let x = 0; x < half; x++) {
          const dx = (x - bx) / rx, dy = (y - by) / ry;
          if (dx * dx + dy * dy <= 1) raw.add(y * W + x);
        }
    }

    // carve a notch or hollow, otherwise silhouettes come out as slabs
    if (rnd() < 0.55) {
      const cx0 = rnd() * half * 0.9;
      const cy0 = rnd() * vHalf;
      const cr = 0.8 + rnd() * 1.5;
      for (let y = 0; y < vHalf; y++)
        for (let x = 0; x < half; x++) {
          const dx = (x - cx0) / cr, dy = (y - cy0) / cr;
          if (dx * dx + dy * dy <= 1) raw.delete(y * W + x);
        }
    }

    const mirrored = new Set(raw);
    raw.forEach((i) => {
      const y = (i / W) | 0, x = i % W;
      mirrored.add(y * W + (W - 1 - x));
    });
    if (fourFold) {
      [...mirrored].forEach((i) => {
        const y = (i / W) | 0, x = i % W;
        mirrored.add((H - 1 - y) * W + x);
      });
    }

    const cleaned = refineMask(mirrored, W, H);
    if (cleaned.size < 36 || cleaned.size > 108) continue;
    const m = cropMask(cleaned, W, H);
    if (m.cols < 7 || m.rows < 7) continue;
    if (m.cells.size / (m.cols * m.rows) > 0.86) continue;  // near-rectangles read as unfinished
    const name = `${FORM_A[(seed * 3) % FORM_A.length]} ${FORM_B[(seed * 5) % FORM_B.length]}`;
    return { ...m, name, procedural: true };
  }
  return { ...parseMask("diamond7"), procedural: true };
}


/* ═══════════  shape codes  ═══════════
   A mask packs into a short code, so a shape someone draws can be sent to a
   friend and played on their phone, exactly as drawn. */

function encodeMask(cols, rows, cells) {
  const n = cols * rows;
  const bytes = new Uint8Array(Math.ceil(n / 8));
  for (let i = 0; i < n; i++) if (cells.has(i)) bytes[i >> 3] |= 128 >> (i & 7);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return `${cols}x${rows}-${btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

function decodeMask(code) {
  const m = /^(\d+)x(\d+)-([A-Za-z0-9\-_]+)$/.exec((code || "").trim());
  if (!m) return null;
  const cols = +m[1], rows = +m[2];
  if (cols < 4 || rows < 4 || cols > 40 || rows > 40) return null;  // artwork masks reach 26+
  let b64 = m[3].replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  try {
    const bin = atob(b64);
    const cells = new Set();
    for (let i = 0; i < cols * rows; i++) {
      const b = bin.charCodeAt(i >> 3) || 0;
      if (b & (128 >> (i & 7))) cells.add(i);
    }
    if (cells.size < 20) return null;
    return { cols, rows, cells, name: "Shared shape", custom: true };
  } catch {
    return null;
  }
}

function tidyDrawing(cols, rows, cells) {
  let x0 = cols, x1 = -1, y0 = rows, y1 = -1;
  cells.forEach((i) => {
    const x = i % cols, y = (i / cols) | 0;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  });
  if (x1 < 0) return null;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const out = new Set();
  cells.forEach((i) => out.add((((i / cols) | 0) - y0) * w + (i % cols - x0)));
  return { cols: w, rows: h, cells: out };
}


/* ═══════════  geometry  ═══════════ */

const cx = (i, cols) => (i % cols) * U + U / 2;
const cy = (i, cols) => Math.floor(i / cols) * U + U / 2;

const W_BOARD = 11.5;
const W_MINI = 8;

function piecePath(piece, cols) {
  const D = DIRS[piece.dir];
  const pts = [...piece.cells].reverse().map((i) => ({ x: cx(i, cols), y: cy(i, cols) }));
  const head = pts[pts.length - 1];
  if (pts.length === 1) pts.unshift({ x: head.x - D.dx * 34, y: head.y - D.dy * 34 });
  const tip = { x: head.x + D.dx * 7, y: head.y + D.dy * 7 };
  return `M ${pts[0].x} ${pts[0].y} ` + pts.slice(1).map((p) => `L ${p.x} ${p.y}`).join(" ") + ` L ${tip.x} ${tip.y}`;
}

function headChevron(piece, cols) {
  const i = piece.cells[0];
  const hx = cx(i, cols);
  const hy = cy(i, cols);
  return { d: `M ${hx + 2} ${hy - 15} L ${hx + 25} ${hy} L ${hx + 2} ${hy + 15}`, rot: `rotate(${DIRS[piece.dir].angle} ${hx} ${hy})` };
}

function Piece({ piece, cols, tone, width, className, style, hit, onDown }) {
  const d = piecePath(piece, cols);
  const chev = headChevron(piece, cols);
  return (
    <g className={className} style={style}>
      <path d={d} stroke={tone} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d={chev.d} transform={chev.rot} stroke={tone} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      {onDown && (
        <path d={d} stroke="transparent" strokeWidth={hit} strokeLinecap="round" strokeLinejoin="round" fill="none" pointerEvents="stroke" style={{ cursor: "pointer" }} onPointerDown={onDown} />
      )}
    </g>
  );
}

/* The head always exits straight, but the body should follow the bends behind
   it — so we draw one long path (body + exit lane) and slide a dash along it. */
function departGeom(piece, cols, rows) {
  const D = DIRS[piece.dir];
  const pts = [...piece.cells].reverse().map((i) => ({ x: cx(i, cols), y: cy(i, cols) }));
  const head = pts[pts.length - 1];
  if (pts.length === 1) pts.unshift({ x: head.x - D.dx * 34, y: head.y - D.dy * 34 });

  let bodyLen = 0;
  for (let i = 1; i < pts.length; i++) {
    bodyLen += Math.abs(pts[i].x - pts[i - 1].x) + Math.abs(pts[i].y - pts[i - 1].y);
  }
  bodyLen += 7; // out to the chevron base

  const lanes = exitLine(piece.cells[0], piece.dir, cols, rows).length;
  const travel = (lanes + 1.5) * U + bodyLen;
  const end = { x: head.x + D.dx * travel, y: head.y + D.dy * travel };
  const d =
    `M ${pts[0].x} ${pts[0].y} ` +
    pts.slice(1).map((q) => `L ${q.x} ${q.y}`).join(" ") +
    ` L ${end.x} ${end.y}`;
  return { d, bodyLen, travel, D };
}

function DepartingPiece({ piece, cols, rows, tone }) {
  const g = departGeom(piece, cols, rows);
  const chev = headChevron(piece, cols);
  return (
    <g className="dep-fade">
      <path
        d={g.d}
        stroke={tone}
        strokeWidth={W_BOARD}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        className="snake"
        style={{
          strokeDasharray: `${g.bodyLen} ${g.bodyLen + g.travel + 400}`,
          "--off": `-${g.travel}px`,
        }}
      />
      <g className="chev-out" style={{ "--tx": `${g.D.dx * g.travel}px`, "--ty": `${g.D.dy * g.travel}px` }}>
        <path
          d={chev.d}
          transform={chev.rot}
          stroke={tone}
          strokeWidth={W_BOARD}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </g>
    </g>
  );
}

function ShapeThumb({ shapeKey, on }) {
  const m = parseMask(shapeKey);
  return (
    <svg viewBox={`0 0 ${m.cols} ${m.rows}`} style={{ width: 40, height: 40 }}>
      {[...m.cells].map((i) => (
        <rect key={i} x={(i % m.cols) + 0.15} y={Math.floor(i / m.cols) + 0.15} width={0.7} height={0.7} rx={0.2} fill={on ? C.accent : C.line} />
      ))}
    </svg>
  );
}

const todayKey = () => new Date().toISOString().slice(0, 10);

/* ═══════════  game  ═══════════ */

export default function ArrowEscapeV2() {
  const [mode, setMode] = useState("journey");
  const [level, setLevel] = useState(1);
  const [best, setBest] = useState(1);
  const [setup, setSetup] = useState(() => makeLevel(1));
  const [alive, setAlive] = useState(() => new Set(setup.pieces.map((p) => p.id)));
  const [history, setHistory] = useState([]);
  const [hearts, setHearts] = useState(setup.hearts);
  const [shield, setShield] = useState(false);
  const [flow, setFlow] = useState(0);
  const [combo, setCombo] = useState(0);
  const [score, setScore] = useState(0);
  const [bestScore, setBestScore] = useState(0);
  const [hintsLeft, setHintsLeft] = useState(setup.hints);
  const [undosLeft, setUndosLeft] = useState(setup.undos);
  const [taps, setTaps] = useState(0);
  const [mistakes, setMistakes] = useState(0);
  const [flying, setFlying] = useState(new Map());
  const lastMiss = useRef({ id: -1, t: 0 });
  const scoreLog = useRef(new Map()); // what each arrow paid, so undo can refund
  const [bad, setBad] = useState(null);
  const [hintId, setHintId] = useState(null);
  const [holdId, setHoldId] = useState(null);
  const [tut, setTut] = useState(0); // 0 tap · 1 blocked · 2 hold · 9 done
  const tutClears = useRef(0);
  const [pops, setPops] = useState([]);
  const [ring, setRing] = useState(null);
  const [phase, setPhase] = useState("playing");
  const [heartPop, setHeartPop] = useState(false);
  const [screen, setScreen] = useState("home"); // home | play | studio | collection | settings
  const [grid, setGrid] = useState(false);
  const [zen, setZen] = useState(false);
  const [bigTouch, setBigTouch] = useState(true);
  const [haptics, setHaptics] = useState(true);
  const [sfxOn, setSfxOn] = useState(true);
  const [musicOn, setMusicOn] = useState(true);
  const [theme, setTheme] = useState("ink");
  const [dark, setDark] = useState(false);
  const [coachSeen, setCoachSeen] = useState(true);
  const [ranks, setRanks] = useState({}); // shape name -> 1 bronze | 2 silver | 3 gold
  const [customs, setCustoms] = useState([]);
  const [found, setFound] = useState([]);
  const [stickers, setStickers] = useState([]);
  const [levelStars, setLevelStars] = useState({}); // level -> 1..3
  const [adsRemoved, setAdsRemoved] = useState(false);
  const [adNote, setAdNote] = useState("");
  const adGate = useRef({ at: 0, since: 0 });
  const [badges, setBadges] = useState([]);
  const [stats, setStats] = useState({ arrows: 0, flawRun: 0, noUndo: 0, bestChain: 0 });
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });
  const [snap, setSnap] = useState(false);
  const [levelKey, setLevelKey] = useState(0);
  const nextRef = useRef(null);
  const [streak, setStreak] = useState(0);
  const [dailyDone, setDailyDone] = useState(false);
  const press = useRef(null);
  const viewport = useRef(null);
  const ptrs = useRef(new Map());
  const gest = useRef(null);

  if (C.__dark !== dark) applyTheme(dark); // keep S and CSS in step with the theme

  const { mask, pieces, tier, tierIndex, stepInTier } = setup;
  const { cols, rows } = mask;
  const maxHearts = setup.hearts;

  useEffect(() => {
    HAPTICS = haptics;
  }, [haptics]);

  useEffect(() => {
    Snd.setSfx(sfxOn);
  }, [sfxOn]);

  useEffect(() => {
    Snd.setMusic(musicOn);
  }, [musicOn]);

  useEffect(() => {
    const vis = () => (document.hidden ? Snd.suspend() : Snd.resume());
    document.addEventListener("visibilitychange", vis);
    return () => document.removeEventListener("visibilitychange", vis);
  }, []);

  const occupancy = useMemo(() => {
    const m = new Map();
    pieces.forEach((p) => alive.has(p.id) && p.cells.forEach((c) => m.set(c, p.id)));
    return m;
  }, [pieces, alive]);

  const blockerOf = useCallback(
    (piece) => {
      for (const c of exitLine(piece.cells[0], piece.dir, cols, rows)) {
        const o = occupancy.get(c);
        if (o !== undefined && o !== piece.id) return o;
      }
      return null;
    },
    [occupancy, cols, rows]
  );

  const progress = pieces.length ? ((pieces.length - alive.size) / pieces.length) * 100 : 0;

  /* ── persistence ── */
  useEffect(() => {
    (async () => {
      try {
        const raw = await Store.get(SAVE_KEY);
        if (!raw) {
          setCoachSeen(false);
          return;
        }
        const p = JSON.parse(raw);
        setBest(p.best ?? 1);
        setBestScore(p.bestScore ?? 0);
        setZen(!!p.zen);
        setBigTouch(p.bigTouch !== false);
        setHaptics(p.haptics !== false);
        setSfxOn(p.sfx !== false);
        setMusicOn(p.music !== false);
        setTheme(p.theme || "ink");
        setDark(!!p.dark);
        setCoachSeen(!!p.coachSeen);
        setTut(p.tut ?? 0);
        // migrate the old flat list into bronze ranks
        setRanks(p.ranks ?? Object.fromEntries((p.collected ?? []).map((n) => [n, 1])));
        setCustoms(p.customs ?? []);
        setFound(p.found ?? []);
        setStickers(p.stickers ?? []);
        setLevelStars(p.levelStars ?? {});
        setAdsRemoved(!!p.adsRemoved);
        setBadges(p.badges ?? []);
        setStats(p.stats ?? { arrows: 0, flawRun: 0, noUndo: 0, bestChain: 0 });
        setStreak(p.streak ?? 0);
        setGrid(!!p.grid);
        setDailyDone(p.lastDaily === todayKey());
        if (p.level > 1) {
          const st = makeLevel(p.level);
          setLevel(p.level);
          setSetup(st);
          setAlive(new Set(st.pieces.map((x) => x.id)));
          setHearts(st.hearts);
          setHintsLeft(st.hints);
          setUndosLeft(st.undos);
              }
      } catch {
        setCoachSeen(false);
      }
    })();
  }, []);

  const setTutStep = useCallback(
    (n) => {
      setTut(n);
      persistRef.current({ tut: n });
    },
    []
  );

  const persist = useCallback(async (patch) => {
    try {
      let cur = {};
      try {
        const raw = await Store.get(SAVE_KEY);
        if (raw) cur = JSON.parse(raw);
      } catch {}
      await Store.set(SAVE_KEY, JSON.stringify({ ...cur, ...patch }));
    } catch {}
  }, []);

  const persistRef = useRef(() => {});
  persistRef.current = persist;

  const flashNote = useCallback((t) => {
    setAdNote(t);
    setTimeout(() => setAdNote(""), 2600);
  }, []);

  /* A life back, on the same board — the one reward players actually want. */
  const watchForLife = useCallback(async () => {
    const ok = await Ads.rewarded("life");
    if (!ok) return flashNote("No ad available right now.");
    setHearts(1);
    setPhase("playing");
    Snd.shieldUp();
  }, [flashNote]);

  const watchForHint = useCallback(async () => {
    const ok = await Ads.rewarded("hint");
    if (!ok) return flashNote("No ad available right now.");
    setHintsLeft((n) => n + 1);
  }, [flashNote]);

  const maybeInterstitial = useCallback(() => {
    if (adsRemoved) return;
    const g = adGate.current;
    g.since++;
    const now = Date.now();
    if (g.since < AD_EVERY_LEVELS || now - g.at < AD_MIN_GAP_MS) return;
    g.since = 0;
    g.at = now;
    Ads.interstitial();
  }, [adsRemoved]);

  /* ── level control ── */
  const applySetup = useCallback((st, keepScore) => {
    setSetup(st);
    setAlive(new Set(st.pieces.map((p) => p.id)));
    setHistory([]);
    scoreLog.current.clear();
    setHearts(st.hearts);
    setHintsLeft(st.hints);
    setUndosLeft(st.undos);
    setShield(false);
    setFlow(0);
    setCombo(0);
    if (!keepScore) setScore(0);
    setTaps(0);
    setMistakes(0);
    setFlying(new Map());
    lastMiss.current = { id: -1, t: 0 };
    setBad(null);
    setHintId(null);
    setHoldId(null);
    setPops([]);
    setRing(null);
    setPhase("playing");
    setLevelKey((k) => k + 1);
    viewRef.current = { scale: 1, tx: 0, ty: 0 };
    setView({ scale: 1, tx: 0, ty: 0 });
    press.current = null;
    gest.current = null;
    ptrs.current.clear();
  }, []);

  const startJourney = useCallback(
    (lvl, keepScore) => {
      setMode("journey");
      const pre = nextRef.current && nextRef.current.lvl === lvl ? nextRef.current.setup : makeLevel(lvl);
      nextRef.current = null;
      applySetup(pre, keepScore);
    },
    [applySetup]
  );

  const startCustom = useCallback(
    (mask) => {
      setMode("custom");
      applySetup(makeLevelFromMask(mask, tierFor(level).index), false);
    },
    [applySetup, level]
  );

  const saveCustom = useCallback(
    (code) => {
      const next = [code, ...customs.filter((c) => c !== code)].slice(0, 12);
      setCustoms(next);
      persist({ customs: next });
    },
    [persist, customs]
  );

  const deleteCustom = useCallback(
    (code) => {
      const next = customs.filter((c) => c !== code);
      setCustoms(next);
      persist({ customs: next });
    },
    [persist, customs]
  );

  const startDaily = useCallback(() => {
    setMode("daily");
    // the daily should keep pace with the player, not sit at one fixed tier
    const lvl = Math.max(12, Math.min(level, 400));
    applySetup(makeLevel(lvl, hashStr(todayKey())));
  }, [applySetup, level]);

  // prebuild the next board during the celebration — no hitch on Next Level
  useEffect(() => {
    if (phase !== "cleared" || mode === "daily") return;
    const t = setTimeout(() => {
      nextRef.current = { lvl: level + 1, setup: makeLevel(level + 1) };
    }, 80);
    return () => clearTimeout(t);
  }, [phase, mode, level]);

  const restart = useCallback(() => {
    if (mode === "daily") startDaily();
    else if (mode === "custom") applySetup(makeLevelFromMask(setup.mask, setup.tierIndex), false);
    else startJourney(level);
  }, [mode, level, startDaily, startJourney, applySetup, setup.mask]);

  const nextLevel = useCallback(() => {
    maybeInterstitial();
    if (mode === "custom") {
      startJourney(level);
      return;
    }
    if (mode === "daily") {
      startJourney(level);
      return;
    }
    const n = level + 1;
    const b = Math.max(best, n);
    setLevel(n);
    setBest(b);
    persist({ level: n, best: b });
    startJourney(n, true);
  }, [mode, level, best, persist, startJourney]);

  /* ── popups ── */
  const addPop = useCallback((cell, text, hue) => {
    const id = Math.random();
    setPops((p) => [...p, { id, x: cx(cell, cols), y: cy(cell, cols), text, hue }]);
    setTimeout(() => setPops((p) => p.filter((q) => q.id !== id)), 950);
  }, [cols]);

  /* ── firing ────────────────────────────────────────────────
     No global input lock. A tapped arrow leaves `alive` immediately so the
     next tap is judged against the new board, while the old one is still
     flying out. Taps never queue behind an animation. */
  const clean = mistakes === 0 && undosLeft === setup.undos;
  const stars = clean ? 3 : mistakes === 0 ? 2 : 1;

  const fire = useCallback(
    (piece) => {
      if (phase !== "playing" || !alive.has(piece.id)) return;
      setTaps((t) => t + 1);
      const blocker = blockerOf(piece);

      if (blocker !== null) {
        const now = Date.now();
        const repeat = lastMiss.current.id === piece.id && now - lastMiss.current.t < 1400;
        lastMiss.current = { id: piece.id, t: now };
        setBad({ id: piece.id, blocker, key: now });
        setTimeout(() => setBad((v) => (v && v.key === now ? null : v)), 640);

        // tapping the same blocked arrow again is the same mistake — don't charge twice
        if (repeat) {
          buzz(14);
          return;
        }

        buzz(38);
        setMistakes((m) => m + 1);
        setCombo(0);
        setFlow(0);
        if (shield) {
          setShield(false);
          Snd.shieldUsed();
          addPop(piece.cells[0], "shield used", C.flow);
          return;
        }
        Snd.blocked();
        if (!zen) {
          setHeartPop(true);
          setTimeout(() => setHeartPop(false), 430);
          const left = Math.max(hearts - 1, 0);
          setHearts(left);
          if (left === 0) setTimeout(() => { setPhase("gameover"); Snd.lose(); }, 520);
        }
        return;
      }

      buzz(10);
      lastMiss.current = { id: -1, t: 0 };

      const freed = countFreed(pieces, alive, piece.id, cols, rows);
      const nextCombo = combo + 1;
      const gain = (10 + freed * 15) * Math.min(nextCombo, 5);
      setCombo(nextCombo);
      Snd.depart(nextCombo);
      setScore((s) => s + gain);
      scoreLog.current.set(piece.id, gain);
      if (tut < 9) {
        tutClears.current++;
        if (tut === 0) setTutStep(1);
        else if (tut === 1 && tutClears.current >= 4) setTutStep(2);
        else if (tut === 2 && tutClears.current >= 8) setTutStep(9);
      }
      addPop(piece.cells[0], freed > 0 ? `+${gain}  frees ${freed}` : `+${gain}`, freed > 0 ? C.flow : C.accent);
      setRing({ cell: piece.cells[0], key: Date.now() });
      setTimeout(() => setRing((r) => (r && r.cell === piece.cells[0] ? null : r)), 470);

      const nextFlow = flow + 14 + freed * 6;
      const earnsShield = nextFlow >= 100 && !shield;
      setFlow(earnsShield ? 0 : Math.min(nextFlow, 100));
      if (earnsShield) {
        setShield(true);
        Snd.shieldUp();
        buzz(20);
      }

      // logical removal is instant; the visual keeps flying for a moment
      const key = Date.now() + piece.id;
      setFlying((f) => new Map(f).set(piece.id, key));
      setTimeout(() => setFlying((f) => { const m = new Map(f); if (m.get(piece.id) === key) m.delete(piece.id); return m; }), 280);
      setHistory((h) => [...h, piece.id]);

      const willClear = alive.size === 1 && alive.has(piece.id);
      setAlive((prev) => {
        const next = new Set(prev);
        next.delete(piece.id);
        return next;
      });

      if (willClear) {
        setTimeout(() => {
          setPhase("cleared");
          Snd.win();
          /* Bronze = cleared. Silver = no mistakes. Gold = flawless (no
             mistakes and no undo) on Hard or above. Gold is meant to
             be genuinely hard to earn. */
          /* running totals, then the badges and sticker they unlock */
          const nextStats = {
            arrows: stats.arrows + pieces.length,
            flawRun: mistakes === 0 ? stats.flawRun + 1 : 0,
            noUndo: undosLeft === setup.undos ? stats.noUndo + 1 : stats.noUndo,
            bestChain: Math.max(stats.bestChain, nextCombo),
          };

          const won = new Set(badges);
          won.add("first");
          if (nextStats.flawRun >= 5) won.add("flaw5");
          if (mode === "daily" && streak + 1 >= 7) won.add("streak7");
          if (mode === "journey" && tierIndex >= 9) won.add("hard");
          if (mode === "journey" && tierIndex >= 15) won.add("pro");
          if (nextStats.arrows >= 1000) won.add("k1");
          if (nextStats.bestChain >= 12) won.add("chain12");
          if (nextStats.noUndo >= 20) won.add("purist");
          if (mode === "custom") won.add("maker");

          let nextStickers = stickers;
          if (mode === "journey" && level % CHAPTER_LEN === 0 && !stickers.includes(chapterOf(level))) {
            nextStickers = [...stickers, chapterOf(level)];
          }

          setStats(nextStats);
          setStickers(nextStickers);

          const earned =
            mistakes === 0 && undosLeft === setup.undos && tierIndex >= 9
              ? 3
              : mistakes === 0
              ? 2
              : 1;
          if (mask.procedural) {
            const at = found.findIndex((f) => f.n === mask.name);
            let nf = found;
            if (at >= 0) {
              if ((found[at].r ?? 1) < earned) nf = found.map((f, k) => (k === at ? { ...f, r: earned } : f));
            } else {
              nf = [{ n: mask.name, c: encodeMask(mask.cols, mask.rows, mask.cells), r: earned }, ...found].slice(0, 160);
            }
            if (nf !== found) {
              setFound(nf);
              persist({ found: nf });
            }
            if (earned === 3) won.add("gold");
          } else if (COLLECTABLE.includes(mask.name)) {
            if (earned === 3) won.add("gold");
            if ((ranks[mask.name] ?? 0) < earned) {
              const nr = { ...ranks, [mask.name]: earned };
              setRanks(nr);
              persist({ ranks: nr });
            }
          }

          setBadges([...won]);
          persist({ badges: [...won], stats: nextStats, stickers: nextStickers });

          const bonus = 120 + (mistakes === 0 ? 200 : 0);
          const finalScore = score + gain + bonus;
          setScore(finalScore);
          if (finalScore > bestScore) {
            setBestScore(finalScore);
            persist({ bestScore: finalScore });
          }
          if (mode === "custom") {
            /* a drawn board is a one-off — leave journey progress alone */
          } else if (mode === "daily") {
            setStreak((st) => {
              const ns = dailyDone ? st : st + 1;
              persist({ streak: ns, lastDaily: todayKey() });
              return ns;
            });
            setDailyDone(true);
          } else {
            const bl = Math.max(best, level + 1);
            setBest(bl);
            persist({ level: level + 1, best: bl });
          }
        }, 340);
      }
    },
    [phase, alive, blockerOf, pieces, cols, rows, combo, shield, flow, hearts, zen, mode, dailyDone, best, bestScore, score, level,
     mistakes, mask.name, mask.procedural, mask.cols, mask.rows, mask.cells, persist, addPop,
     stats, badges, stickers, levelStars, streak, tierIndex, undosLeft, setup.undos, found, ranks, tut, setTutStep, stars]
  );

  /* Tap fires. Hold traces the arrow's route so you can see where it is aimed —
     it does not tell you whether the way is clear; that is the puzzle. */
  const onPieceDown = useCallback(
    (piece) => (e) => {
      if (phase !== "playing") return;
      e.preventDefault();
      const timer = setTimeout(() => {
        if (!press.current) return;
        press.current.held = true;
        setHoldId(piece.id);
        buzz(6);
        if (tut === 2) setTutStep(9);
      }, 180);
      press.current = { piece, timer, held: false };
    },
    [phase, tut, setTutStep]
  );

  // lock the document while a board is on screen — otherwise the page itself
  // scrolls and the browser swallows the pinch
  useEffect(() => {
    if (screen !== "play") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const el = viewport.current;
    const block = (e) => { if (e.touches && e.touches.length >= 2) e.preventDefault(); };
    el?.addEventListener("touchmove", block, { passive: false });
    el?.addEventListener("touchstart", block, { passive: false });
    return () => {
      document.body.style.overflow = prev;
      el?.removeEventListener("touchmove", block);
      el?.removeEventListener("touchstart", block);
    };
  }, [screen]);

  useEffect(() => {
    const up = () => {
      const p = press.current;
      if (!p) return;
      clearTimeout(p.timer);
      press.current = null;
      if (p.held) setHoldId(null);   // looked, didn't commit
      else fire(p.piece);
    };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [fire]);

  /* ── zoom & pan ──────────────────────────────────────────────
     viewRef mirrors view so gesture maths never reads a stale render. */
  const viewRef = useRef({ scale: 1, tx: 0, ty: 0 });

  const clampView = useCallback((v) => {
    const el = viewport.current;
    const s = Math.min(Math.max(v.scale, 1), 4);
    if (!el) return { scale: s, tx: 0, ty: 0 };
    const w = el.clientWidth || 1;
    const h = el.clientHeight || 1;
    return {
      scale: s,
      tx: Math.min(0, Math.max(w * (1 - s), v.tx)),
      ty: Math.min(0, Math.max(h * (1 - s), v.ty)),
    };
  }, []);

  const applyView = useCallback(
    (v) => {
      const c = clampView(v);
      viewRef.current = c;
      setView(c);
    },
    [clampView]
  );

  const cancelPress = () => {
    if (press.current) {
      clearTimeout(press.current.timer);
      press.current = null;
    }
  };

  const local = (e) => {
    const el = viewport.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const beginPinch = () => {
    const [a, b] = [...ptrs.current.values()];
    gest.current = {
      mode: "pinch",
      dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      start: { ...viewRef.current },
    };
  };

  const onViewDown = (e) => {
    const el = viewport.current;
    if (!el) return;
    Snd.unlock();
    if (musicOn) Snd.setMusic(true);
    try {
      el.setPointerCapture(e.pointerId);
    } catch {}
    ptrs.current.set(e.pointerId, local(e));
    setSnap(false);

    if (ptrs.current.size >= 2) {
      cancelPress();
      beginPinch();
    } else {
      gest.current = { mode: "maybe", id: e.pointerId, from: local(e), start: { ...viewRef.current } };
    }
  };

  const onViewMove = (e) => {
    if (!ptrs.current.has(e.pointerId)) return;
    ptrs.current.set(e.pointerId, local(e));
    const g = gest.current;
    if (!g) return;

    if (g.mode === "pinch") {
      if (ptrs.current.size < 2) return;
      const [a, b] = [...ptrs.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const s = Math.min(Math.max((g.start.scale * dist) / g.dist, 1), 4);
      const k = s / g.start.scale;
      applyView({
        scale: s,
        tx: g.mid.x - (g.mid.x - g.start.tx) * k + (mid.x - g.mid.x),
        ty: g.mid.y - (g.mid.y - g.start.ty) * k + (mid.y - g.mid.y),
      });
      return;
    }

    const p = ptrs.current.get(g.id);
    if (!p) return;
    const dx = p.x - g.from.x;
    const dy = p.y - g.from.y;

    if (g.mode === "maybe") {
      if (g.start.scale <= 1.005) return; // nothing to pan at fit size
      if (Math.hypot(dx, dy) < 10) return; // let genuine taps through
      g.mode = "pan";
      cancelPress();
    }
    if (g.mode === "pan") {
      applyView({ scale: g.start.scale, tx: g.start.tx + dx, ty: g.start.ty + dy });
    }
  };

  const onViewUp = (e) => {
    try {
      viewport.current?.releasePointerCapture(e.pointerId);
    } catch {}
    ptrs.current.delete(e.pointerId);

    if (ptrs.current.size === 0) {
      gest.current = null;
    } else if (ptrs.current.size === 1) {
      // a finger lifted mid-pinch — hand over to panning instead of freezing
      const [id] = [...ptrs.current.keys()];
      gest.current = { mode: "pan", id, from: ptrs.current.get(id), start: { ...viewRef.current } };
    } else {
      beginPinch();
    }
  };

  /* button zoom — a guaranteed path even where pinch gets swallowed */
  const zoomBy = useCallback(
    (f) => {
      const el = viewport.current;
      if (!el) return;
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      const v = viewRef.current;
      const s = Math.min(Math.max(v.scale * f, 1), 4);
      if (s === v.scale) return;
      const k = s / v.scale;
      setSnap(true);
      applyView({ scale: s, tx: w / 2 - (w / 2 - v.tx) * k, ty: h / 2 - (h / 2 - v.ty) * k });
      setTimeout(() => setSnap(false), 280);
    },
    [applyView]
  );

  /* Pinch can be swallowed by the browser on some phones, so the button walks
     through the same zoom levels and panning unlocks the moment it passes 1x. */
  const cycleZoom = useCallback(() => {
    const cur = viewRef.current.scale;
    const target = cur < 1.5 ? 2 : cur < 2.5 ? 3 : 1;
    const el = viewport.current;
    if (!el) return;
    const w = el.clientWidth || 1;
    const h = el.clientHeight || 1;
    setSnap(true);
    if (target === 1) {
      viewRef.current = { scale: 1, tx: 0, ty: 0 };
      setView({ scale: 1, tx: 0, ty: 0 });
    } else {
      const k = target / cur;
      const v = viewRef.current;
      applyView({ scale: target, tx: w / 2 - (w / 2 - v.tx) * k, ty: h / 2 - (h / 2 - v.ty) * k });
    }
    setTimeout(() => setSnap(false), 280);
  }, [applyView]);

  const resetView = useCallback(() => {
    setSnap(true);
    viewRef.current = { scale: 1, tx: 0, ty: 0 };
    setView({ scale: 1, tx: 0, ty: 0 });
    setTimeout(() => setSnap(false), 280);
  }, []);

  /* ── helpers ── */
  const undo = useCallback(() => {
    if (undosLeft <= 0 || phase !== "playing" || !history.length) return;
    const last = history[history.length - 1];
    setScore((v) => Math.max(0, v - (scoreLog.current.get(last) ?? 0)));
    scoreLog.current.delete(last);
    setHistory((h) => h.slice(0, -1));
    setFlying((f) => { const m = new Map(f); m.delete(last); return m; });
    setAlive((prev) => new Set([...prev, last]));
    setUndosLeft((u) => u - 1);
    setCombo(0);
    Snd.undo();
    buzz(8);
  }, [undosLeft, phase, history]);

  const useHint = useCallback(() => {
    if (hintsLeft <= 0 || phase !== "playing") return;
    let p = null;
    let bestFreed = -1;
    for (const x of pieces) {
      if (!alive.has(x.id) || blockerOf(x) !== null) continue;
      const f = countFreed(pieces, alive, x.id, cols, rows);
      if (f > bestFreed) { bestFreed = f; p = x; }
    }
    if (!p) return;
    setHintsLeft((h) => h - 1);
    setHintId(p.id);
    setTimeout(() => setHintId(null), 1900);
  }, [hintsLeft, phase, pieces, alive, blockerOf, cols, rows]);

  const allRanks = useMemo(() => [...Object.values(ranks), ...found.map((f) => f.r ?? 1)], [ranks, found]);
  const goldCount = allRanks.filter((r) => r === 3).length;
  const silverCount = allRanks.filter((r) => r === 2).length;
  const bronzeCount = allRanks.filter((r) => r === 1).length;

  const confetti = useMemo(
    () =>
      Array.from({ length: 24 }).map(() => ({
        left: Math.random() * 100,
        delay: Math.random() * 900,
        dur: 1600 + Math.random() * 1400,
        hue: ["#FF7A9C", "#7CE0C8", "#FFD166", "#8FB8FF", "#C4A5FF"][(Math.random() * 5) | 0],
        rot: Math.random() * 360,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [phase === "cleared"]
  );

  /* ═══════════  PLAY SCREEN — full bleed, like a real puzzle app  ═══════════ */
  if (screen === "play") {
    return (
      <div style={S.playRoot}>
        <style>{CSS}</style>

        <div style={S.hud} className="hud-in">
          <button style={S.hudBtn} onClick={() => setScreen("home")} aria-label="Back">
            <ChevLeft />
          </button>
          <button style={S.hudBtn} onClick={restart} aria-label="Restart">
            <Refresh />
          </button>

          <div style={S.hudMid}>
            <div style={{ ...S.diffLabel, color: mode === "journey" ? TIER_HUE[tierIndex] : C.accent }}>
              {mode === "custom" ? "Your board" : mode === "daily" ? "Daily" : tier.name}
              <span style={S.leftCount}> · {alive.size} left</span>
            </div>
            <div style={S.hudHearts}>
              {shield && <span style={S.shieldTag}>🛡</span>}
              {zen ? (
                <>
                  <span style={S.zenInf}>∞</span>
                  <span style={S.zenTag}>ZEN</span>
                </>
              ) : (
                Array.from({ length: maxHearts }).map((_, i) => (
                  <span key={i} className={heartPop && i === hearts ? "hbreak" : ""} style={S.inl}>
                    <Heart on={i < hearts} />
                  </span>
                ))
              )}
            </div>
          </div>

          <button
            style={{ ...S.hintPill, opacity: hintsLeft > 0 || !adsRemoved ? 1 : 0.4 }}
            onClick={hintsLeft > 0 ? useHint : watchForHint}
            disabled={hintsLeft <= 0 && adsRemoved}
          >
            <Bulb />
            <span style={S.hintTxt}>{hintsLeft > 0 ? hintsLeft : "▶"}</span>
          </button>
        </div>

        {tut < 9 && mode === "journey" && (
          <div style={S.tutBar} className="ovin">
            <span style={S.tutStep}>{tut + 1}/3</span>
            <span style={S.tutText}>
              {tut === 0
                ? "Tap an arrow to send it off the board."
                : tut === 1
                ? "An arrow only leaves if its path is clear all the way out — tapping a blocked one costs a life."
                : "Hold an arrow to trace where it is aimed. Tap # to trace them all."}
            </span>
            <button style={S.tutSkip} onClick={() => setTutStep(9)}>Skip</button>
          </div>
        )}

        {tut >= 9 && !coachSeen && (
          <button
            style={S.coach}
            className="ovin"
            onClick={() => { setCoachSeen(true); persist({ coachSeen: true }); }}
          >
            <span style={S.coachText}>
              Tap <b>#</b> to trace where every arrow is headed
            </span>
            <span style={S.coachX}>✕</span>
          </button>
        )}

        <div style={S.topTrack}>
          <div style={{ ...S.topFill, width: `${progress}%` }} />
        </div>

        <div
          ref={viewport}
          style={S.playViewport}
          onPointerDown={onViewDown}
          onPointerMove={onViewMove}
          onPointerUp={onViewUp}
          onPointerCancel={onViewUp}
        >
          <div
            style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`, transformOrigin: "0 0", transition: snap ? "transform 240ms cubic-bezier(.4,0,.2,1)" : "none", width: "100%", height: "100%", touchAction: "none" }}
          >
            <svg
              key={levelKey}
              className="board-in"
              viewBox={`${-VIEW_PAD * U} ${-VIEW_PAD * U} ${(cols + VIEW_PAD * 2) * U} ${(rows + VIEW_PAD * 2) * U}`}
              style={S.svgFill}
              aria-label={`${mask.name} arrow puzzle`}
            >
              {grid &&
                pieces.map((p) => {
                  if (!alive.has(p.id)) return null;
                  const h = p.cells[0];
                  const D = DIRS[p.dir];
                  const far = (cols + rows + DOT_PAD * 2) * U;
                  return (
                    <line
                      key={`ln${p.id}`}
                      x1={cx(h, cols)}
                      y1={cy(h, cols)}
                      x2={cx(h, cols) + D.dx * far}
                      y2={cy(h, cols) + D.dy * far}
                      stroke={toneFor(p.dir, theme)}
                      strokeWidth={4.5}
                      opacity={0.3}
                    />
                  );
                })}

              {/* dot field across the whole surface, not just the shape */}
              {Array.from({ length: (cols + DOT_PAD * 2) * (rows + DOT_PAD * 2) }).map((_, k) => {
                const gx = (k % (cols + DOT_PAD * 2)) - DOT_PAD;
                const gy = Math.floor(k / (cols + DOT_PAD * 2)) - DOT_PAD;
                const inMask = gx >= 0 && gy >= 0 && gx < cols && gy < rows && mask.cells.has(gy * cols + gx);
                return (
                  <circle
                    key={`d${k}`}
                    cx={gx * U + U / 2}
                    cy={gy * U + U / 2}
                    r={inMask ? 3.8 : 3}
                    fill={C.dot}
                    opacity={inMask ? 1 : 0.55}
                  />
                );
              })}


              {holdId !== null && alive.has(holdId) && (() => {
                const hp = pieces[holdId];
                const h = hp.cells[0];
                const D = DIRS[hp.dir];
                const far = (cols + rows + DOT_PAD * 2) * U;
                return (
                  <line
                    x1={cx(h, cols)}
                    y1={cy(h, cols)}
                    x2={cx(h, cols) + D.dx * far}
                    y2={cy(h, cols) + D.dy * far}
                    stroke={toneFor(hp.dir, theme)}
                    strokeWidth={16}
                    strokeLinecap="round"
                    opacity={0.28}
                  />
                );
              })()}

              {pieces.map((p, idx) => {
                if (!alive.has(p.id)) return null;
                const isBad = bad?.id === p.id;
                const isBlk = bad?.blocker === p.id;
                const isHint = hintId === p.id;
                const isHeld = holdId === p.id;
                const tone = isBad || isBlk ? C.danger : isHint || isHeld ? C.accent : toneFor(p.dir, theme);
                const cls = isBad ? "shake" : isBlk ? "flash" : isHint ? "hint" : "settle";
                return (
                  <Piece
                    key={`${levelKey}-${p.id}`}
                    piece={p}
                    cols={cols}
                    tone={tone}
                    width={W_BOARD}
                    hit={bigTouch ? 78 : 52}
                    className={cls}
                    style={{ "--d": `${Math.min(idx, 11) * 14}ms` }}
                    onDown={onPieceDown(p)}
                  />
                );
              })}

              {[...flying.entries()].map(([id, key]) => (
                <DepartingPiece key={`f${key}`} piece={pieces[id]} cols={cols} rows={rows} tone={C.accent} />
              ))}

              {ring && (
                <circle
                  key={ring.key}
                  className="ring"
                  cx={cx(ring.cell, cols)}
                  cy={cy(ring.cell, cols)}
                  r={cols * 5.5}
                  fill="none"
                  stroke={C.accent}
                  strokeWidth={cols * 0.9}
                />
              )}


              {pops.map((q) => (
                <text
                  key={q.id}
                  className="pop"
                  x={q.x}
                  y={q.y}
                  fill={q.hue}
                  fontSize={cols * 3.6}
                  fontWeight={800}
                  textAnchor="middle"
                  style={{ fontFamily: "Nunito, sans-serif", "--rise": `${cols * 7}px` }}
                >
                  {q.text}
                </text>
              ))}

            </svg>
          </div>
        </div>

        <button style={S.gridToggle} onClick={() => { setGrid((g) => !g); persist({ grid: !grid }); }} aria-label="Toggle grid">
          <Hash on={grid} />
        </button>

        <div style={S.playFoot}>
          <button style={{ ...S.footBtn, opacity: undosLeft > 0 && history.length ? 1 : 0.35 }} onClick={undo} disabled={undosLeft <= 0 || !history.length}>
            <Undo />
            <span style={S.footNum}>{undosLeft}</span>
          </button>
          <div style={S.scorePill}>{score.toLocaleString()}</div>
          <button style={S.footBtn} onClick={cycleZoom}>
            <Magnifier zoomed={view.scale > 1.01} />
            {view.scale > 1.01 && <span style={S.footNum}>{Math.round(view.scale)}×</span>}
          </button>
        </div>

        {phase === "gameover" && (
          <div style={S.overlay} className="ovin">
            <div style={S.ovCard}>
              <div style={{ ...S.ovTitle, color: C.danger }}>Out of lives</div>
              <div style={S.ovSub}>Tip: hold an arrow to see where it is aimed, or tap # for all of them.</div>
              {!adsRemoved && (
                <button style={S.adBtn} onClick={watchForLife}>
                  <span style={S.adPlay}>▶</span> Watch an ad · get a life back
                </button>
              )}
              {adNote && <div style={S.adNote}>{adNote}</div>}
              <button style={S.primary} onClick={restart}>
                Try again
              </button>
              <button style={S.ghost} onClick={() => { setZen(true); persist({ zen: true }); restart(); }}>
                Switch to Zen mode
              </button>
            </div>
          </div>
        )}

        {phase === "cleared" && (
        <div style={S.winWrap} className="ovin" onClick={nextLevel}>
          {confetti.map((c, i) => (
            <span key={i} className="confetti" style={{ left: `${c.left}%`, background: c.hue, animationDelay: `${c.delay}ms`, animationDuration: `${c.dur}ms`, transform: `rotate(${c.rot}deg)` }} />
          ))}
          <div style={S.winInner}>
            <div style={S.winKicker}>{mode === "daily" ? `Daily streak · ${streak} 🔥` : `${score.toLocaleString()} points`}</div>
            <div style={S.winTitle}>{clean ? "Flawless!" : "Level Completed!"}</div>

            <div style={S.winCard}>
              <svg viewBox={`0 0 ${cols * U} ${rows * U}`} style={{ width: "100%", height: "auto" }}>
                {pieces.map((p) => (
                  <Piece key={p.id} piece={p} cols={cols} tone={toneFor(p.dir, theme)} width={W_MINI} />
                ))}
              </svg>
            </div>

            <div style={S.winStars}>
              {[0, 1, 2].map((i) => (
                <span key={i} className="starpop" style={{ animationDelay: `${i * 120}ms`, ...S.inl }}>
                  <Star on={i < stars} />
                </span>
              ))}
            </div>
            <div style={S.winMeta}>
              {taps} taps · {mistakes === 0 ? "no mistakes" : `${mistakes} mistake${mistakes > 1 ? "s" : ""}`}
            </div>

            <button style={S.winBtn} onClick={(e) => { e.stopPropagation(); nextLevel(); }}>
              {mode === "journey" ? "Next Level" : "Back to Journey"}
            </button>
            <button style={S.winGhost} onClick={(e) => { e.stopPropagation(); restart(); }}>
              Replay for a better score
            </button>
          </div>
        </div>
        )}
      </div>
    );
  }

  /* ═══════════  SHELL SCREENS  ═══════════ */
  return (
    <div style={S.page}>
      <style>{CSS}</style>

      <div style={S.shellBody}>
        {screen === "home" && (
          <div style={S.home} className="screen-in">
            <div style={S.streakChip}>🔥 {streak}</div>

            <div style={S.homeCards}>
              <button style={{ ...S.homeCard, animationDelay: "40ms" }} className="card-in" onClick={() => { startDaily(); setScreen("play"); }}>
                <div style={S.homeCardTitle}>Daily</div>
                <div style={S.homeCardSub}>{todayKey().slice(5).replace("-", " / ")}</div>
                <div style={S.homeCardArt}>
                  <MiniShape shapeKey="catArt" />
                </div>
                <div style={S.homeCardBtn}>{dailyDone ? "Replay" : "Play"}</div>
              </button>

              <button style={{ ...S.homeCard, animationDelay: "110ms" }} className="card-in" onClick={() => setScreen("studio")}>
                <div style={S.homeCardTitle}>Studio</div>
                <div style={S.homeCardSub}>Draw & share</div>
                <div style={S.homeCardArt}>
                  <MiniShape shapeKey="rocketArt" />
                </div>
                <div style={S.homeCardBtn}>Open</div>
              </button>
            </div>

            <div style={{ ...S.chapterCard, animationDelay: "150ms" }} className="card-in">
              {(() => {
                const ci = chapterInfo(chapterOf(best));
                const done = best - ci.from;
                const pct = Math.min(100, (done / CHAPTER_LEN) * 100);
                return (
                  <>
                    <div style={S.chapRow}>
                      <div style={{ ...S.chapBadge, background: ci.hue }}>{ci.ch}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={S.chapName}>{ci.name}</div>
                        <div style={S.chapSub}>
                          Levels {ci.from}–{ci.to} · {done} of {CHAPTER_LEN}
                        </div>
                      </div>
                      <div style={{ ...S.chapSticker, opacity: stickers.includes(ci.ch) ? 1 : 0.28 }}>
                        {ci.mask && <MaskIcon mask={ci.mask} colour={ci.hue} size={38} />}
                      </div>
                    </div>
                    <div style={S.chapTrack}>
                      <div style={{ ...S.chapFill, width: `${pct}%`, background: ci.hue }} />
                    </div>
                    <div style={S.chapHint}>
                      {stickers.includes(ci.ch) ? "Sticker earned" : "Finish the chapter to earn this sticker"}
                    </div>
                  </>
                );
              })()}
            </div>

            <div style={{ ...S.brandWrap, animationDelay: "170ms" }} className="card-in">
              <div style={S.brand}>Arrow Escape</div>
              <div style={S.homeLevel}>Level {best}</div>
              <div style={{ ...S.homeDiff, color: TIER_HUE[tierFor(best).index] }}>{tierFor(best).tier.name}</div>
            </div>

            <button style={{ ...S.continueBtn, animationDelay: "230ms" }} className="card-in" onClick={() => { startJourney(best); setScreen("play"); }}>
              Continue
            </button>
            <div style={S.homeFoot}>Best {bestScore.toLocaleString()} · level {best}</div>
          </div>
        )}

        {screen === "levels" && (
          <div style={S.settings} className="screen-in">
            <div style={S.colTitle}>Levels</div>
            <div style={S.lvNote}>
              Every level stays open. Go back for the stars you missed — three needs a
              flawless run.
            </div>
            {(() => {
              const chapters = [];
              for (let ch = 1; ch <= chapterOf(best); ch++) chapters.push(ch);
              return chapters.reverse().map((ch) => {
                const ci = chapterInfo(ch);
                const from = ci.from;
                const to = Math.min(ci.to, best);
                const nums = [];
                for (let n = from; n <= to; n++) nums.push(n);
                const got = nums.reduce((a, n) => a + (levelStars[n] ?? 0), 0);
                return (
                  <div key={ch} style={S.lvChapter}>
                    <div style={S.lvHead}>
                      <span style={{ ...S.chapBadge, background: ci.hue }}>{ch}</span>
                      <span style={S.lvChapName}>{ci.name}</span>
                      <span style={S.lvChapStars}>{got}/{nums.length * 3} ★</span>
                    </div>
                    <div style={S.lvGrid}>
                      {nums.map((n) => {
                        const st = levelStars[n] ?? 0;
                        return (
                          <button
                            key={n}
                            style={{ ...S.lvCell, borderColor: st ? ci.hue : "transparent" }}
                            onClick={() => { startJourney(n); setScreen("play"); }}
                          >
                            <span style={S.lvNum}>{n}</span>
                            <span style={S.lvStars}>{st ? "★".repeat(st) : "·"}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        )}

        {screen === "collection" && <div style={S.settings} className="screen-in">
          <div style={S.colTitle}>Collection</div>
          <div style={S.rankBar}>
            {[
              [3, "Gold", goldCount],
              [2, "Silver", silverCount],
              [1, "Bronze", bronzeCount],
            ].map(([r, label, n]) => (
              <div key={label} style={S.rankChip}>
                <span style={{ ...S.rankDot, background: MEDAL[r] }} />
                <span style={S.rankNum}>{n}</span>
                <span style={S.rankLbl}>{label}</span>
              </div>
            ))}
          </div>
          <div style={S.colGrid}>
            {COLLECTABLE.map((n) => {
              const r = ranks[n] ?? 0;
              return (
                <div key={n} style={{ ...S.colItem, opacity: r ? 1 : 0.45, border: `2px solid ${r ? MEDAL[r] : "transparent"}` }}>
                  <ShapeThumb shapeKey={THUMB[n]} on={!!r} />
                  <span style={S.colName}>{r ? n : "???"}</span>
                  <span style={{ ...S.rankTag, color: r ? MEDAL[r] : C.muted }}>
                    {r === 3 ? "GOLD" : r === 2 ? "SILVER" : r === 1 ? "BRONZE" : "LOCKED"}
                  </span>
                </div>
              );
            })}
          </div>
          {found.length > 0 && (
            <>
              <div style={{ ...S.colTitle, marginTop: 16 }}>Discovered shapes</div>
              <div style={S.foundGrid}>
                {found.map((f) => {
                  const m = decodeMask(f.c);
                  if (!m) return null;
                  return (
                    <div key={f.n} style={{ ...S.foundItem, border: `2px solid ${MEDAL[f.r ?? 1]}` }}>
                      <svg viewBox={`0 0 ${m.cols} ${m.rows}`} style={{ width: 38, height: 38 }}>
                        {[...m.cells].map((i) => (
                          <rect key={i} x={(i % m.cols) + 0.14} y={((i / m.cols) | 0) + 0.14}
                                width={0.72} height={0.72} rx={0.2} fill={C.accent} />
                        ))}
                      </svg>
                      <span style={S.foundName}>{f.n}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
          <div style={{ ...S.colTitle, marginTop: 18 }}>
            Stickers · {stickers.length}
          </div>
          {stickers.length === 0 ? (
            <div style={S.emptyNote}>Finish a chapter of 25 levels to earn your first sticker.</div>
          ) : (
            <div style={S.stickerGrid}>
              {stickers.slice().reverse().map((ch) => {
                const ci = chapterInfo(ch);
                return (
                  <div key={ch} style={{ ...S.stickerItem, borderColor: ci.hue }}>
                    {ci.mask && <MaskIcon mask={ci.mask} colour={ci.hue} size={40} />}
                    <span style={S.stickerName}>{ci.name}</span>
                    <span style={S.stickerCh}>Ch {ch}</span>
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ ...S.colTitle, marginTop: 18 }}>
            Badges · {badges.length}/{BADGES.length}
          </div>
          <div style={S.badgeList}>
            {BADGES.map((b) => {
              const on = badges.includes(b.id);
              return (
                <div key={b.id} style={{ ...S.badgeRow, opacity: on ? 1 : 0.42 }}>
                  <span style={{ ...S.badgeDot, background: on ? C.gold : C.line }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={S.badgeName}>{b.name}</span>
                    <span style={S.badgeNeed}>{b.need}</span>
                  </span>
                  {on && <span style={S.badgeTick}>✓</span>}
                </div>
              );
            })}
          </div>

          <div style={S.tip}>
            <b>Bronze</b> — clear the shape. <b>Silver</b> — clear it without a single mistake.
            <b> Gold</b> — flawless at Hard or beyond: no mistakes and no undo.
            <br />
            Past level {CURATED_UNTIL} the game keeps inventing new shapes, and every one you
            clear is kept here. There is no end to them.
          </div>
        </div>}

        {screen === "studio" && (
          <ShapeStudio
            onPlay={(m) => { startCustom(m); setScreen("play"); }}
            saved={customs}
            onSave={saveCustom}
            onDelete={deleteCustom}
          />
        )}

        {screen === "settings" && <div style={S.settings} className="screen-in">
          <Toggle label="Zen mode" hint="No lives, no losing — just solve" on={zen} onChange={(v) => { setZen(v); persist({ zen: v }); }} />
          <Toggle label="Large touch targets" hint="Easier to hit the arrow you mean" on={bigTouch} onChange={(v) => { setBigTouch(v); persist({ bigTouch: v }); }} />
          <Toggle label="Vibration" hint="Buzz on taps and mistakes" on={haptics} onChange={(v) => { setHaptics(v); persist({ haptics: v }); }} />
          <Toggle label="Sound effects" hint="Chain pitch rises as you build a streak" on={sfxOn} onChange={(v) => { Snd.unlock(); setSfxOn(v); persist({ sfx: v }); }} />
          <Toggle label="Music" hint="Slow ambient pads, quiet by design" on={musicOn} onChange={(v) => { Snd.unlock(); setMusicOn(v); persist({ music: v }); }} />
          <div style={S.themeRow}>
            <span style={S.tglLabel}>Arrow colours</span>
            <div style={{ display: "flex", gap: 7 }}>
              {PALETTE_KEYS.map((k) => (
                <button
                  key={k}
                  onClick={() => { setTheme(k); persist({ theme: k }); }}
                  aria-label={PALETTES[k].name}
                  style={{ ...S.swatch, borderColor: theme === k ? C.accent : "transparent" }}
                >
                  {["right", "left", "up", "down"].map((d) => (
                    <span key={d} style={{ ...S.swatchDot, background: toneFor(d, k) }} />
                  ))}
                </button>
              ))}
            </div>
          </div>
          {!adsRemoved && (
            <div style={S.buyRow}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={S.buyName}>Remove ads</span>
                <span style={S.buyHint}>No ads between levels. Reward videos stay available.</span>
              </div>
              <button
                style={S.buyBtn}
                onClick={async () => {
                  const ok = await Ads.buyRemoveAds();
                  if (ok) { setAdsRemoved(true); persist({ adsRemoved: true }); }
                  else flashNote("Purchases aren't set up yet.");
                }}
              >
                Buy
              </button>
            </div>
          )}
          {adsRemoved && <div style={S.buyDone}>Ads removed — thank you.</div>}
          <button
            style={S.restoreBtn}
            onClick={async () => {
              const ok = await Ads.restore();
              if (ok) { setAdsRemoved(true); persist({ adsRemoved: true }); flashNote("Purchase restored."); }
              else flashNote("Nothing to restore.");
            }}
          >
            Restore purchases
          </button>
          {adNote && <div style={S.adNote}>{adNote}</div>}

          <div style={S.themeRow}>
            <span style={S.tglLabel}>Board theme</span>
            <div style={{ display: "flex", gap: 10 }}>
              {[false, true].map((d) => (
                <button
                  key={String(d)}
                  onClick={() => { setDark(d); persist({ dark: d }); }}
                  style={{ ...S.themeTile, borderColor: dark === d ? C.accent : "transparent" }}
                >
                  <ThemePreview dark={d} />
                  <span style={S.themeName}>{d ? "High contrast" : "Default"}</span>
                </button>
              ))}
            </div>
          </div>
          <div style={S.tip}>
            <b>Hold</b> an arrow to trace its route — it will not tell you whether the way is clear. Tap <b>#</b> to trace them all. <b>Pinch</b> to zoom.
            <br />
            Clearing an arrow that <b>frees others</b> scores far more. Find the order that unlocks the most.
          </div>
        </div>}
      </div>

      <div style={S.nav}>
        {[
          ["home", "Home", <HomeIcon />],
          ["levels", "Levels", <Grid />],
          ["studio", "Studio", <Pencil />],
          ["collection", "Collection", <Trophy />],
          ["settings", "Settings", <Gear />],
        ].map(([key, label, icon]) => (
          <button
            key={key}
            style={{ ...S.navBtn, ...(screen === key ? S.navOn : {}) }}
            onClick={() => setScreen(key)}
          >
            <span key={screen === key ? "on" : "off"} className={screen === key ? "nav-on" : ""} style={{ opacity: screen === key ? 1 : 0.55, display: "inline-flex" }}>{icon}</span>
            <span style={S.navLabel}>{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}


/* ═══════════  small components  ═══════════ */

function ShapeStudio({ onPlay, saved, onSave, onDelete }) {
  const N = 11;
  const [cells, setCells] = useState(new Set());
  const [codeIn, setCodeIn] = useState("");
  const [msg, setMsg] = useState("");
  const paint = useRef(null);

  const toggle = (i, mode) => {
    setCells((prev) => {
      const next = new Set(prev);
      if (mode === "add") next.add(i);
      else next.delete(i);
      return next;
    });
  };

  const down = (i) => (e) => {
    e.preventDefault();
    // release the implicit capture or the drag never reaches the next cell
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
    const mode = cells.has(i) ? "del" : "add";
    paint.current = mode;
    toggle(i, mode);
  };
  const over = (i) => () => paint.current && toggle(i, paint.current);

  useEffect(() => {
    const up = () => (paint.current = null);
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, []);

  const mirror = () =>
    setCells((prev) => {
      const next = new Set(prev);
      prev.forEach((i) => {
        const y = (i / N) | 0, x = i % N;
        if (x < Math.ceil(N / 2)) next.add(y * N + (N - 1 - x));
      });
      return next;
    });

  const build = () => {
    const t = tidyDrawing(N, N, cells);
    if (!t || t.cells.size < 24) {
      setMsg("Draw at least 24 squares");
      setTimeout(() => setMsg(""), 2200);
      return null;
    }
    return { ...t, name: "Your shape", custom: true };
  };

  const play = () => {
    const m = build();
    if (m) onPlay(m);
  };

  const save = () => {
    const m = build();
    if (!m) return;
    onSave(encodeMask(m.cols, m.rows, m.cells));
    setMsg("Saved");
    setTimeout(() => setMsg(""), 1600);
  };

  const copy = () => {
    const m = build();
    if (!m) return;
    const code = encodeMask(m.cols, m.rows, m.cells);
    try {
      navigator.clipboard.writeText(code);
      setMsg("Code copied");
    } catch {
      setMsg(code);
    }
    setTimeout(() => setMsg(""), 2600);
  };

  const openCode = () => {
    const m = decodeMask(codeIn);
    if (!m) {
      setMsg("That code doesn't look right");
      setTimeout(() => setMsg(""), 2200);
      return;
    }
    onPlay(m);
  };

  return (
    <div style={S.settings} className="screen-in">
      <div style={S.colTitle}>Draw a shape</div>
      <div style={S.studioGrid}>
        {Array.from({ length: N * N }).map((_, i) => (
          <button
            key={i}
            onPointerDown={down(i)}
            onPointerEnter={over(i)}
            style={{ ...S.studioCell, background: cells.has(i) ? C.accent : C.bg }}
            aria-label={`cell ${i}`}
          />
        ))}
      </div>

      <div style={S.studioRow}>
        <button style={S.chip} onClick={mirror}>Mirror</button>
        <button style={S.chip} onClick={() => setCells(new Set())}>Clear</button>
        <button style={S.chip} onClick={save}>Save</button>
        <button style={S.chip} onClick={copy}>Copy code</button>
      </div>

      <button style={{ ...S.primary, marginTop: 10 }} onClick={play}>Play this shape</button>

      {saved.length > 0 && (
        <>
          <div style={{ ...S.colTitle, marginTop: 16 }}>Your shapes</div>
          <div style={S.savedRow}>
            {saved.map((code) => {
              const m = decodeMask(code);
              if (!m) return null;
              return (
                <div key={code} style={S.savedItem}>
                  <button style={S.savedBtn} onClick={() => onPlay(m)} aria-label="Play saved shape">
                    <svg viewBox={`0 0 ${m.cols} ${m.rows}`} style={{ width: 44, height: 44 }}>
                      {[...m.cells].map((i) => (
                        <rect key={i} x={(i % m.cols) + 0.12} y={((i / m.cols) | 0) + 0.12}
                              width={0.76} height={0.76} rx={0.22} fill={C.accent} />
                      ))}
                    </svg>
                  </button>
                  <button style={S.savedX} onClick={() => onDelete(code)} aria-label="Delete">✕</button>
                </div>
              );
            })}
          </div>
        </>
      )}

      <div style={{ ...S.colTitle, marginTop: 16 }}>Play a shared code</div>
      <div style={S.studioRow}>
        <input
          value={codeIn}
          onChange={(e) => setCodeIn(e.target.value)}
          placeholder="paste a code"
          style={S.codeInput}
        />
        <button style={S.chip} onClick={openCode}>Open</button>
      </div>

      {msg && <div style={S.studioMsg}>{msg}</div>}
      <div style={S.tip}>
        Anything you draw becomes a real puzzle — the board is generated inside your
        shape and is always solvable. Send the code to a friend and they play the
        exact same board.
      </div>
    </div>
  );
}

function MaskIcon({ mask, colour, size = 40 }) {
  return (
    <svg viewBox={`0 0 ${mask.cols} ${mask.rows}`} style={{ width: size, height: size, display: "block" }}>
      {[...mask.cells].map((i) => (
        <rect key={i} x={(i % mask.cols) + 0.12} y={((i / mask.cols) | 0) + 0.12}
              width={0.76} height={0.76} rx={0.24} fill={colour} />
      ))}
    </svg>
  );
}

function ThemePreview({ dark }) {
  const cols = dark
    ? ["#4C8DFF", "#FF5C7A", "#A78BFA", "#FFC24B"]
    : ["#2F7BF6", "#FF4D6A", "#8B5CF6", "#F59E0B"];
  return (
    <svg viewBox="0 0 104 78" style={{ width: 66, height: 50, borderRadius: 9, background: dark ? "#080C1A" : "#FFFFFF", display: "block" }}>
      {Array.from({ length: 12 }).map((_, i) => {
        const x = 16 + (i % 4) * 24;
        const y = 18 + Math.floor(i / 4) * 21;
        const c = cols[i % 4];
        const rot = [0, 90, 180, 270][(i * 3) % 4];
        return (
          <g key={i} transform={`rotate(${rot} ${x} ${y})`}>
            <path d={`M ${x - 8} ${y} H ${x + 2}`} stroke={c} strokeWidth="3.2" strokeLinecap="round" />
            <path d={`M ${x - 1} ${y - 4} L ${x + 5} ${y} L ${x - 1} ${y + 4}`} stroke={c} strokeWidth="3.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        );
      })}
    </svg>
  );
}

function Toggle({ label, hint, on, onChange }) {
  return (
    <button style={S.tglRow} onClick={() => onChange(!on)}>
      <span>
        <span style={S.tglLabel}>{label}</span>
        <span style={S.tglHint}>{hint}</span>
      </span>
      <span style={{ ...S.tglTrack, background: on ? C.accent : C.line }}>
        <span style={{ ...S.tglKnob, transform: `translateX(${on ? 18 : 0}px)` }} />
      </span>
    </button>
  );
}

const Heart = ({ on }) => (
  <svg width="20" height="20" viewBox="0 0 24 24">
    <path d="M12 20.5l-1.5-1.36C5.4 14.5 2 11.42 2 7.7 2 4.92 4.2 2.8 6.9 2.8c1.55 0 3.05.73 4.1 1.95 1.05-1.22 2.55-1.95 4.1-1.95 2.7 0 4.9 2.12 4.9 4.9 0 3.72-3.4 6.8-8.5 11.44L12 20.5z" fill={on ? C.danger : "none"} stroke={on ? C.danger : C.line} strokeWidth="1.8" />
  </svg>
);
const Star = ({ on }) => (
  <svg width="30" height="30" viewBox="0 0 24 24">
    <path d="M12 2.6l2.9 5.88 6.5.95-4.7 4.58 1.11 6.46L12 17.42l-5.81 3.05 1.11-6.46-4.7-4.58 6.5-.95L12 2.6z" fill={on ? C.gold : "none"} stroke={on ? C.gold : "rgba(255,255,255,0.55)"} strokeWidth="1.6" strokeLinejoin="round" />
  </svg>
);
const Bulb = () => (
  <svg width="21" height="21" viewBox="0 0 24 24" fill="none">
    <path d="M9 18h6M10 21h4M12 3a6 6 0 00-3.5 10.9c.5.4.8 1 .8 1.6v.5h5.4v-.5c0-.6.3-1.2.8-1.6A6 6 0 0012 3z" stroke={C.accent} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const Undo = () => (
  <svg width="21" height="21" viewBox="0 0 24 24" fill="none">
    <path d="M4 9h11a5 5 0 010 10h-6M4 9l5-5M4 9l5 5" stroke={C.accent} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const Magnifier = ({ zoomed }) => (
  <svg width="21" height="21" viewBox="0 0 24 24" fill="none">
    <circle cx="10.5" cy="10.5" r="6.5" stroke={C.accent} strokeWidth="1.9" />
    <path d="M15.4 15.4L21 21" stroke={C.accent} strokeWidth="1.9" strokeLinecap="round" />
    <path d={zoomed ? "M7.6 10.5h5.8" : "M7.6 10.5h5.8M10.5 7.6v5.8"} stroke={C.accent} strokeWidth="1.9" strokeLinecap="round" />
  </svg>
);
const Refresh = () => (
  <svg width="21" height="21" viewBox="0 0 24 24" fill="none">
    <path d="M20 11a8 8 0 10-2.3 5.7M20 5v6h-6" stroke={C.accent} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const Gear = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="3.2" stroke={C.muted} strokeWidth="1.9" />
    <path d="M12 2.6v2.2M12 19.2v2.2M21.4 12h-2.2M4.8 12H2.6M18.6 5.4l-1.6 1.6M7 17l-1.6 1.6M18.6 18.6L17 17M7 7L5.4 5.4" stroke={C.muted} strokeWidth="1.9" strokeLinecap="round" />
  </svg>
);
const Speaker = ({ on }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
    <path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z" stroke={on ? C.accent : C.muted} strokeWidth="1.9" strokeLinejoin="round" />
    {on ? (
      <path d="M15.5 9.2a4 4 0 010 5.6M18 6.8a7.5 7.5 0 010 10.4" stroke={C.accent} strokeWidth="1.9" strokeLinecap="round" />
    ) : (
      <path d="M16 9.5l4.5 5M20.5 9.5l-4.5 5" stroke={C.muted} strokeWidth="1.9" strokeLinecap="round" />
    )}
  </svg>
);
const ChevLeft = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
    <path d="M15 5l-7 7 7 7" stroke={C.accent} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const Hash = ({ on }) => (
  <svg width="21" height="21" viewBox="0 0 24 24" fill="none">
    <path d="M9 3v18M15 3v18M3 9h18M3 15h18" stroke={on ? C.accent : C.muted} strokeWidth="2.1" strokeLinecap="round" />
  </svg>
);
const HomeIcon = () => (
  <svg width="21" height="21" viewBox="0 0 24 24" fill="none">
    <path d="M3.5 10.5L12 3.5l8.5 7M5.5 9.5V20h13V9.5" stroke={C.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
function MiniShape({ shapeKey }) {
  const m = parseMask(shapeKey);
  return (
    <svg viewBox={`0 0 ${m.cols} ${m.rows}`} style={{ width: "100%", height: "100%" }}>
      {[...m.cells].map((i) => (
        <rect key={i} x={(i % m.cols) + 0.14} y={((i / m.cols) | 0) + 0.14} width={0.72} height={0.72} rx={0.24} fill={C.accent} opacity={0.85} />
      ))}
    </svg>
  );
}
const Grid = () => (
  <svg width="21" height="21" viewBox="0 0 24 24" fill="none">
    <rect x="3.5" y="3.5" width="7" height="7" rx="2" stroke={C.accent} strokeWidth="1.9" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="2" stroke={C.accent} strokeWidth="1.9" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="2" stroke={C.accent} strokeWidth="1.9" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="2" stroke={C.accent} strokeWidth="1.9" />
  </svg>
);
const Pencil = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
    <path d="M4 20h4L19.5 8.5a2.5 2.5 0 00-3.5-3.5L4.5 16.5 4 20z" stroke={C.muted} strokeWidth="1.9" strokeLinejoin="round" />
    <path d="M14.5 6.5l3.5 3.5" stroke={C.muted} strokeWidth="1.9" strokeLinecap="round" />
  </svg>
);
const Trophy = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
    <path d="M7 4h10v5a5 5 0 01-10 0V4zM7 6H4v1a3 3 0 003 3M17 6h3v1a3 3 0 01-3 3M9 20h6M12 14v6" stroke={C.muted} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const TinyArrow = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
    <path d="M4 12h15M13 6l6 6-6 6" stroke={C.muted} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/* ═══════════  css  ═══════════ */

const makeCSS = (C) => `
@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@600;800;900&family=DM+Mono:wght@500&display=swap');
svg { shape-rendering: geometricPrecision; }
@keyframes settleIn{0%{opacity:0;transform:translateY(6px)}100%{opacity:1;transform:translateY(0)}}
.settle{animation:settleIn 165ms cubic-bezier(.2,.9,.3,1) backwards;animation-delay:var(--d,0ms)}
@keyframes snakeOut{to{stroke-dashoffset:var(--off)}}
.snake{animation:snakeOut 240ms cubic-bezier(.45,0,.7,.1) forwards;will-change:stroke-dashoffset}
@keyframes chevOut{to{transform:translate(var(--tx),var(--ty))}}
.chev-out{animation:chevOut 240ms cubic-bezier(.45,0,.7,.1) forwards;will-change:transform}
@keyframes depFade{0%,72%{opacity:1}100%{opacity:0}}
.dep-fade{animation:depFade 240ms linear forwards}
@keyframes ringOut{0%{opacity:.5;transform:scale(.35)}100%{opacity:0;transform:scale(1.7)}}
.ring{animation:ringOut 320ms cubic-bezier(.16,.9,.3,1) forwards;transform-box:fill-box;transform-origin:center;will-change:transform,opacity}
@keyframes nudge{0%,100%{transform:translateX(0)}22%{transform:translateX(-9px)}55%{transform:translateX(9px)}80%{transform:translateX(-4px)}}
.shake{animation:nudge 340ms ease}
@keyframes flashDim{0%,100%{opacity:1}50%{opacity:.3}}
.flash{animation:flashDim 340ms ease infinite}
@keyframes hintPulse{0%,100%{opacity:1}50%{opacity:.25}}
.hint{animation:hintPulse 850ms ease infinite}
@keyframes hbreak{0%{transform:scale(1)}35%{transform:scale(1.4)}100%{transform:scale(1)}}
.hbreak{animation:hbreak 430ms ease;display:inline-flex}
@keyframes starpop{0%{transform:scale(0) rotate(-25deg);opacity:0}70%{transform:scale(1.25) rotate(7deg);opacity:1}100%{transform:scale(1) rotate(0);opacity:1}}
.starpop{animation:starpop 460ms cubic-bezier(.34,1.56,.64,1) backwards}
@keyframes badgeIn{0%{transform:scale(.4);opacity:0}100%{transform:scale(1);opacity:1}}
.badge-in{animation:badgeIn 160ms cubic-bezier(.34,1.56,.64,1)}
@keyframes popUp{0%{transform:translateY(0);opacity:0}20%{transform:translateY(calc(var(--rise,60px) * -0.3));opacity:1}100%{transform:translateY(calc(var(--rise,60px) * -1));opacity:0}}
.pop{animation:popUp 820ms cubic-bezier(.15,.95,.3,1) forwards;pointer-events:none;will-change:transform,opacity}
@keyframes ovin{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:scale(1)}}
.ovin{animation:ovin 240ms ease-out}
.confetti{position:absolute;top:-20px;width:9px;height:15px;border-radius:2px;animation-name:fall;animation-timing-function:linear;animation-iteration-count:infinite}
@keyframes fall{0%{transform:translateY(0) rotate(0)}100%{transform:translateY(105vh) rotate(540deg)}}

/* every button gives instant physical feedback */
button { transition: transform 110ms cubic-bezier(.34,1.4,.64,1), background 180ms ease, opacity 180ms ease; }
button:active:not(:disabled) { transform: scale(.93); }

@keyframes screenIn { from { opacity: 0; transform: translateY(14px) scale(.985); } to { opacity: 1; transform: none; } }
.screen-in { animation: screenIn 260ms cubic-bezier(.18,.9,.26,1) both; will-change: transform, opacity; }

@keyframes boardIn { from { opacity: 0; transform: scale(.9); } to { opacity: 1; transform: scale(1); } }
.board-in { animation: boardIn 300ms cubic-bezier(.16,.92,.26,1) backwards; transform-origin: center; }

@keyframes hudIn { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: none; } }
.hud-in { animation: hudIn 260ms cubic-bezier(.2,.85,.3,1) both; }

@keyframes cardIn { from { opacity: 0; transform: translateY(16px) scale(.96); } to { opacity: 1; transform: none; } }
.card-in { animation: cardIn 300ms cubic-bezier(.2,1.06,.3,1) both; will-change: transform, opacity; }

@keyframes navPop { 0% { transform: scale(1); } 45% { transform: scale(1.18); } 100% { transform: scale(1); } }
.nav-on { animation: navPop 280ms cubic-bezier(.34,1.5,.64,1); }

button:focus-visible{outline:3px solid ${C.accent};outline-offset:3px}
@media (prefers-reduced-motion: reduce){.settle,.snake,.chev-out,.dep-fade,.ring,.shake,.flash,.hint,.hbreak,.starpop,.ovin,.confetti,.badge-in,.pop{animation-duration:1ms!important}}
`;

let CSS = makeCSS(C);

/* ═══════════  styles  ═══════════ */

const BOARD_W = "min(93vw, 412px)";
const CELL_CAP = 62;
const VIEW_PAD = 0.6;  // just enough margin for the stroke, no wasted screen
const DOT_PAD = 9;   // dots are drawn well past it and clipped by the viewport

const makeStyles = (C) => ({
  playRoot: { position: "fixed", inset: 0, height: "100dvh", touchAction: "none", overscrollBehavior: "none", background: C.bg, color: C.ink, fontFamily: "'Nunito', system-ui, sans-serif", display: "flex", flexDirection: "column", WebkitTapHighlightColor: "transparent", userSelect: "none", overflow: "hidden" },
  hud: { display: "flex", alignItems: "center", gap: 8, padding: "12px 14px 8px" },
  hudBtn: { width: 42, height: 42, borderRadius: "50%", background: C.card, border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: "0 2px 8px rgba(27,36,64,0.08)", flexShrink: 0 },
  hudMid: { flex: 1, textAlign: "center" },
  leftCount: { fontWeight: 800, fontSize: 12, color: C.muted },
  diffLabel: { fontWeight: 900, fontSize: 15, letterSpacing: "0.01em" },
  hudHearts: { display: "flex", gap: 4, justifyContent: "center", alignItems: "center", marginTop: 3 },
  hintPill: { display: "flex", alignItems: "center", gap: 5, background: C.card, border: "none", borderRadius: 999, padding: "10px 14px", cursor: "pointer", boxShadow: "0 2px 8px rgba(27,36,64,0.08)", flexShrink: 0 },
  hintTxt: { fontFamily: "'Nunito',sans-serif", fontWeight: 900, fontSize: 13, color: C.accent },
  topTrack: { height: 5, margin: "0 16px 4px", borderRadius: 999, background: C.line, overflow: "hidden" },
  topFill: { height: "100%", borderRadius: 999, background: C.accent, transition: "width 320ms cubic-bezier(.4,0,.2,1)" },
  playViewport: { flex: 1, minHeight: 0, width: "100%", overflow: "hidden", touchAction: "none", overscrollBehavior: "contain" },
  gridToggle: { position: "absolute", right: 18, bottom: 92, width: 50, height: 50, borderRadius: 16, background: C.card, border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: "0 4px 14px rgba(27,36,64,0.12)" },
  playFoot: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 18px 20px" },
  footBtn: { position: "relative", display: "flex", alignItems: "center", gap: 5, background: C.card, border: "none", borderRadius: 999, padding: "11px 16px", cursor: "pointer", boxShadow: "0 2px 8px rgba(27,36,64,0.08)" },
  footNum: { fontFamily: "'Nunito',sans-serif", fontWeight: 900, fontSize: 12, color: C.accent },
  scorePill: { fontFamily: "'Nunito',sans-serif", fontWeight: 900, fontSize: 19, color: C.ink },

  shellBody: { flex: 1, minHeight: 0, width: BOARD_W, overflowY: "auto", paddingBottom: 8 },
  home: { display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 6 },
  streakChip: { background: C.card, borderRadius: 999, padding: "7px 16px", fontWeight: 900, fontSize: 14, boxShadow: "0 2px 8px rgba(27,36,64,0.07)", marginBottom: 16 },
  homeCards: { display: "flex", gap: 12, width: "100%" },
  homeCard: { flex: 1, background: C.card, border: "none", borderRadius: 20, padding: "14px 12px 12px", cursor: "pointer", boxShadow: "0 4px 16px rgba(27,36,64,0.08)", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, fontFamily: "'Nunito',sans-serif" },
  homeCardTitle: { fontWeight: 900, fontSize: 17, color: C.ink },
  homeCardSub: { fontSize: 11, fontWeight: 700, color: C.muted },
  homeCardArt: { width: 74, height: 62, margin: "8px 0" },
  homeCardBtn: { width: "100%", background: C.accent, color: "#fff", borderRadius: 999, padding: "9px 0", fontWeight: 900, fontSize: 13 },
  brandWrap: { textAlign: "center", margin: "auto 0", padding: "34px 0" },
  brand: { fontWeight: 900, fontSize: 33, letterSpacing: "-0.03em", color: C.ink },
  homeLevel: { fontWeight: 900, fontSize: 21, color: C.accent, marginTop: 8 },
  homeDiff: { fontWeight: 900, fontSize: 15, marginTop: 2 },
  continueBtn: { width: "100%", background: C.accent, color: "#fff", border: "none", borderRadius: 999, padding: "17px 0", fontFamily: "'Nunito',sans-serif", fontWeight: 900, fontSize: 17, cursor: "pointer", boxShadow: "0 8px 22px rgba(47,123,246,0.3)" },
  homeFoot: { fontSize: 12, fontWeight: 700, color: C.muted, marginTop: 12 },

  nav: { width: BOARD_W, display: "flex", gap: 4, background: C.card, borderRadius: 22, padding: 6, marginTop: 8, boxShadow: "0 4px 16px rgba(27,36,64,0.09)" },
  navBtn: { flex: 1, background: "transparent", border: "none", borderRadius: 16, padding: "9px 1px", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, cursor: "pointer", fontFamily: "'Nunito',sans-serif" },
  navOn: { background: C.bg },
  navLabel: { fontSize: 8.5, fontWeight: 800, color: C.muted },
  page: { minHeight: "100dvh", background: C.bg, color: C.ink, fontFamily: "'Nunito', system-ui, sans-serif", display: "flex", flexDirection: "column", alignItems: "center", padding: "12px 14px 26px", WebkitTapHighlightColor: "transparent", userSelect: "none", touchAction: "manipulation" },
  settings: { width: BOARD_W, background: C.card, borderRadius: 18, padding: 14, marginBottom: 12, boxShadow: "0 8px 26px rgba(27,36,64,0.12)" },
  tglRow: { width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", background: "transparent", border: "none", padding: "9px 2px", cursor: "pointer", textAlign: "left" },
  tglLabel: { display: "block", fontWeight: 800, fontSize: 13.5, color: C.ink },
  tglHint: { display: "block", fontSize: 11, color: C.muted, fontWeight: 600, marginTop: 1 },
  tglTrack: { width: 40, height: 22, borderRadius: 999, padding: 2, flexShrink: 0, transition: "background 200ms ease" },
  tglKnob: { display: "block", width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "transform 200ms cubic-bezier(.34,1.4,.64,1)", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" },
  tip: { marginTop: 8, padding: "10px 12px", background: C.bg, borderRadius: 12, fontSize: 12, fontWeight: 600, color: C.muted, lineHeight: 1.5 },
  studioGrid: { display: "grid", gridTemplateColumns: "repeat(11, 1fr)", gap: 3, touchAction: "none", marginBottom: 12 },
  studioCell: { aspectRatio: "1 / 1", border: "none", borderRadius: 4, padding: 0, cursor: "pointer" },
  studioRow: { display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center" },
  chip: { flex: 1, minWidth: 74, background: C.bg, border: "none", borderRadius: 999, padding: "9px 10px", fontFamily: "'Nunito',sans-serif", fontWeight: 800, fontSize: 12, color: C.ink, cursor: "pointer" },
  codeInput: { flex: 2, minWidth: 120, background: C.bg, border: "none", borderRadius: 999, padding: "10px 14px", fontFamily: "'DM Mono', monospace", fontSize: 12, color: C.ink, outline: "none" },
  savedRow: { display: "flex", gap: 8, flexWrap: "wrap" },
  savedItem: { position: "relative" },
  savedBtn: { background: C.bg, border: "none", borderRadius: 12, padding: 6, cursor: "pointer", display: "block" },
  savedX: { position: "absolute", top: -5, right: -5, width: 19, height: 19, borderRadius: "50%", background: C.danger, color: "#fff", border: "none", fontSize: 10, fontWeight: 800, cursor: "pointer", lineHeight: 1 },
  studioMsg: { marginTop: 10, fontSize: 12, fontWeight: 800, color: C.accent, textAlign: "center" },
  themeTile: { display: "flex", flexDirection: "column", alignItems: "center", gap: 5, background: C.bg, border: "2px solid transparent", borderRadius: 12, padding: 7, cursor: "pointer" },
  themeName: { fontSize: 9.5, fontWeight: 800, color: C.muted, letterSpacing: "0.02em" },
  zenInf: { fontSize: 17, fontWeight: 900, color: C.go, marginRight: 6 },
  themeRow: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 2px" },
  swatch: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, padding: 4, borderRadius: 10, border: "2px solid transparent", background: C.bg, cursor: "pointer" },
  swatchDot: { width: 8, height: 8, borderRadius: 2 },
  colTitle: { fontWeight: 900, fontSize: 14, marginBottom: 10, padding: "0 2px" },
  chapterCard: { width: "100%", background: C.card, borderRadius: 18, padding: 14, boxShadow: "0 4px 16px rgba(27,36,64,0.08)", marginTop: 14 },
  chapRow: { display: "flex", alignItems: "center", gap: 11 },
  chapBadge: { width: 34, height: 34, borderRadius: 12, color: "#fff", fontWeight: 900, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  chapName: { fontWeight: 900, fontSize: 15, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  chapSub: { fontSize: 11, fontWeight: 700, color: C.muted, marginTop: 1 },
  chapSticker: { flexShrink: 0 },
  chapTrack: { height: 6, borderRadius: 999, background: C.bg, overflow: "hidden", marginTop: 11 },
  chapFill: { height: "100%", borderRadius: 999, transition: "width 400ms cubic-bezier(.4,0,.2,1)" },
  chapHint: { fontSize: 10.5, fontWeight: 700, color: C.muted, marginTop: 7, textAlign: "center" },
  emptyNote: { fontSize: 12, fontWeight: 600, color: C.muted, background: C.bg, borderRadius: 12, padding: "12px 14px", lineHeight: 1.5 },
  stickerGrid: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 },
  stickerItem: { display: "flex", flexDirection: "column", alignItems: "center", gap: 3, background: C.bg, border: "2px solid", borderRadius: 14, padding: "10px 4px" },
  stickerName: { fontSize: 8.5, fontWeight: 800, color: C.muted, textAlign: "center", lineHeight: 1.2 },
  stickerCh: { fontSize: 8, fontWeight: 800, color: C.muted, opacity: 0.7 },
  badgeList: { display: "flex", flexDirection: "column", gap: 6 },
  badgeRow: { display: "flex", alignItems: "center", gap: 10, background: C.bg, borderRadius: 12, padding: "9px 12px" },
  badgeDot: { width: 11, height: 11, borderRadius: "50%", flexShrink: 0 },
  badgeName: { display: "block", fontWeight: 800, fontSize: 13, color: C.ink },
  badgeNeed: { display: "block", fontSize: 10.5, fontWeight: 600, color: C.muted, marginTop: 1 },
  badgeTick: { fontWeight: 900, color: C.gold, fontSize: 14 },
  rankBar: { display: "flex", gap: 8, marginBottom: 12 },
  rankChip: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, background: C.bg, borderRadius: 12, padding: "8px 4px" },
  rankDot: { width: 10, height: 10, borderRadius: "50%" },
  rankNum: { fontWeight: 900, fontSize: 15, color: C.ink },
  rankLbl: { fontSize: 9.5, fontWeight: 800, color: C.muted },
  rankTag: { fontSize: 8, fontWeight: 900, letterSpacing: "0.08em" },
  foundGrid: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 },
  foundItem: { display: "flex", flexDirection: "column", alignItems: "center", gap: 3, background: C.bg, borderRadius: 12, padding: "9px 4px" },
  foundName: { fontSize: 8.5, fontWeight: 800, color: C.muted, textAlign: "center", lineHeight: 1.2 },
  colGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 },
  colItem: { display: "flex", flexDirection: "column", alignItems: "center", gap: 4, background: C.bg, borderRadius: 14, padding: "12px 6px" },
  colName: { fontSize: 11, fontWeight: 800, color: C.muted },
  adBtn: { width: "100%", background: C.go, color: "#fff", border: "none", borderRadius: 999, padding: "14px 0", fontFamily: "'Nunito',sans-serif", fontWeight: 900, fontSize: 14, cursor: "pointer", marginBottom: 9, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 },
  adPlay: { fontSize: 11 },
  adNote: { fontSize: 11.5, fontWeight: 700, color: C.muted, textAlign: "center", marginTop: 8 },
  buyRow: { display: "flex", alignItems: "center", gap: 12, background: C.bg, borderRadius: 14, padding: "12px 14px", marginBottom: 8 },
  buyName: { display: "block", fontWeight: 900, fontSize: 14, color: C.ink },
  buyHint: { display: "block", fontSize: 11, fontWeight: 600, color: C.muted, marginTop: 2, lineHeight: 1.4 },
  buyBtn: { background: C.accent, color: "#fff", border: "none", borderRadius: 999, padding: "10px 20px", fontFamily: "'Nunito',sans-serif", fontWeight: 900, fontSize: 13, cursor: "pointer", flexShrink: 0 },
  buyDone: { fontSize: 12.5, fontWeight: 800, color: C.go, background: C.bg, borderRadius: 12, padding: "11px 14px", marginBottom: 8 },
  restoreBtn: { width: "100%", background: "transparent", border: "none", padding: "9px 0", fontFamily: "'Nunito',sans-serif", fontWeight: 800, fontSize: 12, color: C.muted, cursor: "pointer", marginBottom: 12 },
  lvNote: { fontSize: 11.5, fontWeight: 600, color: C.muted, lineHeight: 1.5, marginBottom: 14 },
  lvChapter: { marginBottom: 18 },
  lvHead: { display: "flex", alignItems: "center", gap: 9, marginBottom: 9 },
  lvChapName: { flex: 1, fontWeight: 900, fontSize: 14, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  lvChapStars: { fontSize: 11, fontWeight: 800, color: C.muted, flexShrink: 0 },
  lvGrid: { display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 7 },
  lvCell: { background: C.bg, border: "2px solid", borderRadius: 12, padding: "9px 2px 7px", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, fontFamily: "'Nunito',sans-serif" },
  lvNum: { fontWeight: 900, fontSize: 13, color: C.ink },
  lvStars: { fontSize: 8.5, color: C.gold, letterSpacing: "-0.5px", minHeight: 11 },
  tutBar: { display: "flex", alignItems: "center", gap: 10, width: "calc(100% - 28px)", alignSelf: "center", background: C.accent, borderRadius: 14, padding: "11px 13px", marginBottom: 8 },
  tutStep: { fontWeight: 900, fontSize: 11, color: "#fff", background: "rgba(255,255,255,0.22)", borderRadius: 999, padding: "3px 8px", flexShrink: 0 },
  tutText: { flex: 1, fontSize: 12.5, fontWeight: 700, color: "#fff", lineHeight: 1.35 },
  tutSkip: { background: "rgba(255,255,255,0.2)", border: "none", borderRadius: 999, padding: "6px 11px", fontFamily: "'Nunito',sans-serif", fontWeight: 800, fontSize: 11, color: "#fff", cursor: "pointer", flexShrink: 0 },
  coach: { width: "calc(100% - 28px)", alignSelf: "center", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, background: C.coachBg, border: "none", borderRadius: 12, padding: "8px 12px", marginBottom: 8, cursor: "pointer", textAlign: "left" },
  coachText: { fontSize: 12, fontWeight: 600, color: C.ink, fontFamily: "'Nunito',sans-serif" },
  coachX: { fontSize: 12, color: C.muted, fontWeight: 800 },
  inl: { display: "inline-flex" },
  shieldTag: { fontSize: 15, marginRight: 2 },
  zenTag: { fontSize: 10, fontWeight: 900, letterSpacing: "0.15em", color: C.go, background: "#E4F6EE", borderRadius: 999, padding: "4px 10px" },
  svgFill: { width: "100%", height: "100%", display: "block", overflow: "visible", touchAction: "none", pointerEvents: "auto" },
  overlay: { position: "absolute", inset: 0, borderRadius: 24, background: C.overlay, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(3px)" },
  ovCard: { textAlign: "center", padding: 24, width: "100%", maxWidth: 280 },
  ovTitle: { fontWeight: 900, fontSize: 21, marginBottom: 6 },
  ovSub: { fontSize: 13, color: C.muted, marginBottom: 20, fontWeight: 600, lineHeight: 1.45 },
  primary: { display: "block", width: "100%", background: C.accent, color: "#fff", border: "none", borderRadius: 999, padding: "14px 30px", fontFamily: "'Nunito',sans-serif", fontWeight: 800, fontSize: 15, cursor: "pointer", boxShadow: "0 6px 18px rgba(47,123,246,0.32)" },
  ghost: { display: "block", width: "100%", marginTop: 8, background: "transparent", color: C.muted, border: "none", padding: 10, fontFamily: "'Nunito',sans-serif", fontWeight: 800, fontSize: 13, cursor: "pointer" },
  winWrap: { position: "fixed", inset: 0, background: "linear-gradient(180deg,#1E8BFF 0%,#3AA0FF 55%,#5FB6FF 100%)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", zIndex: 40, padding: 20 },
  winInner: { position: "relative", textAlign: "center", width: "100%", maxWidth: 320 },
  winKicker: { color: "rgba(255,255,255,0.92)", fontWeight: 800, fontSize: 15 },
  winTitle: { color: "#fff", fontWeight: 900, fontSize: 27, letterSpacing: "-0.02em", margin: "6px 0 18px" },
  winCard: { background: C.card, borderRadius: 22, padding: 20, boxShadow: "0 14px 40px rgba(0,40,90,0.28)" },
  winStars: { display: "flex", gap: 10, justifyContent: "center", margin: "18px 0 6px" },
  winMeta: { color: "rgba(255,255,255,0.92)", fontSize: 13, fontWeight: 700, marginBottom: 18 },
  winBtn: { display: "block", width: "100%", background: "#fff", color: C.accent, border: "none", borderRadius: 999, padding: "14px 30px", fontFamily: "'Nunito',sans-serif", fontWeight: 900, fontSize: 15, cursor: "pointer", boxShadow: "0 6px 20px rgba(0,40,90,0.22)" },
  winGhost: { display: "block", width: "100%", marginTop: 10, background: "transparent", color: "#fff", border: "none", padding: 10, fontFamily: "'Nunito',sans-serif", fontWeight: 800, fontSize: 14, cursor: "pointer" },
});

let S = makeStyles(C);

function applyTheme(dark) {
  Object.assign(C, dark ? DARK : LIGHT);
  C.__dark = dark;
  S = makeStyles(C);
  CSS = makeCSS(C);
}

