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

  function peek() {
    if (!sfxOn) return;
    tone(1180, { type: "sine", dur: 0.07, peak: 0.09 });
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
    peek,
    undo,
    shieldUp,
    shieldUsed,
    win,
    lose,
  };
})();

let RND = Math.random;
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hashStr = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

/* ═══════════  shapes  ═══════════ */

const SHAPES = {
  square4: { name: "Grid", rows: ["####", "####", "####", "####"] },
  square5: { name: "Grid", rows: ["#####", "#####", "#####", "#####", "#####"] },
  square6: { name: "Grid", rows: Array.from({ length: 6 }, () => "######") },
  square8: { name: "Grid", rows: Array.from({ length: 8 }, () => "########") },
  square10: { name: "Grid", rows: Array.from({ length: 10 }, () => "##########") },
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
  butterfly: { name: "Butterfly", rows: ["##.......##", "####...####", "#####.#####", "###########", "#####.#####", "####...####", "##.......##"] },
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
  crown11: {
    name: "Crown",
    rows: ["#....#....#", "#....#....#", "##...#...##", "##.#####.##", "###########", "###########", "###########", ".#########."],
  },
  rocket9: {
    name: "Rocket",
    rows: ["....#....", "...###...", "...###...", "..#####..", "..#####..", "..#####..", "..#####..", ".#######.", "##.###.##", "##.###.##", "...###...", "..#.#.#.."],
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
  cup11: {
    name: "Trophy",
    rows: ["###########", "###########", "#.#######.#", "#.#######.#", "..#######..", "..#######..", "...#####...", "....###....", "....###....", "..#######..", ".#########."],
  },
  cat11: {
    name: "Cat",
    rows: ["##.......##", "###.....###", "####...####", "###########", "###########", "###########", "###########", ".#########.", "..#######..", "...#####...", "....###...."],
  },
};

const COLLECTABLE = ["Grid", "Diamond", "Heart", "Cross", "Butterfly", "Star", "Hexagon", "Triangle", "Ring", "Arrow", "Crown", "Rocket", "Bolt", "House", "Bell", "Trophy", "Cat"];
const THUMB = { Grid: "square6", Diamond: "diamond7", Heart: "heart9", Cross: "cross7", Butterfly: "butterfly", Star: "star", Hexagon: "hexagon11", Triangle: "triangle11", Ring: "ring11", Arrow: "bigarrow11", Crown: "crown11", Rocket: "rocket9", Bolt: "bolt9", House: "house11", Bell: "bell11", Trophy: "cup11", Cat: "cat11" };

/* ═══════════  tiers  ═══════════ */

const TIERS = [
  { name: "Little Easy", span: 5, pool: ["square4", "square5", "diamond7"], maxLen: 2, hearts: 5, hints: 3, undos: 3, coverage: 0.78, tightness: 0.1, freedom: 0.42 },
  { name: "Easy", span: 7, pool: ["square5", "square6", "diamond7", "heart9", "hexagon11", "rocket9", "bolt9"], maxLen: 3, hearts: 4, hints: 3, undos: 3, coverage: 0.84, tightness: 0.3, freedom: 0.3 },
  { name: "Little Medium", span: 10, pool: ["square6", "heart9", "cross7", "butterfly", "hexagon11", "triangle11", "crown11", "rocket9", "house11", "bell11", "cat11"], maxLen: 3, hearts: 3, hints: 2, undos: 2, coverage: 0.88, tightness: 0.5, freedom: 0.22 },
  { name: "Medium", span: 13, pool: ["diamond11", "heart13", "butterfly", "cross11", "square8", "ring11", "bigarrow11", "crown11", "house11", "cup11", "cat11", "bell11"], maxLen: 4, hearts: 3, hints: 2, undos: 2, coverage: 0.92, tightness: 0.7, freedom: 0.16 },
  { name: "Hard", span: 20, pool: ["heart13", "star", "cross11", "square10", "butterfly", "ring11", "bigarrow11", "cup11", "cat11", "house11"], maxLen: 5, hearts: 3, hints: 1, undos: 2, coverage: 0.93, tightness: 0.88, freedom: 0.11 },
  { name: "Pro", span: Infinity, pool: ["heart13", "star", "square10", "cross11", "ring11", "bigarrow11", "crown11", "cup11", "cat11"], maxLen: 5, hearts: 2, hints: 1, undos: 1, coverage: 0.98, tightness: 1, freedom: 0.07 },
];
const TIER_HUE = ["#7CD6A8", "#63C5F0", "#FFC24B", "#FF9A5B", "#FF6B7D", "#A87BFF"];

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
  return { tier: TIERS[5], index: 5, start, step: level - start + 1 };
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

const CURATED_UNTIL = 60;
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
  return { ...parseMask("diamond11"), procedural: true };
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
  if (cols < 4 || rows < 4 || cols > 18 || rows > 18) return null;
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

function buildBoard(mask, { maxLen, coverage, tightness }) {
  const { cols, rows, cells } = mask;
  const occupied = new Map();
  const pieces = [];
  const all = [...cells];
  const target = Math.round(cells.size * coverage);
  let filled = 0;
  let fails = 0;

  const edgeDist = (c) => {
    const x = c % cols;
    const y = Math.floor(c / cols);
    return Math.min(x, cols - 1 - x, y, rows - 1 - y);
  };

  while (filled < target && fails < 500) {
    const free = all.filter((c) => !occupied.has(c));
    if (!free.length) break;
    // sample a few and take the most central — interior lanes must be claimed early
    let head = free[(RND() * free.length) | 0];
    for (let t = 0; t < 5; t++) {
      const cand = free[(RND() * free.length) | 0];
      if (edgeDist(cand) > edgeDist(head)) head = cand;
    }
    const options = [];
    for (const d of DIR_NAMES) {
      const lane = exitLine(head, d, cols, rows);
      if (lane.some((c) => occupied.has(c))) continue;
      options.push({ d, len: lane.length });
    }
    if (!options.length) {
      fails++;
      continue;
    }
    options.sort((a, b) => b.len - a.len);
    const chosen = RND() < tightness ? options[0] : options[(RND() * options.length) | 0];
    const D = DIRS[chosen.d];

    const body = [head];
    const used = new Set([head]);
    const want = 1 + ((RND() * maxLen) | 0);
    if (want > 1) {
      const back = step(head, -D.dx, -D.dy, cols, rows);
      if (back !== null && cells.has(back) && !occupied.has(back)) {
        body.push(back);
        used.add(back);
        let cur = back;
        while (body.length < want) {
          const nbrs = shuffle(DIR_NAMES)
            .map((n) => step(cur, DIRS[n].dx, DIRS[n].dy, cols, rows))
            .filter((n) => n !== null && cells.has(n) && !occupied.has(n) && !used.has(n));
          if (!nbrs.length) break;
          cur = nbrs[0];
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

function measureFreedom(pieces, cols, rows) {
  if (!pieces.length) return 1;
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
  while (alive.size) {
    const free = [...alive].filter(isFree);
    if (!free.length) return 1;
    sum += free.length / alive.size;
    n++;
    alive.delete(free[(RND() * free.length) | 0]);
  }
  return n ? sum / n : 1;
}

function makeLevelFromMask(mask, tierIdx = 3) {
  const tier = TIERS[tierIdx];
  let best = null;
  for (let i = 0; i < 5; i++) {
    const pieces = buildBoard(mask, tier);
    if (pieces.length < 3) continue;
    const gap = Math.abs(measureFreedom(pieces, mask.cols, mask.rows) - tier.freedom);
    if (!best || gap < best.gap) best = { pieces, gap };
  }
  if (!best) best = { pieces: buildBoard(mask, tier), gap: 1 };
  return {
    mask, pieces: best.pieces, tier, tierIndex: tierIdx, stepInTier: 1,
    hearts: tier.hearts, hints: tier.hints, undos: tier.undos,
  };
}

function makeLevel(level, seed) {
  if (seed !== undefined) RND = mulberry32(seed);
  const { tier, index, step: stepInTier } = tierFor(level);
  const mask =
    seed === undefined && level > CURATED_UNTIL
      ? proceduralMask(level)
      : parseMask(tier.pool[(seed !== undefined ? seed : level - 1) % tier.pool.length]);
  const tries = mask.cells.size > 90 ? 4 : 7;

  let best = null;
  for (let i = 0; i < tries; i++) {
    const pieces = buildBoard(mask, tier);
    if (pieces.length < 3) continue;
    const gap = Math.abs(measureFreedom(pieces, mask.cols, mask.rows) - tier.freedom);
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
  const [peeks, setPeeks] = useState(0);
  const [flying, setFlying] = useState(new Map());
  const lastMiss = useRef({ id: -1, t: 0 });
  const [bad, setBad] = useState(null);
  const [hintId, setHintId] = useState(null);
  const [preview, setPreview] = useState(null);
  const [pops, setPops] = useState([]);
  const [ring, setRing] = useState(null);
  const [phase, setPhase] = useState("playing");
  const [heartPop, setHeartPop] = useState(false);
  const [panel, setPanel] = useState(null); // settings | collection
  const [zen, setZen] = useState(false);
  const [bigTouch, setBigTouch] = useState(true);
  const [haptics, setHaptics] = useState(true);
  const [sfxOn, setSfxOn] = useState(true);
  const [musicOn, setMusicOn] = useState(true);
  const [theme, setTheme] = useState("ink");
  const [dark, setDark] = useState(false);
  const [coachSeen, setCoachSeen] = useState(true);
  const [collected, setCollected] = useState([]);
  const [customs, setCustoms] = useState([]);
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
        const s = await window.storage.get("arrowv2:save");
        if (!s?.value) {
          setCoachSeen(false);
          return;
        }
        const p = JSON.parse(s.value);
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
        setCollected(p.collected ?? []);
        setCustoms(p.customs ?? []);
        setStreak(p.streak ?? 0);
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

  const persist = useCallback(async (patch) => {
    try {
      let cur = {};
      try {
        const s = await window.storage.get("arrowv2:save");
        if (s?.value) cur = JSON.parse(s.value);
      } catch {}
      await window.storage.set("arrowv2:save", JSON.stringify({ ...cur, ...patch }));
    } catch {}
  }, []);

  /* ── level control ── */
  const applySetup = useCallback((st, keepScore) => {
    setSetup(st);
    setAlive(new Set(st.pieces.map((p) => p.id)));
    setHistory([]);
    setHearts(st.hearts);
    setHintsLeft(st.hints);
    setUndosLeft(st.undos);
    setShield(false);
    setFlow(0);
    setCombo(0);
    if (!keepScore) setScore(0);
    setTaps(0);
    setMistakes(0);
    setPeeks(0);
    setFlying(new Map());
    lastMiss.current = { id: -1, t: 0 };
    setBad(null);
    setHintId(null);
    setPreview(null);
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
      setPanel(null);
      applySetup(makeLevelFromMask(mask), false);
    },
    [applySetup]
  );

  const saveCustom = useCallback(
    (code) => {
      setCustoms((cur) => {
        const next = [code, ...cur.filter((c) => c !== code)].slice(0, 12);
        persist({ customs: next });
        return next;
      });
    },
    [persist]
  );

  const deleteCustom = useCallback(
    (code) => {
      setCustoms((cur) => {
        const next = cur.filter((c) => c !== code);
        persist({ customs: next });
        return next;
      });
    },
    [persist]
  );

  const startDaily = useCallback(() => {
    setMode("daily");
    applySetup(makeLevel(24, hashStr(todayKey())));
  }, [applySetup]);

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
    else if (mode === "custom") applySetup(makeLevelFromMask(setup.mask), false);
    else startJourney(level);
  }, [mode, level, startDaily, startJourney, applySetup, setup.mask]);

  const nextLevel = useCallback(() => {
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
          setHearts((h) => {
            const n = Math.max(h - 1, 0);
            if (n === 0) setTimeout(() => { setPhase("gameover"); Snd.lose(); }, 520);
            return n;
          });
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
      addPop(piece.cells[0], freed > 0 ? `+${gain}  frees ${freed}` : `+${gain}`, freed > 0 ? C.flow : C.accent);
      setRing({ cell: piece.cells[0], key: Date.now() });
      setTimeout(() => setRing((r) => (r && r.cell === piece.cells[0] ? null : r)), 470);

      setFlow((f) => {
        const nf = f + 14 + freed * 6;
        if (nf >= 100 && !shield) {
          setShield(true);
          Snd.shieldUp();
          buzz(20);
          return 0;
        }
        return Math.min(nf, 100);
      });

      // logical removal is instant; the visual keeps flying for a moment
      const key = Date.now() + piece.id;
      setFlying((f) => new Map(f).set(piece.id, key));
      setTimeout(() => setFlying((f) => { const m = new Map(f); if (m.get(piece.id) === key) m.delete(piece.id); return m; }), 560);
      setHistory((h) => [...h, piece.id]);

      setAlive((prev) => {
        const next = new Set(prev);
        next.delete(piece.id);
        if (next.size === 0) {
          setTimeout(() => {
            setPhase("cleared");
            Snd.win();
            setCollected((cur) => {
              if (!COLLECTABLE.includes(mask.name) || cur.includes(mask.name)) return cur;
              const nc = [...cur, mask.name];
              persist({ collected: nc });
              return nc;
            });
            setScore((sc) => {
              const bonus = 120 + (mistakes === 0 ? 200 : 0);
              const fin = sc + bonus;
              setBestScore((bs) => {
                const nb = Math.max(bs, fin);
                persist({ bestScore: nb });
                return nb;
              });
              return fin;
            });
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
          }, 620);
        }
        return next;
      });
    },
    [phase, alive, blockerOf, pieces, cols, rows, combo, shield, zen, mode, dailyDone, best, level, mistakes, mask.name, persist, addPop]
  );

  /* ── hold to peek ── */
  const onPieceDown = useCallback(
    (piece) => (e) => {
      if (phase !== "playing") return;
      e.preventDefault();
      const timer = setTimeout(() => {
        if (!press.current) return;
        press.current.peeking = true;
        setPreview({ id: piece.id, blocker: blockerOf(piece), lane: exitLine(piece.cells[0], piece.dir, cols, rows) });
        Snd.peek();
        buzz(6);
      }, 200);
      press.current = { piece, timer, peeking: false };
    },
    [phase, blockerOf, cols, rows]
  );

  useEffect(() => {
    const up = () => {
      const p = press.current;
      if (!p) return;
      clearTimeout(p.timer);
      press.current = null;
      if (p.peeking) {
        setPeeks((n) => n + 1);
        setPreview(null);
      } else {
        fire(p.piece);
      }
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
    setPreview(null);
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
      if (g.start.scale <= 1.01) return; // nothing to pan at fit size
      if (Math.hypot(dx, dy) < 14) return; // let genuine taps through
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

  const clean = mistakes === 0 && peeks === 0 && undosLeft === setup.undos;
  const stars = clean ? 3 : mistakes === 0 ? 2 : 1;
  const previewPiece = preview ? pieces.find((p) => p.id === preview.id) : null;

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

  return (
    <div style={S.page}>
      <style>{CSS}</style>

      <div style={S.modeBar}>
        <button style={{ ...S.modeBtn, ...(mode === "journey" ? S.modeOn : {}) }} onClick={() => startJourney(level)}>
          Journey
        </button>
        <button style={{ ...S.modeBtn, ...(mode === "daily" ? S.modeOn : {}) }} onClick={startDaily}>
          Daily {streak > 0 && <span style={S.streak}>🔥{streak}</span>}
        </button>
        <button
          style={S.gear}
          onClick={() => {
            Snd.unlock();
            const v = !(sfxOn || musicOn);
            setSfxOn(v);
            setMusicOn(v);
            persist({ sfx: v, music: v });
          }}
          aria-label={sfxOn || musicOn ? "Mute" : "Unmute"}
        >
          <Speaker on={sfxOn || musicOn} />
        </button>
        <button style={S.gear} onClick={() => setPanel(panel === "studio" ? null : "studio")} aria-label="Shape studio">
          <Pencil />
        </button>
        <button style={S.gear} onClick={() => setPanel(panel === "collection" ? null : "collection")} aria-label="Collection">
          <Trophy />
        </button>
        <button style={S.gear} onClick={() => setPanel(panel === "settings" ? null : "settings")} aria-label="Settings">
          <Gear />
        </button>
      </div>

      {panel === "settings" && (
        <div style={S.settings} className="ovin">
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
            <b>Hold</b> an arrow to check its path — ✓ clear, ✕ blocked. <b>Pinch</b> to zoom.
            <br />
            Clearing an arrow that <b>frees others</b> scores far more. Find the order that unlocks the most.
          </div>
        </div>
      )}

      {panel === "studio" && (
        <ShapeStudio onPlay={startCustom} saved={customs} onSave={saveCustom} onDelete={deleteCustom} />
      )}

      {panel === "collection" && (
        <div style={S.settings} className="ovin">
          <div style={S.colTitle}>
            Shapes collected · {collected.length}/{COLLECTABLE.length}
          </div>
          <div style={S.colGrid}>
            {COLLECTABLE.map((n) => {
              const on = collected.includes(n);
              return (
                <div key={n} style={{ ...S.colItem, opacity: on ? 1 : 0.45 }}>
                  <ShapeThumb shapeKey={THUMB[n]} on={on} />
                  <span style={S.colName}>{on ? n : "???"}</span>
                </div>
              );
            })}
          </div>
          <div style={S.tip}>Clear a level of each shape to add it to your collection.</div>
        </div>
      )}

      {/* one compact status row instead of four stacked ones */}
      <div style={S.bar}>
        <div style={S.barLeft}>
          <div style={S.lvl}>
            {mode === "custom" ? "Your board" : mode === "daily" ? "Daily" : `Level ${level}`}
          </div>
          <div style={S.sub}>
            <span style={{ color: C.accent }}>{mask.name}</span>
            <span style={S.dotSep}>·</span>
            <span>{mode === "custom" ? "drawn by you" : mode === "daily" ? "worldwide" : tier.name}</span>
            <span style={S.dotSep}>·</span>
            <span>{alive.size} left</span>
          </div>
        </div>

        <div style={S.barMid}>
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

        <div style={S.barRight}>
          <div style={S.scoreNum}>{score.toLocaleString()}</div>
          <div style={S.flowTrack}>
            <div style={{ ...S.flowFill, width: `${flow}%` }} />
          </div>
        </div>
      </div>

      <div style={S.tierRow}>
        {TIERS.map((t, i) => (
          <span
            key={t.name}
            style={{
              ...S.tierTick,
              background: mode === "daily" ? C.line : i < tierIndex ? C.accent : i === tierIndex ? TIER_HUE[i] : C.line,
              flex: i === tierIndex ? 1.6 : 1,
            }}
          />
        ))}
      </div>

      {!coachSeen && (
        <button
          style={S.coach}
          className="ovin"
          onClick={() => { setCoachSeen(true); persist({ coachSeen: true }); }}
        >
          <span style={S.coachText}>
            <b>Hold</b> an arrow to check its path first
          </span>
          <span style={S.coachX}>✕</span>
        </button>
      )}

      <div style={S.board}>
        <div style={S.track}>
          <div style={{ ...S.fill, width: `${progress}%` }} />
        </div>

        <div ref={viewport} style={S.viewport} onPointerDown={onViewDown} onPointerMove={onViewMove} onPointerUp={onViewUp} onPointerCancel={onViewUp}>
          <div style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`, transformOrigin: "0 0", transition: snap ? "transform 240ms cubic-bezier(.4,0,.2,1)" : "none" }}>
            <svg viewBox={`0 0 ${cols * U} ${rows * U}`} style={{ ...S.svg, aspectRatio: `${cols} / ${rows}` }} aria-label={`${mask.name} arrow puzzle`}>
              {[...mask.cells].map((i) => (
                <circle key={`d${i}`} cx={cx(i, cols)} cy={cy(i, cols)} r={3.6} fill={C.dot} />
              ))}

              {preview && previewPiece && (
                <line
                  x1={cx(previewPiece.cells[0], cols)}
                  y1={cy(previewPiece.cells[0], cols)}
                  x2={cx(previewPiece.cells[0], cols) + DIRS[previewPiece.dir].dx * (rows + cols) * U}
                  y2={cy(previewPiece.cells[0], cols) + DIRS[previewPiece.dir].dy * (rows + cols) * U}
                  stroke={preview.blocker === null ? C.go : C.stop}
                  strokeWidth={19}
                  strokeLinecap="round"
                  opacity={0.2}
                />
              )}

              {pieces.map((p, i) => {
                if (!alive.has(p.id)) return null;
                const isBad = bad?.id === p.id;
                const isBlk = bad?.blocker === p.id;
                const isHint = hintId === p.id;
                const isPeek = preview?.id === p.id;
                const isPeekBlk = preview?.blocker === p.id;
                const tone = isBad || isBlk ? C.danger : isPeekBlk ? C.stop : isPeek ? (preview.blocker === null ? C.go : C.stop) : isHint ? C.accent : toneFor(p.dir, theme);
                const cls = isBad ? "shake" : isBlk || isPeekBlk ? "flash" : isHint ? "hint" : "settle";
                return (
                  <Piece
                    key={`${levelKey}-${p.id}`}
                    piece={p}
                    cols={cols}
                    tone={tone}
                    width={W_BOARD}
                    hit={bigTouch ? 78 : 52}
                    className={cls}
                    style={{ "--d": `${(i % 14) * 22}ms` }}
                    onDown={onPieceDown(p)}
                  />
                );
              })}

              {preview && previewPiece && (
                <g transform={`translate(${cx(previewPiece.cells[0], cols)} ${cy(previewPiece.cells[0], cols)}) scale(${cols / 8})`} className="badge-in">
                  <circle r={23} fill={preview.blocker === null ? C.go : C.stop} />
                  {preview.blocker === null ? (
                    <path d="M -10 1 L -3 8.5 L 10.5 -7" stroke="#fff" strokeWidth={5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  ) : (
                    <path d="M -7.5 -7.5 L 7.5 7.5 M 7.5 -7.5 L -7.5 7.5" stroke="#fff" strokeWidth={5} strokeLinecap="round" />
                  )}
                </g>
              )}

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

              {pops.map((p) => (
                <text
                  key={p.id}
                  className="pop"
                  x={p.x}
                  y={p.y}
                  fill={p.hue}
                  fontSize={cols * 3.6}
                  fontWeight={800}
                  textAnchor="middle"
                  style={{ fontFamily: "Nunito, sans-serif", "--rise": `${cols * 7}px` }}
                >
                  {p.text}
                </text>
              ))}
            </svg>
          </div>
        </div>



        {phase === "gameover" && (
          <div style={S.overlay} className="ovin">
            <div style={S.ovCard}>
              <div style={{ ...S.ovTitle, color: C.danger }}>Out of lives</div>
              <div style={S.ovSub}>Tip: hold an arrow to check its path before firing.</div>
              <button style={S.primary} onClick={restart}>
                Try again
              </button>
              <button style={S.ghost} onClick={() => { setZen(true); persist({ zen: true }); restart(); }}>
                Switch to Zen mode
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={S.controls}>
        <button style={{ ...S.orb, opacity: hintsLeft > 0 ? 1 : 0.35 }} onClick={useHint} disabled={hintsLeft <= 0} aria-label="Hint">
          <Bulb />
          {hintsLeft > 0 && <span style={S.badge}>{hintsLeft}</span>}
        </button>
        <button style={{ ...S.orb, opacity: undosLeft > 0 && history.length ? 1 : 0.35 }} onClick={undo} disabled={undosLeft <= 0 || !history.length} aria-label="Undo">
          <Undo />
          {undosLeft > 0 && <span style={S.badge}>{undosLeft}</span>}
        </button>
        <button style={S.orb} onClick={restart} aria-label="Restart">
          <Refresh />
        </button>
        <button style={S.orb} onClick={cycleZoom} aria-label={`Zoom, currently ${view.scale.toFixed(1)} times`}>
          <Magnifier zoomed={view.scale > 1.01} />
          {view.scale > 1.01 && <span style={S.badge}>{Math.round(view.scale)}×</span>}
        </button>
      </div>

      <div style={S.foot}>Best score {bestScore.toLocaleString()} · best level {best}</div>

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
              {peeks > 0 && ` · ${peeks} peek${peeks > 1 ? "s" : ""}`}
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
    <div style={S.settings} className="ovin">
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
@keyframes settleIn{0%{opacity:0;transform:translateY(6px)}100%{opacity:1;transform:translateY(0)}}
.settle{animation:settleIn 300ms ease backwards;animation-delay:var(--d,0ms)}
@keyframes snakeOut{to{stroke-dashoffset:var(--off)}}
.snake{animation:snakeOut 540ms cubic-bezier(.36,0,.32,1) forwards}
@keyframes chevOut{to{transform:translate(var(--tx),var(--ty))}}
.chev-out{animation:chevOut 540ms cubic-bezier(.36,0,.32,1) forwards}
@keyframes depFade{0%,72%{opacity:1}100%{opacity:0}}
.dep-fade{animation:depFade 540ms linear forwards}
@keyframes ringOut{0%{opacity:.5;transform:scale(.35)}100%{opacity:0;transform:scale(1.7)}}
.ring{animation:ringOut 460ms cubic-bezier(.25,.8,.4,1) forwards;transform-box:fill-box;transform-origin:center}
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
.pop{animation:popUp 950ms cubic-bezier(.2,.9,.3,1) forwards;pointer-events:none}
@keyframes ovin{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:scale(1)}}
.ovin{animation:ovin 240ms ease-out}
.confetti{position:absolute;top:-20px;width:9px;height:15px;border-radius:2px;animation-name:fall;animation-timing-function:linear;animation-iteration-count:infinite}
@keyframes fall{0%{transform:translateY(0) rotate(0)}100%{transform:translateY(105vh) rotate(540deg)}}
button:focus-visible{outline:3px solid ${C.accent};outline-offset:3px}
@media (prefers-reduced-motion: reduce){.settle,.snake,.chev-out,.dep-fade,.ring,.shake,.flash,.hint,.hbreak,.starpop,.ovin,.confetti,.badge-in,.pop{animation-duration:1ms!important}}
`;

let CSS = makeCSS(C);

/* ═══════════  styles  ═══════════ */

const BOARD_W = "min(93vw, 412px)";

const makeStyles = (C) => ({
  bar: { width: BOARD_W, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 },
  barLeft: { minWidth: 0 },
  lvl: { fontWeight: 900, fontSize: 17, letterSpacing: "-0.02em", lineHeight: 1.15 },
  sub: { display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 700, color: C.muted, marginTop: 2, whiteSpace: "nowrap" },
  dotSep: { opacity: 0.5 },
  barMid: { display: "flex", gap: 4, alignItems: "center" },
  barRight: { textAlign: "right", minWidth: 74 },
  scoreNum: { fontWeight: 900, fontSize: 18, lineHeight: 1.1, letterSpacing: "-0.02em" },
  flowTrack: { height: 4, width: 66, marginLeft: "auto", marginTop: 4, borderRadius: 999, background: C.line, overflow: "hidden" },
  page: { minHeight: "100vh", background: C.bg, color: C.ink, fontFamily: "'Nunito', system-ui, sans-serif", display: "flex", flexDirection: "column", alignItems: "center", padding: "12px 14px 26px", WebkitTapHighlightColor: "transparent", userSelect: "none", touchAction: "manipulation" },
  modeBar: { width: BOARD_W, display: "flex", gap: 8, alignItems: "center", marginBottom: 8 },
  modeBtn: { flex: 1, background: "transparent", border: "none", borderRadius: 999, padding: "9px 8px", fontFamily: "'Nunito',sans-serif", fontWeight: 800, fontSize: 13, color: C.muted, cursor: "pointer" },
  modeOn: { background: C.card, color: C.ink, boxShadow: "0 2px 8px rgba(27,36,64,0.08)" },
  streak: { color: C.stop, fontSize: 13 },
  gear: { width: 34, height: 34, borderRadius: "50%", background: C.card, border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: "0 2px 8px rgba(27,36,64,0.08)", flexShrink: 0 },
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
  colGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 },
  colItem: { display: "flex", flexDirection: "column", alignItems: "center", gap: 4, background: C.bg, borderRadius: 14, padding: "12px 6px" },
  colName: { fontSize: 11, fontWeight: 800, color: C.muted },
  coach: { width: BOARD_W, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, background: C.coachBg, border: "none", borderRadius: 12, padding: "8px 12px", marginBottom: 8, cursor: "pointer", textAlign: "left" },
  coachText: { fontSize: 12, fontWeight: 600, color: C.ink, fontFamily: "'Nunito',sans-serif" },
  coachX: { fontSize: 12, color: C.muted, fontWeight: 800 },
  tierRow: { width: BOARD_W, display: "flex", gap: 3, marginBottom: 10 },
  tierTick: { height: 3, borderRadius: 999, transition: "background 300ms ease" },
  flowFill: { height: "100%", borderRadius: 999, background: `linear-gradient(90deg, ${C.accent}, ${C.flow})`, transition: "width 300ms cubic-bezier(.4,0,.2,1)" },
  inl: { display: "inline-flex" },
  shieldTag: { fontSize: 15, marginRight: 2 },
  zenTag: { fontSize: 10, fontWeight: 900, letterSpacing: "0.15em", color: C.go, background: "#E4F6EE", borderRadius: 999, padding: "4px 10px" },
  board: { position: "relative", width: BOARD_W, background: C.card, borderRadius: 22, padding: "12px 16px 18px", boxShadow: "0 16px 44px rgba(27,36,64,0.12), 0 2px 6px rgba(27,36,64,0.05)" },
  track: { height: 4, borderRadius: 999, background: C.line, overflow: "hidden", marginBottom: 10 },
  fill: { height: "100%", borderRadius: 999, background: C.accent, transition: "width 360ms cubic-bezier(.4,0,.2,1)" },
  viewport: { width: "100%", borderRadius: 12, overflow: "hidden", touchAction: "none", overscrollBehavior: "contain" },
  svg: { width: "100%", height: "auto", display: "block", overflow: "visible" },
  overlay: { position: "absolute", inset: 0, borderRadius: 24, background: C.overlay, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(3px)" },
  ovCard: { textAlign: "center", padding: 24, width: "100%", maxWidth: 280 },
  ovTitle: { fontWeight: 900, fontSize: 21, marginBottom: 6 },
  ovSub: { fontSize: 13, color: C.muted, marginBottom: 20, fontWeight: 600, lineHeight: 1.45 },
  primary: { display: "block", width: "100%", background: C.accent, color: "#fff", border: "none", borderRadius: 999, padding: "14px 30px", fontFamily: "'Nunito',sans-serif", fontWeight: 800, fontSize: 15, cursor: "pointer", boxShadow: "0 6px 18px rgba(47,123,246,0.32)" },
  ghost: { display: "block", width: "100%", marginTop: 8, background: "transparent", color: C.muted, border: "none", padding: 10, fontFamily: "'Nunito',sans-serif", fontWeight: 800, fontSize: 13, cursor: "pointer" },
  controls: { display: "flex", gap: 12, alignItems: "center", marginTop: 14 },
  orb: { position: "relative", width: 50, height: 50, borderRadius: "50%", background: C.card, border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: "0 4px 14px rgba(27,36,64,0.10)" },
  badge: { position: "absolute", top: -2, right: -2, minWidth: 20, height: 20, borderRadius: 999, background: C.accent, color: "#fff", fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px" },
  foot: { marginTop: 14, fontSize: 12, color: C.muted, fontWeight: 700 },
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


