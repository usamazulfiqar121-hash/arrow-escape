import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";

/* Fonts come from Google at runtime, via an @import at the top of the CSS
   block below. Nothing to install and nothing to add to the entry file, so
   this component still opens in a plain React preview. The cost is that a
   cold or offline start shows the system font until the download lands. */

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
  edge: "rgba(27,36,64,0.00)",
  sh1: "0 2px 8px rgba(27,36,64,0.07)",
  sh2: "0 6px 20px rgba(27,36,64,0.10)",
  sh3: "0 14px 36px rgba(27,36,64,0.14)",
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
  edge: "rgba(140,170,255,0.10)",
  sh1: "0 2px 10px rgba(0,0,0,0.40)",
  sh2: "0 8px 26px rgba(0,0,0,0.50)",
  sh3: "0 18px 46px rgba(0,0,0,0.60)",
};

const C = { ...LIGHT, __dark: false };

const DIRS = {
  right: { dx: 1, dy: 0, angle: 0, nx: 1, ny: 0 },
  left: { dx: -1, dy: 0, angle: 180, nx: -1, ny: 0 },
  up: { dx: 0, dy: -1, angle: -90, nx: 0, ny: -1 },
  down: { dx: 0, dy: 1, angle: 90, nx: 0, ny: 1 },
  /* Diagonals. Every board used to be an orthogonal grid of lanes, so each one
     read as the same circuit board no matter which shape it sat in. nx/ny are
     the unit vector, used for drawing so a diagonal tip is not 1.41x longer
     than a straight one. */
  upRight: { dx: 1, dy: -1, angle: -45, nx: 0.7071, ny: -0.7071 },
  downRight: { dx: 1, dy: 1, angle: 45, nx: 0.7071, ny: 0.7071 },
  downLeft: { dx: -1, dy: 1, angle: 135, nx: -0.7071, ny: 0.7071 },
  upLeft: { dx: -1, dy: -1, angle: -135, nx: -0.7071, ny: -0.7071 },
};
const DIR_NAMES = Object.keys(DIRS);
/* Piece bodies only ever bend orthogonally. Two diagonal body segments can
   cross at a shared corner without sharing a cell, which draws as an X of
   overlapping strokes — so bodies stay on the square grid and only the
   direction a piece flies out in can be diagonal. */
const ORTHO_NAMES = ["right", "left", "up", "down"];
const DIAG_NAMES = ["upRight", "downRight", "downLeft", "upLeft"];
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
  /* Set while the app is in the background. Without it, ensure() below quietly
     resumes the context on the very next sound — and every effect calls
     ensure() — so a single stray tap or timer in a backgrounded WebView undoes
     the suspend and the music comes straight back over whatever the player
     switched to. */
  let asleep = false;

  function ensure() {
    if (ctx) {
      if (ctx.state === "suspended" && !asleep) ctx.resume().catch(() => {});
      return ctx;
    }
    if (asleep) return null;
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
    // ensure() returns the existing context even while asleep, so this needs
    // its own guard — otherwise a stray call in the background restarts the
    // sequencer even though the clock is suspended.
    if (asleep) return;
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
      /* Stop the sequencer as well as the clock. ctx.suspend() pauses the audio
         clock, but the setInterval driving the chords keeps running in the
         background and keeps queueing notes, so anything that resumes the
         context finds the music already going. */
      asleep = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (ctx && ctx.state === "running") ctx.suspend().catch(() => {});
    },
    resume: () => {
      asleep = false;
      if (ctx && ctx.state === "suspended" && (sfxOn || musicOn)) ctx.resume().catch(() => {});
      // the sequencer was cleared on suspend, so bring it back if music is on
      if (musicOn && ctx && !timer) startMusic();
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
  /* Nothing narrower than about one grid cell can survive the harvest. Drawn
     as a fill it speckles; carved out it chews a hole through the very thing
     it was meant to detail — two eyes on a fourteen-cell head turned the head
     into three stripes. Features below this width are skipped instead. */
  return { n: size, ss, S, buf: new Uint8Array(S * S), minFeat: (100 / size) * 1.15 };
}
function aToS(c, v) { return (v / 100) * c.S; }
/* A carved hole needs more room than a drawn shape. A fill one cell wide still
   reads as a line; a hole one cell wide needs solid on BOTH sides to read as a
   hole at all, and when it does not it just slices the shape into stripes —
   which is what two eyes did to a narrow bear's head. So holes are held to a
   wider bar, and simply skipped on shapes too small to carry them. Detail then
   appears on the roomy shapes that can show it and stays off the ones that
   cannot, with no per-subject special-casing. */
function aTooFine(c, w, h, val) {
  const bar = val === 0 ? c.minFeat * 1.7 : c.minFeat;
  return Math.min(Math.abs(w), Math.abs(h)) < bar;
}

function aEll(c, x0, y0, x1, y1, val) {
  if (aTooFine(c, x1 - x0, y1 - y0, val)) return;
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
  if (aTooFine(c, x1 - x0, y1 - y0, val)) return;
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

/* Mirror the left half onto the right. Rasterising a symmetric drawing gives
   a nearly-symmetric grid, and "nearly" is worse than either: the eye catches
   a wheel one cell wider than its twin instantly and reads the whole shape as
   broken. Only for subjects that really are symmetric — forcing it on a
   side-on fish or car would destroy them. */
function aMirror(rows) {
  const w = rows[0].length;
  const half = Math.floor(w / 2);
  return rows.map((r) => {
    const a = [...r];
    for (let x = 0; x < half; x++) a[w - 1 - x] = a[x];
    return a.join("");
  });
}

/* Smooth the outline. The harvest leaves single-cell spikes and single-cell
   bites that no one drew — they are threshold noise, and they are most of what
   makes a generated shape look ragged next to a hand-drawn one. Fill a hollow
   that is surrounded on three sides, shave a bump that clings on by one. */
function aSmooth(rows, passes = 1) {
  let cur = rows;
  const h = cur.length, w = cur[0].length;
  const at = (g, x, y) => (x < 0 || y < 0 || x >= w || y >= h ? "." : g[y][x]);
  for (let p = 0; p < passes; p++) {
    const next = [];
    for (let y = 0; y < h; y++) {
      let line = "";
      for (let x = 0; x < w; x++) {
        let n = 0;
        if (at(cur, x - 1, y) === "#") n++;
        if (at(cur, x + 1, y) === "#") n++;
        if (at(cur, x, y - 1) === "#") n++;
        if (at(cur, x, y + 1) === "#") n++;
        const on = cur[y][x] === "#";
        // Fill only a hole boxed in on all four sides — that is unambiguous
        // threshold noise. Filling at three closed the gaps between a train's
        // wheels and merged them into one bar.
        line += on ? (n <= 1 ? "." : "#") : n === 4 ? "#" : ".";
      }
      next.push(line);
    }
    cur = next;
  }
  return cur;
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

  /* ── Everything below was added to end the repetition past level 200.
     The generated pool had only twelve subjects, so an "endless" run showed
     the same twelve over and over — less variety than the 73 hand-drawn
     boards before it. Each family varies structurally (parts present or
     absent, counts, poses), not just in scale, and each was checked to
     survive the rasteriser without losing its distinguishing pieces. ── */

  ["Rabbit", (c, r) => {
    const earLean = r() < 0.5 ? 1 : -1, earH = 28 + r() * 14, earW = 10 + r() * 5;
    // Ears reach well into the head; thin ears used to break off in the
    // rasteriser and get culled, leaving an earless blob.
    aEll(c, 36 - earLean * 4, 4, 36 + earW - earLean * 4, 4 + earH, 1);
    aEll(c, 56 + earLean * 4, 4, 56 + earW + earLean * 4, 4 + earH, 1);
    aEll(c, 32, 4 + earH - 8, 70, 64, 1);
    const bw = 17 + r() * 8;
    aEll(c, 50 - bw, 56, 50 + bw, 96, 1);
    if (r() < 0.6) aEll(c, 62 + r() * 8, 74, 84 + r() * 8, 92, 1);
    aEll(c, 39, 38, 47, 48, 0); aEll(c, 55, 38, 63, 48, 0);
    if (r() < 0.6) aEll(c, 47, 50, 55, 57, 0);
  }],

  ["Owl", (c, r) => {
    const tuft = r() < 0.65;
    if (tuft) {
      aPoly(c, [[26, 26], [32, 6], [42, 24]], 1);
      aPoly(c, [[74, 26], [68, 6], [58, 24]], 1);
    }
    aEll(c, 20, 14, 80, 60, 1);
    const bw = 20 + r() * 8;
    aEll(c, 50 - bw, 46, 50 + bw, 92, 1);
    if (r() < 0.7) { aEll(c, 50 - bw - 8, 54, 50 - bw + 6, 84, 1); aEll(c, 50 + bw - 6, 54, 50 + bw + 8, 84, 1); }
    aRect(c, 40, 90, 46, 98, 1); aRect(c, 54, 90, 60, 98, 1);
    aEll(c, 30, 26, 44, 42, 0); aEll(c, 56, 26, 70, 42, 0);
    aPoly(c, [[46, 42], [54, 42], [50, 54]], 0);
  }],

  ["Bear", (c, r) => {
    const er = 8 + r() * 5;
    aEll(c, 26 - er, 10, 26 + er, 10 + er * 2, 1);
    aEll(c, 74 - er, 10, 74 + er, 10 + er * 2, 1);
    aEll(c, 28, 14, 72, 56, 1);
    const bw = 22 + r() * 8;
    aEll(c, 50 - bw, 48, 50 + bw, 96, 1);
    if (r() < 0.55) { aEll(c, 50 - bw - 9, 58, 50 - bw + 5, 86, 1); aEll(c, 50 + bw - 5, 58, 50 + bw + 9, 86, 1); }
    aEll(c, 37, 26, 45, 35, 0); aEll(c, 55, 26, 63, 35, 0);
    aEll(c, 45, 40, 55, 50, 0);
  }],

  ["Fox", (c, r) => {
    aPoly(c, [[28, 34], [22, 6], [46, 24]], 1);
    aPoly(c, [[72, 34], [78, 6], [54, 24]], 1);
    aEll(c, 28, 20, 72, 56, 1);
    aPoly(c, [[42, 46], [58, 46], [50, 66]], 1);
    const bw = 15 + r() * 8;
    aEll(c, 50 - bw, 54, 50 + bw, 92, 1);
    const tail = r() < 0.8;
    if (tail) aEll(c, 62 + r() * 6, 62, 96, 90, 1);
    aEll(c, 37, 30, 45, 39, 0); aEll(c, 55, 30, 63, 39, 0);
  }],

  ["Whale", (c, r) => {
    const bh = 18 + r() * 10;
    aEll(c, 6, 44 - bh, 74, 44 + bh, 1);
    aPoly(c, [[66, 44], [98, 44 - bh - 10], [88, 44], [98, 44 + bh + 10]], 1);
    if (r() < 0.7) aPoly(c, [[30, 44 + bh - 4], [40, 44 + bh + 16], [54, 44 + bh - 4]], 1);
    const spout = r() < 0.6;
    if (spout) { aRect(c, 26, 44 - bh - 18, 32, 44 - bh + 2, 1); aEll(c, 18, 6, 40, 22, 1); }
    aEll(c, 16, 36, 25, 45, 0);
  }],

  ["Turtle", (c, r) => {
    const sw = 26 + r() * 10;
    aEll(c, 50 - sw, 24, 50 + sw, 78, 1);
    aEll(c, 76, 34, 98, 56, 1);
    const legs = r() < 0.5 ? 4 : 2;
    aEll(c, 22, 62, 44, 88, 1);
    aEll(c, 56, 62, 78, 88, 1);
    if (legs === 4) { aEll(c, 20, 20, 40, 42, 1); aEll(c, 60, 20, 80, 42, 1); }
    if (r() < 0.5) aRect(c, 8, 44, 26, 52, 1);
    const pl = 2 + ((r() * 2) | 0);
    for (let i = 0; i < pl; i++) { const x = 40 + i * 12; aEll(c, x - 6, 38, x + 6, 52, 0); }
    aEll(c, 44, 58, 56, 70, 0);
  }],

  ["Crab", (c, r) => {
    const bw = 24 + r() * 10;
    aEll(c, 50 - bw, 34, 50 + bw, 74, 1);
    // Arms first, so the claws are always joined to the body.
    aRect(c, 22, 30, 50 - bw + 4, 40, 1);
    aRect(c, 50 + bw - 4, 30, 78, 40, 1);
    aEll(c, 6, 14, 32, 44, 1);
    aEll(c, 68, 14, 94, 44, 1);
    const legs = 2 + ((r() * 3) | 0);
    for (let i = 0; i < legs; i++) {
      const y = 52 + i * (30 / Math.max(legs, 1));
      aRect(c, 4, y, 50 - bw + 6, y + 6, 1);
      aRect(c, 50 + bw - 6, y, 96, y + 6, 1);
    }
    if (r() < 0.6) { aRect(c, 38, 24, 44, 36, 1); aRect(c, 56, 24, 62, 36, 1); }
    aEll(c, 40, 44, 48, 53, 0); aEll(c, 54, 44, 62, 53, 0);
  }],

  ["Penguin", (c, r) => {
    aEll(c, 32, 6, 68, 42, 1);
    const bw = 20 + r() * 8;
    aEll(c, 50 - bw, 32, 50 + bw, 88, 1);
    if (r() < 0.8) { aEll(c, 50 - bw - 10, 42, 50 - bw + 4, 78, 1); aEll(c, 50 + bw - 4, 42, 50 + bw + 10, 78, 1); }
    aPoly(c, [[30, 96], [46, 86], [46, 96]], 1);
    aPoly(c, [[70, 96], [54, 86], [54, 96]], 1);
    if (r() < 0.5) aPoly(c, [[44, 22], [30, 28], [44, 32]], 1);
    aEll(c, 40, 18, 47, 26, 0); aEll(c, 55, 18, 62, 26, 0);
    if (r() < 0.6) aEll(c, 42, 48, 58, 76, 0);
  }],

  ["Elephant", (c, r) => {
    const earR = 16 + r() * 8;
    aEll(c, 14, 16, 14 + earR * 2, 16 + earR * 2.4, 1);
    aEll(c, 86 - earR * 2, 16, 86, 16 + earR * 2.4, 1);
    aEll(c, 30, 12, 70, 58, 1);
    const trunkX = 44 + r() * 12;
    aRect(c, trunkX, 50, trunkX + 10, 92, 1);
    if (r() < 0.6) aEll(c, trunkX - 6, 84, trunkX + 12, 96, 1);
    aRect(c, 26, 56, 40, 92, 1);
    aRect(c, 60, 56, 74, 92, 1);
    aEll(c, 36, 26, 44, 35, 0); aEll(c, 58, 26, 66, 35, 0);
  }],

  ["Frog", (c, r) => {
    aEll(c, 22, 10, 44, 32, 1);
    aEll(c, 56, 10, 78, 32, 1);
    const bw = 26 + r() * 10;
    aEll(c, 50 - bw, 22, 50 + bw, 78, 1);
    aEll(c, 6, 54, 34, 92, 1);
    aEll(c, 66, 54, 94, 92, 1);
    if (r() < 0.6) { aRect(c, 22, 84, 40, 92, 1); aRect(c, 60, 84, 78, 92, 1); }
    aEll(c, 28, 16, 38, 27, 0); aEll(c, 62, 16, 72, 27, 0);
  }],

  ["Snail", (c, r) => {
    const turns = 2 + ((r() * 2) | 0);
    for (let i = 0; i < turns + 1; i++) {
      const rad = 30 - i * (24 / (turns + 1));
      aEll(c, 46 - rad, 40 - rad, 46 + rad, 40 + rad, 1);
    }
    aEll(c, 40, 56, 96, 84, 1);
    aRect(c, 82, 32, 88, 62, 1);
    if (r() < 0.6) aEll(c, 78, 22, 92, 36, 1);
    aEll(c, 34, 28, 46, 40, 0);
    if (r() < 0.7) aEll(c, 52, 40, 62, 50, 0);
  }],

  ["Bee", (c, r) => {
    const bands = 3 + ((r() * 2) | 0);
    const bw = 20 + r() * 8;
    aEll(c, 50 - bw, 34, 50 + bw, 92, 1);
    aEll(c, 34, 12, 66, 42, 1);
    for (let i = 0; i < 2; i++) {
      const s = i ? 1 : -1;
      aEll(c, 50 + s * bw - 4, 26, 50 + s * (bw + 26), 56, 1);
    }
    if (r() < 0.6) { aRect(c, 40, 4, 44, 16, 1); aRect(c, 56, 4, 60, 16, 1); }
    void bands;
    const st = 2 + ((r() * 2) | 0);
    for (let i = 0; i < st; i++) { const y = 52 + i * 14; aRect(c, 50 - bw + 5, y, 50 + bw - 5, y + 6, 0); }
    aEll(c, 40, 20, 47, 28, 0); aEll(c, 54, 20, 61, 28, 0);
  }],

  ["Ladybug", (c, r) => {
    const w = 28 + r() * 10;
    aEll(c, 50 - w, 22, 50 + w, 94, 1);
    aEll(c, 36, 6, 64, 32, 1);
    if (r() < 0.7) { aRect(c, 34, 6, 40, 16, 1); aRect(c, 60, 6, 66, 16, 1); }
    const legs = r() < 0.5 ? 3 : 2;
    for (let i = 0; i < legs; i++) {
      const y = 40 + i * (36 / Math.max(legs, 1));
      aRect(c, 8, y, 50 - w + 4, y + 5, 1);
      aRect(c, 50 + w - 4, y, 92, y + 5, 1);
    }
    const sp = 2 + ((r() * 3) | 0);
    for (let i = 0; i < sp; i++) { const x = 50 + (i % 2 ? 1 : -1) * (12 + (i >> 1) * 6), y = 40 + i * 13; aEll(c, x - 5, y, x + 5, y + 10, 0); }
  }],

  ["Spider", (c, r) => {
    const br = 16 + r() * 8;
    aEll(c, 50 - br, 40 - br, 50 + br, 40 + br, 1);
    aEll(c, 50 - br * 1.3, 52, 50 + br * 1.3, 52 + br * 2, 1);
    const pairs = 3 + ((r() * 2) | 0);
    for (let i = 0; i < pairs; i++) {
      const y = 30 + i * (44 / pairs);
      aPoly(c, [[50 - br, y], [6, y - 8], [6, y], [50 - br, y + 6]], 1);
      aPoly(c, [[50 + br, y], [94, y - 8], [94, y], [50 + br, y + 6]], 1);
    }
    aEll(c, 42, 32, 49, 40, 0); aEll(c, 52, 32, 59, 40, 0);
  }],

  ["Octopus", (c, r) => {
    const hr = 24 + r() * 8;
    aEll(c, 50 - hr, 6, 50 + hr, 6 + hr * 1.8, 1);
    // Thin, unevenly long arms with real gaps between them. Fat arms at close
    // spacing merged into one slab and the octopus lost its tentacles.
    const arms = 3 + ((r() * 3) | 0);
    const span = hr * 1.05;
    for (let i = 0; i < arms; i++) {
      const x = 50 - span + ((span * 2) / Math.max(arms - 1, 1)) * i;
      const len = 20 + r() * 26;
      const top = 6 + hr * 1.3;
      aRect(c, x - 3.5, top, x + 3.5, top + len, 1);
      if (r() < 0.55) aEll(c, x - 6, top + len - 6, x + 6, top + len + 6, 1);
    }
    aEll(c, 39, 28, 47, 38, 0); aEll(c, 54, 28, 62, 38, 0);
  }],

  ["House", (c, r) => {
    const bw = 26 + r() * 10;
    aPoly(c, [[50 - bw - 8, 44], [50, 8], [50 + bw + 8, 44]], 1);
    aRect(c, 50 - bw, 42, 50 + bw, 94, 1);
    if (r() < 0.6) aRect(c, 50 + bw - 22, 14, 50 + bw - 12, 34, 1);
    if (r() < 0.7) aRect(c, 44, 66, 58, 94, 1);
    aRect(c, 50 - bw + 5, 52, 50 - bw + 18, 66, 0);
    aRect(c, 50 + bw - 18, 52, 50 + bw - 5, 66, 0);
    if (r() < 0.6) aEll(c, 42, 20, 58, 36, 0);
  }],

  ["Castle", (c, r) => {
    const towers = 2 + ((r() * 2) | 0);
    const gap = 78 / Math.max(towers - 1, 1);
    for (let i = 0; i < towers; i++) {
      const x = 11 + gap * i;
      aRect(c, x - 9, 20 + r() * 10, x + 9, 94, 1);
      if (r() < 0.6) aPoly(c, [[x - 11, 22], [x, 6], [x + 11, 22]], 1);
    }
    aRect(c, 14, 52, 86, 94, 1);
    if (r() < 0.7) aRect(c, 42, 70, 58, 94, 1);
    for (let i = 0; i < towers; i++) { const x = 11 + gap * i; aRect(c, x - 4, 40, x + 4, 52, 0); }
    aRect(c, 24, 60, 34, 72, 0); aRect(c, 66, 60, 76, 72, 0);
  }],

  ["Lighthouse", (c, r) => {
    const tw = 12 + r() * 6;
    aPoly(c, [[50 - tw, 32], [50 + tw, 32], [50 + tw + 10, 94], [50 - tw - 10, 94]], 1);
    aRect(c, 50 - tw - 4, 22, 50 + tw + 4, 34, 1);
    aRect(c, 50 - tw + 2, 10, 50 + tw - 2, 24, 1);
    if (r() < 0.6) aPoly(c, [[50 - tw, 12], [50, 2], [50 + tw, 12]], 1);
    if (r() < 0.5) aRect(c, 24, 88, 76, 96, 1);
    aRect(c, 50 - tw + 3, 12, 50 + tw - 3, 22, 0);
    aRect(c, 50 - 5, 48, 50 + 5, 60, 0);
  }],

  ["Windmill", (c, r) => {
    const tw = 11 + r() * 6;
    aPoly(c, [[50 - tw, 34], [50 + tw, 34], [50 + tw + 9, 96], [50 - tw - 9, 96]], 1);
    const blades = 3 + ((r() * 2) | 0);
    for (let i = 0; i < blades; i++) {
      const a = (i / blades) * Math.PI * 2 + r() * 0.4;
      const ex = 50 + Math.cos(a) * 40, ey = 30 + Math.sin(a) * 26;
      aPoly(c, [[50, 26], [ex, ey], [ex + 6, ey + 8], [50, 34]], 1);
    }
    aEll(c, 42, 22, 58, 38, 1);
  }],

  ["Car", (c, r) => {
    const cabin = r() < 0.6;
    aRect(c, 8, 48, 92, 76, 1);
    if (cabin) aPoly(c, [[26, 48], [36, 24], [66, 24], [76, 48]], 1);
    else aRect(c, 30, 28, 72, 50, 1);
    aEll(c, 16, 66, 38, 92, 1);
    aEll(c, 62, 66, 84, 92, 1);
    if (cabin) aPoly(c, [[32, 46], [39, 30], [61, 30], [68, 46]], 0);
    else aRect(c, 35, 32, 67, 46, 0);
    aEll(c, 22, 72, 32, 86, 0); aEll(c, 68, 72, 78, 86, 0);
  }],

  ["Train", (c, r) => {
    aRect(c, 10, 40, 78, 76, 1);
    aRect(c, 56, 18, 78, 44, 1);
    const funnel = r() < 0.7;
    if (funnel) { aRect(c, 20, 20, 32, 44, 1); aEll(c, 16, 12, 36, 26, 1); }
    const wheels = 2 + ((r() * 2) | 0);
    for (let i = 0; i < wheels; i++) {
      const x = 16 + (60 / Math.max(wheels - 1, 1)) * i;
      aEll(c, x - 11, 70, x + 11, 94, 1);
    }
    if (r() < 0.5) aRect(c, 80, 46, 94, 70, 1);
    aRect(c, 61, 24, 73, 38, 0);
    aRect(c, 18, 48, 32, 62, 0); aRect(c, 38, 48, 52, 62, 0);
  }],

  ["Plane", (c, r) => {
    const sweep = r() < 0.5 ? 1 : 0.6;
    aEll(c, 42, 6, 58, 88, 1);
    aPoly(c, [[46, 34], [4, 52 * sweep + 26], [6, 62 * sweep + 26], [46, 54]], 1);
    aPoly(c, [[54, 34], [96, 52 * sweep + 26], [94, 62 * sweep + 26], [54, 54]], 1);
    aPoly(c, [[46, 74], [26, 88], [26, 94], [46, 88]], 1);
    aPoly(c, [[54, 74], [74, 88], [74, 94], [54, 88]], 1);
    if (r() < 0.5) aEll(c, 44, 2, 56, 18, 1);
    aEll(c, 45, 20, 55, 32, 0);
  }],

  ["Sailboat", (c, r) => {
    const sails = r() < 0.5 ? 2 : 1;
    aPoly(c, [[8, 72], [92, 72], [78, 94], [22, 94]], 1);
    aRect(c, 47, 10, 53, 74, 1);
    aPoly(c, [[50, 12], [50, 68], [16, 68]], 1);
    if (sails === 2) aPoly(c, [[52, 22], [52, 68], [86, 68]], 1);
    if (r() < 0.4) aRect(c, 20, 66, 80, 74, 1);
  }],

  ["Balloon", (c, r) => {
    const w = 26 + r() * 10;
    aEll(c, 50 - w, 4, 50 + w, 4 + w * 2.2, 1);
    aPoly(c, [[50 - w * 0.6, 4 + w * 1.9], [50 + w * 0.6, 4 + w * 1.9], [50 + 10, 78], [50 - 10, 78]], 1);
    if (r() < 0.8) { aRect(c, 50 - 12, 76, 50 + 12, 94, 1); }
    else { aRect(c, 46, 76, 54, 94, 1); }
    for (let i = 0; i < 2; i++) aEll(c, 50 - w + 6 + i * (w - 4), 14, 50 - w + 16 + i * (w - 4), 4 + w * 1.7, 0);
  }],

  ["Anchor", (c, r) => {
    const ring = 10 + r() * 5;
    aEll(c, 50 - ring, 2, 50 + ring, 2 + ring * 2, 1);
    aEll(c, 50 - ring + 4, 6, 50 + ring - 4, 2 + ring * 2 - 4, 0);
    aRect(c, 44, 12, 56, 84, 1);
    aRect(c, 24, 26, 76, 36, 1);
    const flukeW = 28 + r() * 10;
    aPoly(c, [[50 - flukeW, 52], [50 - flukeW + 10, 84], [50, 94], [50 - 10, 72]], 1);
    aPoly(c, [[50 + flukeW, 52], [50 + flukeW - 10, 84], [50, 94], [50 + 10, 72]], 1);
  }],

  ["Umbrella", (c, r) => {
    const scallops = 3 + ((r() * 3) | 0);
    aEll(c, 6, 12, 94, 62, 1);
    aRect(c, 0, 44, 100, 70, 0);
    for (let i = 0; i < scallops; i++) {
      const cx = 10 + (80 / Math.max(scallops - 1, 1)) * i;
      aEll(c, cx - 12, 34, cx + 12, 56, 1);
    }
    aRect(c, 47, 44, 53, 90, 1);
    if (r() < 0.7) aEll(c, 36, 82, 54, 96, 1);
    aEll(c, 44, 84, 52, 94, 0);
  }],

  ["Lamp", (c, r) => {
    const shadeW = 28 + r() * 10;
    aPoly(c, [[50 - shadeW * 0.55, 10], [50 + shadeW * 0.55, 10], [50 + shadeW, 46], [50 - shadeW, 46]], 1);
    aRect(c, 46, 44, 54, 82, 1);
    const base = r() < 0.5;
    if (base) aEll(c, 28, 76, 72, 96, 1);
    else aPoly(c, [[30, 96], [70, 96], [60, 78], [40, 78]], 1);
    aRect(c, 50 - shadeW * 0.7, 26, 50 + shadeW * 0.7, 36, 0);
  }],

  ["Teapot", (c, r) => {
    const bw = 24 + r() * 10;
    aEll(c, 50 - bw, 34, 50 + bw, 86, 1);
    aPoly(c, [[50 + bw - 4, 44], [94, 30], [96, 40], [50 + bw - 2, 62]], 1);
    aEll(c, 50 - bw - 18, 46, 50 - bw + 6, 74, 1);
    aEll(c, 50 - bw - 10, 54, 50 - bw + 2, 66, 0);
    aRect(c, 36, 26, 64, 38, 1);
    if (r() < 0.7) aEll(c, 44, 16, 56, 30, 1);
  }],

  ["Cupcake", (c, r) => {
    const swirls = 2 + ((r() * 2) | 0);
    for (let i = 0; i < swirls; i++) {
      const w = 30 - i * 7;
      aEll(c, 50 - w, 10 + i * 14, 50 + w, 40 + i * 12, 1);
    }
    aPoly(c, [[24, 52], [76, 52], [66, 94], [34, 94]], 1);
    if (r() < 0.5) aEll(c, 45, 2, 55, 14, 1);
    for (let i = 0; i < 3; i++) aRect(c, 32 + i * 13, 58, 36 + i * 13, 88, 0);
  }],

  ["Donut", (c, r) => {
    const outer = 34 + r() * 10, inner = 10 + r() * 7;
    aEll(c, 50 - outer, 50 - outer, 50 + outer, 50 + outer, 1);
    aEll(c, 50 - inner, 50 - inner, 50 + inner, 50 + inner, 0);
    if (r() < 0.5) aEll(c, 50 - outer, 50 - outer, 50 + outer, 26, 1);
  }],

  ["Ice Cream", (c, r) => {
    const scoops = 1 + ((r() * 3) | 0);
    for (let i = 0; i < scoops; i++) {
      const w = 24 - i * 3;
      aEll(c, 50 - w, 6 + i * 16, 50 + w, 6 + i * 16 + w * 1.8, 1);
    }
    const coneTop = 12 + scoops * 18;
    aPoly(c, [[50 - 22, coneTop], [50 + 22, coneTop], [50, 96]], 1);
    for (let i = 0; i < 2; i++) aRect(c, 38 + i * 14, coneTop + 10, 44 + i * 14, coneTop + 26, 0);
  }],

  ["Apple", (c, r) => {
    const w = 28 + r() * 10;
    aEll(c, 50 - w, 22, 50 - 2, 92, 1);
    aEll(c, 50 + 2, 22, 50 + w, 92, 1);
    aEll(c, 50 - w * 0.8, 26, 50 + w * 0.8, 90, 1);
    aRect(c, 47, 6, 53, 28, 1);
    if (r() < 0.7) aEll(c, 52, 8, 78, 26, 1);
    if (r() < 0.5) aEll(c, 50 + w - 12, 40, 50 + w + 6, 62, 0);
  }],

  ["Cactus", (c, r) => {
    const tw = 11 + r() * 6;
    aRect(c, 50 - tw, 12, 50 + tw, 96, 1);
    const left = r() < 0.75, right = r() < 0.75;
    if (left) { aRect(c, 18, 40, 50, 52, 1); aRect(c, 18, 24, 30, 48, 1); }
    if (right) { aRect(c, 50, 54, 82, 66, 1); aRect(c, 70, 34, 82, 62, 1); }
    if (!left && !right) { aRect(c, 22, 46, 50, 58, 1); aRect(c, 22, 30, 34, 54, 1); }
    aRect(c, 50 - 3, 30, 50 + 3, 86, 0);
  }],

  ["Mountain", (c, r) => {
    const peaks = 2 + ((r() * 2) | 0);
    for (let i = 0; i < peaks; i++) {
      const cx = 22 + (56 / Math.max(peaks - 1, 1)) * i;
      const h = 14 + r() * 24;
      aPoly(c, [[cx - 34, 94], [cx, h], [cx + 34, 94]], 1);
    }
    if (r() < 0.5) aRect(c, 4, 88, 96, 96, 1);
  }],

  ["Cloud", (c, r) => {
    const lobes = 3 + ((r() * 3) | 0);
    const base = 66;
    for (let i = 0; i < lobes; i++) {
      const cx = 14 + (72 / Math.max(lobes - 1, 1)) * i;
      // Wide radius spread is what gives the top its bumps; uniform lobes
      // merged into a straight edge.
      const rad = 10 + r() * 22;
      aEll(c, cx - rad, base - rad * 1.9, cx + rad, base + rad * 0.25, 1);
    }
    aRect(c, 18, base - 12, 82, base + 5, 1);
  }],

  ["Star", (c, r) => {
    const pts = 5 + ((r() * 2) | 0) * 2;
    const R = 46, ir = R * (0.36 + r() * 0.14);
    const poly = [];
    for (let i = 0; i < pts * 2; i++) {
      const a = (i / (pts * 2)) * Math.PI * 2 - Math.PI / 2;
      const rad = i % 2 ? ir : R;
      poly.push([50 + Math.cos(a) * rad, 50 + Math.sin(a) * rad]);
    }
    aPoly(c, poly, 1);
  }],

  ["Heart", (c, r) => {
    const w = 24 + r() * 8;
    aEll(c, 50 - w * 2, 12, 50, 12 + w * 2, 1);
    aEll(c, 50, 12, 50 + w * 2, 12 + w * 2, 1);
    aPoly(c, [[50 - w * 2, 34], [50 + w * 2, 34], [50, 94]], 1);
  }],

  ["Moon", (c, r) => {
    const R = 44, bite = 22 + r() * 12;
    aEll(c, 50 - R, 50 - R, 50 + R, 50 + R, 1);
    aEll(c, 50 - R + bite, 50 - R - 5, 50 + R + bite, 50 + R + 5, 0);
  }],

  ["Bell", (c, r) => {
    const w = 26 + r() * 10;
    aEll(c, 50 - w, 16, 50 + w, 82, 1);
    aRect(c, 50 - w, 50, 50 + w, 80, 1);
    aRect(c, 50 - w - 8, 76, 50 + w + 8, 88, 1);
    if (r() < 0.7) aEll(c, 44, 88, 56, 98, 1);
    if (r() < 0.6) aRect(c, 46, 6, 54, 20, 1);
    aRect(c, 50 - w + 6, 60, 50 + w - 6, 70, 0);
  }],

  ["Gift", (c, r) => {
    aRect(c, 12, 34, 88, 94, 1);
    aRect(c, 8, 24, 92, 38, 1);
    // Ribbon read as a hairline at this grid size, so the box looked like a
    // plain slab. Notches are now wide enough to survive the rasteriser, and
    // stop short of the base so the two halves stay joined.
    aRect(c, 42, 20, 58, 33, 0);
    aRect(c, 40, 44, 60, 60, 0);
    aRect(c, 4, 44, 22, 58, 0);
    aRect(c, 78, 44, 96, 58, 0);
    const bow = 13 + r() * 8;
    aEll(c, 50 - bow * 2, 22 - bow, 50 - 2, 27 + bow * 0.4, 1);
    aEll(c, 50 + 2, 22 - bow, 50 + bow * 2, 27 + bow * 0.4, 1);
  }],

  ["Camera", (c, r) => {
    aRect(c, 10, 32, 90, 84, 1);
    aRect(c, 32, 20, 60, 34, 1);
    // Corners cut away and the lens always hollow — a plain filled rectangle
    // is indistinguishable from every other boxy subject.
    aPoly(c, [[10, 32], [22, 32], [10, 44]], 0);
    aPoly(c, [[90, 32], [78, 32], [90, 44]], 0);
    aPoly(c, [[10, 84], [22, 84], [10, 72]], 0);
    aPoly(c, [[90, 84], [78, 84], [90, 72]], 0);
    const lens = 15 + r() * 7;
    aEll(c, 50 - lens, 58 - lens, 50 + lens, 58 + lens, 1);
    aEll(c, 50 - lens * 0.6, 58 - lens * 0.6, 50 + lens * 0.6, 58 + lens * 0.6, 0);
    if (r() < 0.6) aRect(c, 68, 38, 84, 48, 0);
  }],

  ["Guitar", (c, r) => {
    const lower = 26 + r() * 8, upper = lower * (0.66 + r() * 0.16);
    aEll(c, 50 - lower, 52, 50 + lower, 96, 1);
    aEll(c, 50 - upper, 26, 50 + upper, 66, 1);
    aRect(c, 45, 4, 55, 40, 1);
    if (r() < 0.7) aRect(c, 41, 0, 59, 12, 1);
    if (r() < 0.6) aEll(c, 42, 58, 58, 74, 0);
    aEll(c, 41, 56, 59, 74, 0);
    aRect(c, 46, 14, 54, 22, 0);
  }],

  ["Book", (c, r) => {
    aRect(c, 10, 12, 90, 82, 1);
    aRect(c, 45, 10, 55, 78, 0);
    aRect(c, 8, 78, 92, 94, 1);
    // Page marks bite in from the outer edges only, so they can never cut a
    // cover in half.
    const pages = 2 + ((r() * 3) | 0);
    for (let i = 0; i < pages; i++) {
      const y = 26 + i * (44 / pages);
      aRect(c, 4, y, 20, y + 5, 0);
      aRect(c, 80, y, 96, y + 5, 0);
    }
  }],

  ["Clock", (c, r) => {
    const R = 36 + r() * 8;
    aEll(c, 50 - R, 50 - R, 50 + R, 50 + R, 1);
    aEll(c, 50 - R + 9, 50 - R + 9, 50 + R - 9, 50 + R - 9, 0);
    // The hands must reach into the rim, otherwise they are a separate island
    // and the largest-island cull deletes them.
    aRect(c, 46, 50 - R + 4, 54, 54, 1);
    aRect(c, 50, 46, 50 + R - 4, 54, 1);
    if (r() < 0.6) { aRect(c, 28, 50 - R - 8, 40, 50 - R + 4, 1); aRect(c, 60, 50 - R - 8, 72, 50 - R + 4, 1); }
    if (r() < 0.4) { aRect(c, 30, 50 + R - 4, 40, 50 + R + 8, 1); aRect(c, 60, 50 + R - 4, 70, 50 + R + 8, 1); }
  }],

  ["Hourglass", (c, r) => {
    const w = 26 + r() * 10;
    aRect(c, 50 - w - 6, 6, 50 + w + 6, 18, 1);
    aRect(c, 50 - w - 6, 82, 50 + w + 6, 94, 1);
    aPoly(c, [[50 - w, 16], [50 + w, 16], [50 + 5, 50], [50 - 5, 50]], 1);
    aPoly(c, [[50 - w, 84], [50 + w, 84], [50 + 5, 50], [50 - 5, 50]], 1);
    aPoly(c, [[50 - w + 5, 22], [50 + w - 5, 22], [50 + 3, 44], [50 - 3, 44]], 0);
  }],

  ["Robot", (c, r) => {
    const hw = 18 + r() * 8;
    aRect(c, 50 - hw, 14, 50 + hw, 42, 1);
    const bw = 24 + r() * 8;
    aRect(c, 50 - bw, 42, 50 + bw, 78, 1);
    aRect(c, 50 - bw - 12, 46, 50 - bw, 72, 1);
    aRect(c, 50 + bw, 46, 50 + bw + 12, 72, 1);
    aRect(c, 50 - bw + 4, 78, 50 - 6, 96, 1);
    aRect(c, 50 + 6, 78, 50 + bw - 4, 96, 1);
    if (r() < 0.6) aRect(c, 47, 4, 53, 16, 1);
    aEll(c, 50 - hw + 5, 20, 50 - 3, 32, 0); aEll(c, 50 + 3, 20, 50 + hw - 5, 32, 0);
    aRect(c, 50 - bw + 7, 50, 50 + bw - 7, 66, 0);
  }],

  ["Ghost", (c, r) => {
    const w = 28 + r() * 8;
    aEll(c, 50 - w, 6, 50 + w, 6 + w * 1.8, 1);
    aRect(c, 50 - w, 6 + w, 50 + w, 86, 1);
    // Deep notches cut up from the bottom edge give the scalloped hem. Shallow
    // ones vanished at this grid size and left a plain slab.
    const waves = 2 + ((r() * 3) | 0);
    const step = (w * 2) / waves;
    for (let i = 1; i <= waves - 1; i++) {
      const cx = 50 - w + step * i;
      aPoly(c, [[cx - step * 0.34, 100], [cx, 52], [cx + step * 0.34, 100]], 0);
    }
    aEll(c, 50 - w * 0.62, 24, 50 - w * 0.14, 48, 0);
    aEll(c, 50 + w * 0.14, 24, 50 + w * 0.62, 48, 0);
  }],

  ["Dino", (c, r) => {
    const bw = 24 + r() * 8;
    aEll(c, 50 - bw, 40, 50 + bw, 82, 1);
    aEll(c, 8, 14, 44, 44, 1);
    aRect(c, 20, 30, 40, 54, 1);
    aPoly(c, [[50 + bw - 6, 50], [96, 74], [96, 84], [50 + bw - 6, 72]], 1);
    aRect(c, 34, 74, 46, 96, 1);
    aRect(c, 56, 74, 68, 96, 1);
    if (r() < 0.6) for (let i = 0; i < 3; i++) aPoly(c, [[42 + i * 14, 42], [48 + i * 14, 26], [54 + i * 14, 42]], 1);
    aEll(c, 16, 22, 25, 31, 0);
  }],

  ["Kite", (c, r) => {
    const w = 30 + r() * 10;
    aPoly(c, [[50, 4], [50 + w, 40], [50, 78], [50 - w, 40]], 1);
    const tail = 2 + ((r() * 3) | 0);
    for (let i = 0; i < tail; i++) {
      const y = 78 + i * 7;
      aEll(c, 46 - i * 2, y, 56 + i * 2, y + 8, 1);
    }
    aEll(c, 50 - 7, 30, 50 + 7, 46, 0);
  }],

  ["Pencil", (c, r) => {
    const w = 17 + r() * 8;
    aPoly(c, [[50 - w, 26], [50 + w, 26], [50, 2]], 1);
    aRect(c, 50 - w, 24, 50 + w, 78, 1);
    // Ferrule notches and a wider eraser keep it from reading as a bare bar.
    aRect(c, 50 - w - 3, 76, 50 + w + 3, 96, 1);
    aRect(c, 50 - w - 3, 74, 50 - w + 3, 82, 0);
    aRect(c, 50 + w - 3, 74, 50 + w + 3, 82, 0);
    if (r() < 0.6) { aPoly(c, [[50 - w, 20], [50 - w + 7, 20], [50 - w + 3, 10]], 0); aPoly(c, [[50 + w, 20], [50 + w - 7, 20], [50 + w - 3, 10]], 0); }
  }],

  ["Trophy", (c, r) => {
    const w = 24 + r() * 8;
    aEll(c, 50 - w, 8, 50 + w, 56, 1);
    aRect(c, 50 - w, 8, 50 + w, 32, 1);
    if (r() < 0.8) {
      aEll(c, 50 - w - 18, 16, 50 - w + 4, 46, 1);
      aEll(c, 50 - w - 10, 24, 50 - w + 2, 38, 0);
      aEll(c, 50 + w - 4, 16, 50 + w + 18, 46, 1);
      aEll(c, 50 + w - 2, 24, 50 + w + 10, 38, 0);
    }
    aRect(c, 44, 54, 56, 76, 1);
    aRect(c, 28, 74, 72, 84, 1);
    aRect(c, 20, 84, 80, 96, 1);
    aRect(c, 50 - w + 6, 16, 50 + w - 6, 26, 0);
  }],

  ["Lantern", (c, r) => {
    const w = 22 + r() * 8;
    aRect(c, 50 - w - 7, 16, 50 + w + 7, 26, 1);
    aRect(c, 50 - w, 24, 50 + w, 80, 1);
    aRect(c, 50 - w - 7, 78, 50 + w + 7, 90, 1);
    // Panes always cut out; the side posts keep top and base joined.
    const panes = 1 + ((r() * 2) | 0);
    for (let i = 0; i < panes; i++) {
      const y0 = 32 + i * (44 / panes), y1 = y0 + 44 / panes - 6;
      aRect(c, 50 - w + 6, y0, 50 + w - 6, y1, 0);
    }
    if (r() < 0.7) aEll(c, 50 - 11, 2, 50 + 11, 20, 1);
  }],

  ["Pyramid", (c, r) => {
    const steps = 3 + ((r() * 3) | 0);
    for (let i = 0; i < steps; i++) {
      const w = 10 + (38 * (i + 1)) / steps;
      const y0 = 90 - ((i + 1) * 78) / steps, y1 = 92 - (i * 78) / steps;
      aRect(c, 50 - w, y0, 50 + w, y1, 1);
    }
    aRect(c, 44, 62, 56, 92, 0);
  }],

  ["Bicycle", (c, r) => {
    const R = 22 + r() * 6;
    aEll(c, 4, 68 - R, 4 + R * 2, 68 + R, 1);
    aEll(c, 96 - R * 2, 68 - R, 96, 68 + R, 1);
    aEll(c, 12, 68 - R + 8, 4 + R * 2 - 8, 68 + R - 8, 0);
    aEll(c, 96 - R * 2 + 8, 68 - R + 8, 88, 68 + R - 8, 0);
    // Bottom bar joins the two wheels. Without it the frame sometimes missed a
    // wheel and half the bicycle was culled away.
    aRect(c, 4 + R, 64, 96 - R, 72, 1);
    aPoly(c, [[4 + R, 62], [48, 32], [58, 38], [4 + R + 10, 70]], 1);
    aPoly(c, [[96 - R, 62], [48, 32], [58, 38], [96 - R - 10, 70]], 1);
    if (r() < 0.6) aRect(c, 38, 26, 62, 34, 1);
  }],

  ["Dolphin", (c, r) => {
    const bh = 16 + r() * 8;
    aEll(c, 8, 44 - bh, 76, 44 + bh, 1);
    aPoly(c, [[40, 44 - bh + 4], [54, 44 - bh - 22], [64, 44 - bh + 4]], 1);
    aPoly(c, [[68, 44], [98, 26], [88, 44], [98, 66]], 1);
    aPoly(c, [[26, 44 + bh - 4], [34, 44 + bh + 18], [48, 44 + bh - 2]], 1);
    if (r() < 0.6) aEll(c, 2, 40, 20, 54, 1);
    aEll(c, 16, 38, 25, 47, 0);
  }],
];

/* Subjects seen head-on, where the two halves really do match. Everything not
   listed is drawn side-on (fish, car, train, guitar, crescent moon) and is
   left exactly as rasterised. */
const SYMMETRIC = new Set([
  "Cat", "Dog", "Tree", "Flower", "Vessel", "Crown", "Rocket", "Mushroom",
  "Butterfly", "Owl", "Bear", "Fox", "Frog", "Bee", "Ladybug", "Spider",
  "Octopus", "Penguin", "Elephant", "Turtle", "Crab", "Rabbit", "House",
  "Castle", "Lighthouse", "Balloon", "Umbrella", "Lamp", "Cupcake", "Donut",
  "Ice Cream", "Apple", "Cactus", "Cloud", "Star", "Heart", "Bell", "Gift",
  "Robot", "Ghost", "Kite", "Trophy", "Lantern", "Pyramid", "Hourglass",
  "Clock", "Camera", "Book", "Plane", "Anchor", "Pencil",
]);

const ART_ADJ = ["Little", "Broad", "Tall", "Round", "Slim", "Wide", "Bold", "Fine", "Grand", "Neat",
                 "Quiet", "Bright", "Old", "Young", "Proud", "Soft", "Sharp", "Deep", "Pale", "Warm"];

/* Picking a family at random let the same subject land on back-to-back levels
   and left others unseen for ages. Walk a shuffled rotation instead: every
   subject appears once before any repeats, and the order changes each lap. */
function familyOrder(lap) {
  const order = ART_FAMILIES.map((_, i) => i);
  const r = mulberry32(lap * 6367 + 41);
  for (let i = order.length - 1; i > 0; i--) {
    const j = (r() * (i + 1)) | 0;
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

function artMask(seed) {
  const n = ART_FAMILIES.length;
  const pos = ((seed % n) + n) % n;
  const lap = Math.floor(seed / n);
  for (let attempt = 0; attempt < 12; attempt++) {
    const r = mulberry32(seed * 2654435761 + attempt * 97);
    // Attempt 0 takes the rotation's turn. Retries step BACKWARDS, into
    // subjects already used, because stepping forwards borrowed the next
    // level's turn and that was the cause of almost every repeat in a row.
    const [name, draw] = ART_FAMILIES[familyOrder(lap)[((pos - attempt) % n + n) % n]];
    const size = 18 + ((r() * 9) | 0);
    const c = ArtCanvas(size, 3);
    draw(c, r);
    let grid = aHarvest(c, 0.42);
    if (SYMMETRIC.has(name)) grid = aMirror(grid);
    grid = aSmooth(grid);
    const m = aTidy(grid);
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

/* An exit lane. With deflectors on the board a lane is no longer a straight
   ray: it turns 90° at each one, so reading a board becomes tracing a path
   rather than sighting down a line.

   A deflector reflects the direction vector — "/" sends (dx,dy) to (-dy,-dx),
   "\" sends it to (dy,dx). That one rule covers all eight directions: a
   diagonal running parallel to the mirror passes straight through, and a
   perpendicular one is turned back.

   Turning back can loop forever between two mirrors, so the walk remembers
   every cell-and-direction it has been in. Revisiting one means the arrow can
   never leave, and the caller gets null. */
function exitLine(head, d, cols, rows, mirrors) {
  const out = [];
  let cur = head;
  let dir = d;
  const seen = mirrors && mirrors.size ? new Set() : null;
  for (;;) {
    const D = DIRS[dir];
    cur = step(cur, D.dx, D.dy, cols, rows);
    if (cur === null) return out;          // off the board — escaped
    out.push(cur);
    if (!seen) continue;
    const m = mirrors.get(cur);
    if (m) {
      const key = cur * 8 + DIR_NAMES.indexOf(dir);
      if (seen.has(key)) return null;      // caught in a loop, never escapes
      seen.add(key);
      const D2 = DIRS[dir];
      dir = dirFromVec(m === "/" ? -D2.dy : D2.dy, m === "/" ? -D2.dx : D2.dx);
      if (!dir) return null;
    }
  }
}

const VEC_TO_DIR = (() => {
  const m = new Map();
  for (const n of DIR_NAMES) m.set(DIRS[n].dx * 3 + DIRS[n].dy, n);
  return m;
})();
function dirFromVec(dx, dy) {
  return VEC_TO_DIR.get(dx * 3 + dy) || null;
}

/* Where a piece's body would start, growing backwards from its head. Bodies are
   always orthogonal, so a diagonal exit reports whichever of its two orthogonal
   components is open. */
function orthoBack(head, D, cols, rows) {
  if (!(D.dx && D.dy)) return step(head, -D.dx, -D.dy, cols, rows);
  return step(head, -D.dx, 0, cols, rows) ?? step(head, 0, -D.dy, cols, rows);
}

/* Three mechanics turn up long after the four-step tutorial has finished and
   none of them announced itself: diagonals just pointed a new way, sealed
   arrows just faded out, deflectors just bent a path. Each gets one line,
   once, on the first board it appears on. Listed in the order the player
   meets them — diagonals around level 15, seals around 21, deflectors 29. */
const MECHANIC_TIPS = [
  { key: "diag", text: "Arrows can travel diagonally now. Hold one to trace where it will go." },
  { key: "seal", text: "Faded arrows are sealed shut. One opens only after the arrow it waits on has gone." },
  { key: "mirror", text: "A bar turns an arrow ninety degrees. Its way out bends — hold it to follow the path." },
];

const EMPTY_MIRRORS = new Map();

/* Scatter deflectors across the shape. They sit on cells that hold no arrow,
   spaced apart so a board reads as a few landmarks rather than confetti. */
function placeMirrors(mask, count) {
  const out = new Map();
  if (!count) return out;
  const { cols, rows, cells } = mask;
  const pool = [...cells].filter((c) => {
    const x = c % cols, y = Math.floor(c / cols);
    return x > 0 && y > 0 && x < cols - 1 && y < rows - 1;
  });
  let guard = 0;
  while (out.size < count && pool.length && guard++ < 400) {
    const c = pool[(RND() * pool.length) | 0];
    if (out.has(c)) continue;
    const x = c % cols, y = Math.floor(c / cols);
    let tooClose = false;
    for (const o of out.keys()) {
      if (Math.abs((o % cols) - x) + Math.abs(Math.floor(o / cols) - y) < 4) { tooClose = true; break; }
    }
    if (tooClose) continue;
    out.set(c, RND() < 0.5 ? "/" : "\\");
  }
  return out;
}

function buildBoard(mask, { maxLen, coverage, tightness, pieces: target, diag }, mirrors) {
  const MIR = mirrors && mirrors.size ? mirrors : null;
  // Diagonals arrive gradually: `diag` is how many of the four are in play at
  // this tier, so early boards stay purely orthogonal and later ones open up.
  const EXITS = ORTHO_NAMES.concat(DIAG_NAMES.slice(0, Math.max(0, Math.min(4, diag | 0))));
  const { cols, rows, cells } = mask;
  const occupied = new Map();
  const laneLoad = new Map(); // cell -> how many placed arrows must pass through it
  const pieces = [];
  // Deflector cells are part of the shape but hold no arrow.
  const all = MIR ? [...cells].filter((c) => !MIR.has(c)) : [...cells];
  const free0 = all.length;
  const fillTarget = Math.round(free0 * coverage);
  const BANDS = [[0.6, 0.9], [0.9, 1.2], [1.2, 1.6], [1.6, 2.2]];
  // average snake length needed to cover the shape in `target` arrows
  const avgLen = Math.min(maxLen, Math.max(3.2, (fillTarget / Math.max(target || 40, 6)) * 1.45));
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
    // Boards used to be built by filling space, never by making arrows obstruct
    // each other, so nearly half the board was tappable at any moment and there
    // was nothing to work out. Prefer cells that sit inside an existing arrow's
    // exit lane: every one placed there is a move the player cannot yet make.
    let head = free[(RND() * free.length) | 0];
    let headScore = -1;
    const samples = Math.min(free.length, 14);
    for (let t = 0; t < samples; t++) {
      const cand = free[(RND() * free.length) | 0];
      const sc = (laneLoad.get(cand) || 0) * 6 + edgeDist(cand);
      if (sc > headScore) {
        headScore = sc;
        head = cand;
      }
    }
    let options = [];
    for (const d of EXITS) {
      const lane = exitLine(head, d, cols, rows, MIR);
      if (lane === null) continue;              // bends into a loop, never escapes
      // A deflected lane can curve back onto the cell it started from. The
      // arrow would then be blocked by its own head for ever, which no amount
      // of play can clear.
      if (MIR && lane.includes(head)) continue;
      if (lane.some((c) => occupied.has(c))) continue;
      const D0 = DIRS[d];
      // A diagonal cell spans 1.41x the distance of an orthogonal one, so a
      // 5-cell diagonal lane crosses as much board as a 7-cell straight one.
      // Comparing raw cell counts made diagonals lose every sort.
      const span = lane.length * (D0.dx && D0.dy ? Math.SQRT2 : 1);
      // How far the lane runs inside the shape before leaving it. Favouring
      // this makes lanes follow the subject's own limbs, so a rocket fills
      // with vertical runs and a fish with horizontal ones — the silhouette
      // finally shapes the puzzle instead of just framing it.
      let inShape = 0;
      for (const c of lane) { if (!cells.has(c)) break; inShape++; }
      const back = orthoBack(head, D0, cols, rows);
      options.push({ d, len: span + inShape * 0.9, grow: back !== null && cells.has(back) && !occupied.has(back) });
    }
    if (!options.length) {
      fails++;
      continue;
    }
    // when space runs short, stop insisting the body can grow
    if (fails < 150 && options.some((o) => o.grow)) options = options.filter((o) => o.grow);
    options.sort((a, b) => b.len - a.len);
    const chosen = RND() < tightness ? options[0] : options[(RND() * options.length) | 0];
    const D = DIRS[chosen.d];
    const chosenLane = exitLine(head, chosen.d, cols, rows, MIR);
    const ownLane = new Set(chosenLane);

    const body = [head];
    const used = new Set([head]);
    // size classes — a board of all-same-length snakes reads flat and easy
    // early = long runs while there is space, later = shorter fillers.
    // repeated failures mean the board is tight, so shrink further.
    const prog = filled / fillTarget;
    const squeeze = fails > 260 ? 0.3 : fails > 150 ? 0.55 : fails > 60 ? 0.8 : 1;
    const band = BANDS[Math.max(0, Math.min(3, Math.floor((1 - prog) * 4 + (RND() * 1.4 - 0.7))))];
    const want = Math.max(1, Math.min(maxLen,
      Math.round(avgLen * squeeze * (band[0] + RND() * (band[1] - band[0])))));

    /* The body grows backwards from the head. For an orthogonal exit that is
       simply the opposite direction; for a diagonal one, straight back would
       be a diagonal body segment, so take either of the two orthogonal
       components instead. */
    const backOpts = (D.dx && D.dy)
      ? [{ dx: -D.dx, dy: 0 }, { dx: 0, dy: -D.dy }]
      : [{ dx: -D.dx, dy: -D.dy }];
    const okBack = (b) => {
      const t = step(head, b.dx, b.dy, cols, rows);
      if (t === null || !cells.has(t) || occupied.has(t) || ownLane.has(t)) return null;
      return MIR && MIR.has(t) ? null : t;
    };
    const viable = backOpts.filter((b) => okBack(b) !== null);
    const canGrow = viable.length > 0;
    // a dot-sized arrow wastes a cell; hold out while there is still room
    if (want > 1 && !canGrow && fails < 200) {
      fails++;
      continue;
    }
    if (want > 1 && canGrow) {
      const b = viable[(RND() * viable.length) | 0];
      const back = okBack(b);
      {
        body.push(back);
        used.add(back);
        let cur = back;
        let run = { dx: b.dx, dy: b.dy };   // direction the body is travelling
        while (body.length < want) {
          const open = [];
          for (const nm of ORTHO_NAMES) {
            const d = DIRS[nm];
            const nx = step(cur, d.dx, d.dy, cols, rows);
            if (nx === null || !cells.has(nx) || occupied.has(nx) || used.has(nx) || ownLane.has(nx)) continue;
            if (MIR && MIR.has(nx)) continue;
            open.push({ nx, d });
          }
          if (!open.length) break;
          const straight = open.find((o) => o.d.dx === run.dx && o.d.dy === run.dy);
          // keep going straight most of the time — bends become deliberate, not noise
          const pick = straight && RND() < 0.84 ? straight : open[(RND() * open.length) | 0];
          cur = pick.nx;
          run = { dx: pick.d.dx, dy: pick.d.dy };
          body.push(cur);
          used.add(cur);
        }
      }
    }
    // Same hazard for the body: a bent lane crossing its own tail would block
    // the arrow permanently. Cheap to check, and a rejected piece just retries.
    if (MIR && body.some((c) => ownLane.has(c))) {
      fails++;
      continue;
    }
    const id = pieces.length;
    body.forEach((c) => occupied.set(c, id));
    for (const c of chosenLane) laneLoad.set(c, (laneLoad.get(c) || 0) + 1);
    pieces.push({ id, cells: body, dir: chosen.d });
    filled += body.length;
    fails = 0;
  }
  return pieces;
}

function measureBoard(pieces, cols, rows, mirrors) {
  if (!pieces.length) return { freedom: 1, forced: 0 };
  const lanes = pieces.map((p) => exitLine(p.cells[0], p.dir, cols, rows, mirrors) || []);
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


// blow a hand-drawn shape up so the same outline holds far more arrows —
// an 11x11 sketch only has room for a handful otherwise
function scaleMask(mask, k) {
  if (k <= 1) return mask;
  const cols = mask.cols * k;
  const rows = mask.rows * k;
  const cells = new Set();
  for (const i of mask.cells) {
    const x = (i % mask.cols) * k;
    const y = Math.floor(i / mask.cols) * k;
    for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) cells.add((y + dy) * cols + x + dx);
  }
  return { ...mask, cols, rows, cells };
}

// A shape hashes to one stable number, so the same drawing — or the same shared
// code on someone else's phone — always produces the same puzzle.
function maskSeed(m) {
  let h = 2166136261;
  h = Math.imul(h ^ m.cols, 16777619);
  h = Math.imul(h ^ m.rows, 16777619);
  for (const i of [...m.cells].sort((a, b) => a - b)) h = Math.imul(h ^ i, 16777619);
  return (h >>> 0) || 1;
}

function makeLevelFromMask(rawMask, tierIdx = 7) {
  const idx = Math.max(0, Math.min(TIERS.length - 1, tierIdx | 0));
  const tier = TIERS[idx];
  const norm = { ...rawMask, cells: new Set([...rawMask.cells].sort((a, b) => a - b)) };
  RND = mulberry32(maskSeed(norm));
  // pack a drawn shape as full as the tier allows before building
  const room = norm.cells.size ? Math.sqrt(tier.maxCells / norm.cells.size) : 1;
  const mask = fitMask(scaleMask(norm, Math.max(1, Math.min(4, Math.floor(room)))), tier.maxCells);
  const chessWeight = idx >= HARD_TIER ? 0.9 : 0;
  const weave = texturedTier(tier, maskSeed(norm));
  const mirrors = placeMirrors(mask, weave.mirrors || 0);
  let best = null;
  for (let i = 0; i < (mask.cells.size > 240 ? 3 : 6); i++) {
    const pieces = buildBoard(mask, weave, mirrors);
    if (pieces.length < 3) continue;
    const mb = measureBoard(pieces, mask.cols, mask.rows, mirrors);
    const fill = pieces.reduce((a, p) => a + p.cells.length, 0) / mask.cells.size;
    // prefer the target openness, reward boards with more forced moments, and
    // heavily punish a board that leaves the shape half empty
    const gap = Math.abs(mb.freedom - tier.freedom) - mb.forced * 0.35 + Math.max(0, tier.coverage - 0.06 - fill) * 4
      - (chessWeight ? chessScore(pieces, mask.cols, mask.rows, mirrors) * chessWeight : 0);
    if (!best || gap < best.gap) best = { pieces, gap };
  }
  if (!best) best = { pieces: buildBoard(mask, weave, mirrors), gap: 1 };
  assignLocks(best.pieces, mask.cols, mask.rows, lockRatio(idx), mirrors);
  RND = Math.random;
  return {
    mask, pieces: best.pieces, tier, tierIndex: idx, stepInTier: 1, mirrors,
    hearts: tier.hearts, hints: tier.hints, undos: tier.undos,
  };
}

/* ── chess-style position evaluation ──────────────────────────────
   From Hard upward a board should not just be tight, it should contain
   real combinations: stretches where only one arrow is playable, so the
   solution reads like a forced line rather than a pile of free choices.
   We solve the board a few times and score how often the position forces
   the player's hand, and how long those forced runs get.               */
// Some arrows are sealed shut until a particular other arrow has left. Locks are
// handed out along a real solve order — a sealed arrow always depends on one that
// comes before it — so a board with locks stays solvable by construction.
function assignLocks(pieces, cols, rows, ratio, mirrors) {
  if (ratio <= 0 || pieces.length < 8) return;
  const lanes = pieces.map((p) => exitLine(p.cells[0], p.dir, cols, rows, mirrors) || []);
  const owner = new Map();
  pieces.forEach((p) => p.cells.forEach((c) => owner.set(c, p.id)));
  const alive = new Set(pieces.map((p) => p.id));
  const isFree = (id) =>
    lanes[id].every((c) => {
      const o = owner.get(c);
      return o === undefined || !alive.has(o);
    });

  const order = [];
  while (alive.size) {
    const free = [...alive].filter(isFree);
    if (!free.length) return; // not a clean board — leave it alone
    const pick = free[(RND() * free.length) | 0];
    order.push(pick);
    alive.delete(pick);
  }

  const byId = new Map(pieces.map((p) => [p.id, p]));
  const first = Math.max(2, Math.floor(order.length * 0.22)); // the opening stays free
  const room = order.length - first;
  const want = Math.min(Math.round(order.length * ratio), room);
  if (want < 1) return;
  const stride = Math.max(1, Math.floor(room / want));
  for (let n = 0, i = first; n < want && i < order.length; n++, i += stride) {
    const p = byId.get(order[i]);
    if (!p) continue;
    const back = 1 + ((RND() * Math.min(i, 6)) | 0); // depends on a recent earlier arrow
    p.needs = order[Math.max(0, i - back)];
  }
}

function chessScore(pieces, cols, rows, mirrors) {
  if (pieces.length < 6) return 0;
  const lanes = pieces.map((p) => exitLine(p.cells[0], p.dir, cols, rows, mirrors) || []);
  const owner = new Map();
  pieces.forEach((p) => p.cells.forEach((c) => owner.set(c, p.id)));

  let total = 0;
  const RUNS = 3;
  for (let r = 0; r < RUNS; r++) {
    const alive = new Set(pieces.map((p) => p.id));
    const isFree = (id) =>
      lanes[id].every((c) => {
        const o = owner.get(c);
        return o === undefined || !alive.has(o);
      });
    let only = 0;      // positions with exactly one legal move
    let near = 0;      // positions with two
    let run = 0;
    let bestRun = 0;
    let states = 0;
    while (alive.size) {
      const free = [...alive].filter(isFree);
      if (!free.length) return 0; // unsolvable ordering — never reward it
      states++;
      if (free.length === 1) { only++; run++; if (run > bestRun) bestRun = run; }
      else { if (free.length === 2) near++; run = 0; }
      alive.delete(free[(RND() * free.length) | 0]);
    }
    if (!states) return 0;
    // a long forced line is worth far more than the same count scattered about
    total += (only / states) + (near / states) * 0.4 + Math.min(bestRun, 8) / 8 * 0.6;
  }
  return total / RUNS;
}

// The first minute decides whether anyone plays a second one. Levels 1-4 are
// deliberately small and open — a new player clears one in under a minute and
// learns the rule by winning, not by reading. By level 5 the real curve begins.
const INTRO = [
  { cells: 0.30, pieces: 0.34, freedom: 2.1 },
  { cells: 0.44, pieces: 0.48, freedom: 1.7 },
  { cells: 0.60, pieces: 0.64, freedom: 1.4 },
  { cells: 0.80, pieces: 0.82, freedom: 1.15 },
];

function introTier(tier, level) {
  const f = INTRO[level - 1];
  if (!f) return tier;
  return {
    ...tier,
    maxCells: Math.max(40, Math.round(tier.maxCells * f.cells)),
    pieces: Math.max(8, Math.round(tier.pieces * f.pieces)),
    freedom: Math.min(0.34, tier.freedom * f.freedom),
    tightness: Math.max(0.5, tier.tightness - 0.14),
  };
}

function makeLevel(level, seed) {
  // a level number must always rebuild the same board — otherwise replaying it
  // from the Levels list hands the player a different puzzle
  RND = mulberry32(seed !== undefined ? seed : level * 9176 + 17);
  const { tier: baseTier, index, step: stepInTier } = tierFor(level);
  const tier = seed === undefined ? introTier(baseTier, level) : baseTier;
  const raw =
    seed === undefined && level > CURATED_UNTIL
      ? artMask(level) || proceduralMask(level)
      : parseMask(curatedKey(seed !== undefined ? (seed % 9973) + 1 : level));
  /* fitMask only ever shrinks. A compact shape therefore built a board a
     fraction of the usual size — the plain geometric ones came out at eight
     arrows where the levels either side had forty, which reads as a broken
     level rather than an easy one. Scale a small shape up to the tier's budget
     first, the same way a hand-drawn board from Studio is scaled. */
  const room = raw.cells.size ? Math.sqrt(tier.maxCells / raw.cells.size) : 1;
  const mask = fitMask(scaleMask(raw, Math.max(1, Math.min(4, Math.floor(room)))), tier.maxCells);
  // Hard and above are judged like chess positions, and get extra candidate
  // boards to choose from — the generator plays out more lines before deciding
  const chessWeight = index >= HARD_TIER ? 0.9 : 0;
  let tries = mask.cells.size > 240 ? 2 : mask.cells.size > 90 ? 4 : 7;
  if (chessWeight && mask.cells.size <= 420) tries += 2;

  const weave = texturedTier(tier, seed !== undefined ? seed : level);
  const mirrors = placeMirrors(mask, weave.mirrors || 0);
  let best = null;
  for (let i = 0; i < tries; i++) {
    const pieces = buildBoard(mask, weave, mirrors);
    if (pieces.length < 3) continue;
    const mb = measureBoard(pieces, mask.cols, mask.rows, mirrors);
    const fill = pieces.reduce((a, p) => a + p.cells.length, 0) / mask.cells.size;
    // prefer the target openness, reward boards with more forced moments, and
    // heavily punish a board that leaves the shape half empty
    const gap = Math.abs(mb.freedom - tier.freedom) - mb.forced * 0.35 + Math.max(0, tier.coverage - 0.06 - fill) * 4
      - (chessWeight ? chessScore(pieces, mask.cols, mask.rows, mirrors) * chessWeight : 0);
    if (!best || gap < best.gap) best = { pieces, gap };
  }
  if (!best) best = { pieces: buildBoard(mask, weave, mirrors), gap: 1 };
  assignLocks(best.pieces, mask.cols, mask.rows, lockRatio(index), mirrors);
  RND = Math.random;

  return { mask, pieces: best.pieces, tier, tierIndex: index, stepInTier, mirrors, hearts: tier.hearts, hints: tier.hints, undos: tier.undos };
}

/* Every board was woven the same way — same coverage, same snake-length spread,
   same tightness — so two levels of the same tier played identically even in
   different shapes. A seeded texture varies the weave while the tier keeps
   owning difficulty, and the board-selection loop below still scores every
   candidate against the tier's freedom target. */
const TEXTURES = [
  { name: "dense",    coverage: +0.00, lenMul: 1.00, tightness: +0.00 },
  { name: "open",     coverage: -0.07, lenMul: 0.95, tightness: -0.06 },
  { name: "long",     coverage: +0.00, lenMul: 1.45, tightness: +0.03 },
  { name: "swarm",    coverage: -0.02, lenMul: 0.60, tightness: -0.03 },
  { name: "tangled",  coverage: -0.03, lenMul: 1.15, tightness: -0.10 },
];

function texturedTier(tier, seed) {
  const t = TEXTURES[Math.abs(seed * 2654435761 + 17) % TEXTURES.length];
  return {
    ...tier,
    coverage: Math.max(0.72, Math.min(0.99, tier.coverage + t.coverage)),
    tightness: Math.max(0.45, Math.min(0.97, tier.tightness + t.tightness)),
    maxLen: Math.max(3, Math.round(tier.maxLen * t.lenMul)),
    texture: t.name,
  };
}

/* how many arrows a removal sets free — the heart of chain scoring */
function countFreed(pieces, aliveSet, removedId, cols, rows, mirrors) {
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
    for (const c of exitLine(p.cells[0], p.dir, cols, rows, mirrors) || []) {
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

/* The Home card and the Levels list both call this on every render, and each
   call rasterises a whole artwork. Cache it — the result never changes. */
const chapterCache = new Map();

function chapterInfo(ch) {
  const hit = chapterCache.get(ch);
  if (hit) return hit;
  const m = artMask(ch * 977 + 13) || proceduralMask(ch * 977 + 13);
  const info = {
    ch,
    from: (ch - 1) * CHAPTER_LEN + 1,
    to: ch * CHAPTER_LEN,
    name: m ? m.name : `Chapter ${ch}`,
    mask: m,
    hue: TIER_HUE[(ch - 1) % TIER_HUE.length],
  };
  chapterCache.set(ch, info);
  return info;
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

const SAVE_KEY = "arrowv2:save";  // unchanged on purpose — renaming it would wipe every player's progress

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
       hideBanner:        ()     => Promise<void>,    // called once ads are removed
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
  async hideBanner() {
    try {
      if (Ads.provider?.hideBanner) await Ads.provider.hideBanner();
    } catch {}
  },
};

/* Deliberately quiet. The reviews of every rival in this genre are dominated by
   ad complaints, so an interstitial needs BOTH gaps to pass, never appears
   after a loss, and never during the tutorial. */
const AD_EVERY_LEVELS = 8;
const AD_MIN_GAP_MS = 210000;
const AD_REMOVAL_GOAL = 30; // rewarded views to earn permanent ad removal, free

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
  owlArt: { name: "Owl", rows: ["..##......##...", ".####....####..", "..#############", ".##############", "###############", "###############", "##.####.####.##", "##.#..#.#..#.##", "##.####.####.##", "###############", "#######.#######", "######...######", "###############", "###############", ".#############.", ".#############.", "..###########..", "...#########...", "...###...###...", "..####...####.."] },
  whaleArt: { name: "Whale", rows: ["...........###...", "..........####...", ".........#####...", "..#####..#####...", ".#########.......", "###############..", "#################", "#################", "#################", "#################", "#################", ".###############.", ".##############..", "..############...", "...#########.....", "....#######......", "...####..####....", "..####....####..."] },
  cactusArt: { name: "Cactus", rows: ["......####......", "......####......", "###...####...###", "####..####..####", "####..####..####", "####..####..####", "####..####..####", "#############.##", "################", "################", "..####..####..##", "......####......", "......####......", "......####......", "......####......", "......####......", "....########....", "..############..", ".##############.", ".##############."] },
  boltArt: { name: "Bolt", rows: ["........####", ".......#####", "......######", ".....#######", "....########", "...#########", "..#########.", ".#########..", "###########.", "############", "#########...", "########....", ".#######....", "..######....", "...#####....", "....####....", ".....###....", "......##....", "......##....", ".......#...."] },
  crabArt: { name: "Crab", rows: ["##..........##..", "###........###..", ".###......###...", "..####..####....", "...##########...", "..############..", ".##############.", "################", "################", "##.##########.##", "##.##########.##", "################", ".##############.", "..############..", "..##..####..##..", ".###...##...###.", "###.........###.", "##...........##."] },
  penguinArt: { name: "Penguin", rows: ["....######....", "...########...", "..##########..", "..##########..", "..#.######.#..", "..##########..", "...###..###...", "....######....", ".#############", "##############", "###########..#", "####....####..", "####....####..", "####....####..", "####....####..", "####....####..", "#####..#####..", "############..", ".##########...", "###......###.."] },
  lighthouseArt: { name: "Lighthouse", rows: [".....####.....", "....######....", "...########...", "..##########..", "..#.######.#..", "..##########..", "...########...", "....######....", "....######....", "...########...", "...##....##...", "...########...", "...##....##...", "...########...", "..##########..", "..##########..", ".############.", ".############.", "##############", "##############"] },
  bearArt: { name: "Bear", rows: [".###......###.", "####......####", "####......####", ".############.", "##############", "##############", "##.########.##", "##.########.##", "##############", "#####.##.#####", "######..######", "##############", ".############.", ".############.", "..##########..", "..####..####..", ".####....####.", ".###......###."] },
  flowerArt: { name: "Flower", rows: ["....####....", "...######...", "..########..", "..########..", "###......###", "####....####", "####....####", "###......###", "..########..", "..########..", "...######...", "....####....", ".....##.....", ".....##.....", "..####......", ".#####......", ".....##.....", ".....##.....", "......#####.", "......#####.", ".....##.....", ".....##....."] },
  cameraArt: { name: "Camera", rows: [".....######.....", ".....######.....", ".....######.....", "################", "################", "###..######..###", "##....####....##", "##...######...##", "##..########..##", "##..########..##", "##..########..##", "##...######...##", "##....####....##", "###..######..###", "################", "################"] },
  boatArt: { name: "Sailboat", rows: [".......##.......", ".......###......", ".......####.....", ".......#####....", "....########....", "...#########....", "..##########....", ".###########....", ".......##.......", ".......##.......", "################", "################", ".##############.", "..############..", "...##########...", "....########...."] },
  dinoArt: { name: "Dino", rows: ["...........#####", "..........######", "..........##.###", "..........######", "..........#####.", "..........####..", ".#####..######..", "..###########...", "..###########...", "#############...", "#############...", ".############...", ".###########....", ".##########.....", ".#####.####.....", ".####..####.....", ".####..####.....", "####...####.....", "####...#####...."] },
  beeArt: { name: "Bee", rows: ["..##......##..", "..###....###..", "...##....##...", "....######....", "...########...", "..##########..", "..##########..", "##############", "##############", "##############", "##############", "##############", "##############", ".############.", ".############.", "..##########..", "...########...", "....######....", ".....####.....", "......##......"] },
  castleArt: { name: "Castle", rows: ["##..##..##..##", "##..##..##..##", "##############", "##############", "##############", "##.###..###.##", "##.###..###.##", "##############", "##############", "##############", "##############", "#####....#####", "####......####", "####......####", "####......####", "####......####", "####......####", "##############", "##############"] },
  ghostArt: { name: "Ghost", rows: ["....######....", "..##########..", ".############.", "##############", "##############", "##.##....##.##", "##.##....##.##", "##############", "##############", "##############", "##############", "##############", "##############", "##############", "##############", "##############", "###.###.###.##", "##..##..##..##"] },
  iceArt: { name: "Ice Cream", rows: ["....######....", "..##########..", ".############.", "##############", "##############", "##############", "##############", ".############.", "..##########..", "..##########..", "...########...", "...########...", "....######....", "....######....", ".....####.....", ".....####.....", "......##......", "......##......"] },
  turtleArt: { name: "Turtle", rows: ["....########....", "..############..", ".##############.", "################", "################", "###.########.###", "###.########.###", "################", "################", "################", "################", ".##############.", "..############..", "...##########...", "..############..", ".####......####.", ".###........###."] },
  robotArt: { name: "Robot", rows: ["...##....##...", "...##....##...", "..##########..", ".############.", "##############", "##.##....##.##", "##.##....##.##", "##############", "####......####", "##############", "##############", "..##########..", "##############", "##############", "##############", "##############", "..##########..", "..####..####..", "..####..####..", "..####..####..", ".#####..#####."] },
  balloonArt: { name: "Balloon", rows: ["....######....", "..##########..", ".############.", "##############", "##############", "##############", "##############", "##############", ".############.", ".############.", "..##########..", "...########...", "....######....", ".....####.....", "......##......", "......##......", ".....###......", "......###.....", ".....###......", "......##......"] },
  foxArt: { name: "Fox", rows: ["##..........##", "###........###", "####......####", "##############", "##############", "##############", "##.########.##", "##.########.##", "##############", ".############.", ".############.", "..##########..", "..####..####..", "..##########..", "...########...", "....######....", ".....####.....", "......##......"] },
  cupcakeArt: { name: "Cupcake", rows: ["......##......", ".....####.....", "...########...", "..##########..", ".############.", "##############", "##############", "##############", "##############", "##############", "##############", ".############.", ".############.", ".##.######.##.", ".##.######.##.", "..##########..", "..##########..", "...########...", "...########...", "....######...."] },
  snailArt: { name: "Snail", rows: ["..........##..##..", "..........##..##..", "..........##..##..", "....######.####...", "..##########.##...", ".#############....", "##############....", "####......####....", "###..####..###....", "#########..###....", "###..####..###....", "####......####....", "##############....", ".#############....", "..################", "..################"] },
  mountainArt: { name: "Mountain", rows: ["......##........", ".....####.......", ".....#####......", "....#######.....", "....########....", "...##########...", "...###########..", "..#############.", "..##############", ".###############", ".###############", "################", "################", "################", "################", "################"] },
  teapotArt: { name: "Teapot", rows: ["......####......", ".....######.....", "...##########...", ".##############.", "################", "################", "##############..", "##############..", "##############..", "##############..", "###############.", "###############.", ".##############.", "..############..", "...##########...", "....########...."] },
  keyholeArt: { name: "Keyhole", rows: ["....########....", "..############..", ".##############.", "################", "################", "###..######..###", "##....####....##", "##....####....##", "###..######..###", "################", "################", ".##############.", "..############..", "...##########...", "....########....", ".....######.....", "....########....", "...##########...", "..############..", "..############.."] },
  appleArt: { name: "Apple", rows: [".......###....", ".......###....", "..###..###....", ".###########..", "##############", "##############", "##############", "##############", "##############", "##############", "##############", "##############", ".############.", ".############.", "..##########..", "..####..####..", ".####....####."] },
  diceArt: { name: "Dice", rows: ["##############", "##############", "##############", "###.###.###.##", "###.###.###.##", "##############", "##############", "###.###.###.##", "###.###.###.##", "##############", "##############", "###.###.###.##", "###.###.###.##", "##############", "##############", "##############"] },
  towerArt: { name: "Tower", rows: ["....########....", "...##########...", "..############..", "..############..", "...##########...", "....########....", "....########....", "....########....", "...##########...", "...##########...", "....########....", "....########....", "...##########...", "..############..", ".##############.", "################", "################", "################"] },
  rabbitArt: { name: "Rabbit", rows: ["..##......##..", "..##......##..", "..###....###..", "..###....###..", "..####..####..", "..##########..", ".############.", "##############", "##############", "##############", "##.####.####.#", "##############", "#####.###.####", "######...#####", "##############", ".############.", ".############.", "..##########..", "..####...####.", ".####.....####"] },
  frogArt: { name: "Frog", rows: ["..####....####..", ".######..######.", ".##.##....##.##.", ".######..######.", "..############..", ".##############.", "################", "################", "################", "###.########.###", "####........####", "################", ".##############.", "..############..", "###..######..###", "####........####", "##............##"] },
  octopusArt: { name: "Octopus", rows: ["....########....", "..############..", ".##############.", "################", "##.##########.##", "##.##########.##", "################", "################", "################", "################", "##.##.####.##.##", "##.##.####.##.##", "##.##.####.##.##", "##.##.####.##.##", "##.##.####.##.##", "##.##.####.##.##"] },
  dolphinArt: { name: "Dolphin", rows: [".......##.......", "......####......", ".....######.....", "....########....", "...##########...", "..############..", "###############.", "################", "################", "###############.", "##############..", ".############...", "..##########....", "...####..###....", "..####....###...", ".####......###.."] },
  ladybugArt: { name: "Ladybug", rows: ["..##......##..", "...##....##...", "....######....", "...########...", "..##########..", ".############.", "##############", "###.####.#####", "###.####.#####", "##############", "####.##.######", "####.##.######", "##############", ".############.", ".############.", "..##########..", "...########...", "....######...."] },
  spiderArt: { name: "Spider", rows: ["##..........##", ".##........##.", "..##......##..", "...########...", "..##########..", ".############.", "##############", "##.########.##", "##############", "##############", ".############.", "..##########..", "...########...", "..##......##..", ".##........##.", "##..........##"] },
  sunArt: { name: "Sun", rows: ["......##......", "......##......", "...#######....", "....######....", "..##########..", ".############.", "##############", "##############", "##############", "##############", ".############.", "..##########..", "....######....", "...#######....", "......##......", "......##......"] },
  moonArt: { name: "Moon", rows: ["......####....", "....########..", "...#########..", "..#####.......", ".#####........", ".####.........", "#####.........", "####..........", "####..........", "####..........", "#####.........", ".####.........", ".#####........", "..#####.......", "...#########..", "....########..", "......####...."] },
  cloudArt: { name: "Cloud", rows: [".....######.....", "...##########...", "..############..", ".##############.", "################", "################", "################", "################", "################", ".##############.", "..############.."] },
  starArt: { name: "Star", rows: ["......##......", "......##......", ".....####.....", ".....####.....", "##############", "##############", ".############.", "..##########..", "...########...", "...########...", "..##########..", "..###....###..", ".####....####.", ".###......###.", "###........###"] },
  heartBigArt: { name: "Heartbeat", rows: ["..####....####..", ".######..######.", "################", "################", "################", "################", "################", ".##############.", ".##############.", "..############..", "...##########...", "....########....", ".....######.....", "......####......", ".......##......."] },
  ringArt: { name: "Ring", rows: ["......##......", ".....####.....", "....##..##....", "...##....##...", "....######....", "..##########..", ".############.", "###........###", "###........###", "###........###", "###........###", "###........###", ".############.", "..##########..", "....######...."] },
  giftArt: { name: "Gift", rows: ["..##......##..", ".####....####.", ".#####..#####.", "..############", "##############", "##############", "#####.##.#####", "##############", "##############", "#####.##.#####", "#####.##.#####", "#####.##.#####", "#####.##.#####", "#####.##.#####", "##############", "##############"] },
  bellArt: { name: "Bell", rows: ["......##......", ".....####.....", "....######....", "...########...", "..##########..", "..##########..", ".############.", ".############.", "##############", "##############", "##############", "##############", "##############", "..##########..", "......##......", ".....####.....", "......##......"] },
  lanternArt: { name: "Lantern", rows: ["......##......", "....######....", "..##########..", ".############.", "##############", "##.########.##", "##.########.##", "##.########.##", "##.########.##", "##.########.##", "##.########.##", "##############", ".############.", "..##########..", "....######....", "......##......"] },
  windmillArt: { name: "Windmill", rows: ["..####.........", "..#####........", "..######.......", "..#######......", "#######........", "..#######......", "......####.....", "......####.....", ".....######....", ".....######....", ".....######....", ".....######....", "....########...", "....########...", "...##########..", "..############."] },
  pyramidArt: { name: "Pyramid", rows: [".......##.......", "......####......", ".....######.....", ".....######.....", "....########....", "...##########...", "...##########...", "..############..", ".##############.", ".##############.", "################", "################", "################"] },
  bridgeArt: { name: "Bridge", rows: ["....########....", "..############..", ".##############.", "###..######..###", "###..######..###", "###..######..###", "################", "################", "###.##.##.##.###", "###.##.##.##.###", "###.##.##.##.###", "###.##.##.##.###", "################", "################"] },
  trainArt: { name: "Train", rows: ["....##........", "....##........", "..######......", "..######......", "..############", "..############", "###...##...###", "##############", "##############", "##.###..###.##", "##############", "..############", "..####..####..", "..####..####.."] },
  carArt: { name: "Car", rows: [".....########.....", "....##########....", "...############...", "..##.########.##..", ".###.########.###.", "##################", "##################", "##################", "##################", "##################", "..####......####..", ".######....######.", ".######....######.", "..####......####.."] },
  planeArt: { name: "Plane", rows: [".......##.......", ".......##.......", "......####......", "......####......", "......####......", "################", "################", "################", "......####......", "......####......", "......####......", "......####......", "....########....", "....########....", "..############.."] },
  bikeArt: { name: "Bicycle", rows: ["..........####..", "..........####..", "....##########..", "...####.....##..", "..#####....###..", "..############..", ".###.####.####..", "####..##..#####.", "####..##..#####.", "####..##..#####.", ".###..##..####..", "..############..", "...##########..."] },
  lampArt: { name: "Lamp", rows: ["....######....", "...########...", "..##########..", ".############.", "##############", "##############", ".############.", "..##########..", "......##......", "......##......", "......##......", "......##......", "......##......", "....######....", "..##########..", ".############."] },
  bookArt: { name: "Book", rows: ["................", "..############..", ".##############.", "################", "###..######..###", "###..######..###", "###..######..###", "###..######..###", "###..######..###", "###..######..###", "################", ".##############.", "..############.."] },
  pencilArt: { name: "Pencil", rows: ["..........####", ".........#####", "........######", ".......#####..", "......#####...", ".....#####....", "....#####.....", "...#####......", "..#####.......", ".#####........", "#####.........", "####..........", "###...........", "##............", "#............."] },
  clockArt: { name: "Clock", rows: ["....########....", "..############..", ".##############.", "################", "###.##....##.###", "###.##....##.###", "###.########.###", "###.###..###.###", "###.###..###.###", "###.###..###.###", "################", ".##############.", "..############..", "....########....", "...##......##...", "..####....####.."] },
  compassArt: { name: "Compass", rows: ["....########....", "..############..", ".##############.", "################", "################", "####..####..####", "####.######.####", "####.######.####", "####..####..####", "################", "################", ".##############.", "..############..", "....########...."] },
  kiteArt: { name: "Kite", rows: [".......##.......", "......####......", ".....######.....", "....########....", "...##########...", "..############..", ".##############.", "################", ".##############.", "..############..", "...##########...", "....########....", ".....######.....", "......####......", ".......##.......", ".......##.......", "......####......", ".......##.......", "......####......"] },
  donutArt: { name: "Donut", rows: ["....########....", "..############..", ".##############.", "################", "####........####", "###..........###", "###..........###", "###..........###", "###..........###", "####........####", "################", ".##############.", "..############..", "....########...."] },
};

const COLLECTABLE = ["Cat", "Dog", "Elephant", "Butterfly", "Umbrella", "Anchor", "Trophy", "Crown", "Tree", "Fish", "Bird", "Guitar", "Hourglass", "Key", "Mushroom", "Rocket", "Owl", "Whale", "Cactus", "Bolt", "Crab", "Penguin", "Lighthouse", "Bear", "Flower", "Camera", "Sailboat", "Dino", "Bee", "Castle", "Ghost", "Ice Cream", "Turtle", "Robot", "Balloon", "Fox", "Cupcake", "Snail", "Mountain", "Teapot", "Keyhole", "Apple", "Dice", "Tower", "Rabbit", "Frog", "Octopus", "Dolphin", "Ladybug", "Spider", "Sun", "Moon", "Cloud", "Star", "Heartbeat", "Ring", "Gift", "Bell", "Lantern", "Windmill", "Pyramid", "Bridge", "Train", "Car", "Plane", "Bicycle", "Lamp", "Book", "Pencil", "Clock", "Compass", "Kite", "Donut", "Grid", "Diamond", "Heart", "Cross"];
const THUMB = { "Cat": "catArt", "Dog": "dogArt", "Elephant": "elephantArt", "Butterfly": "butterflyArt", "Umbrella": "umbrellaArt", "Anchor": "anchorArt", "Trophy": "trophyArt", "Crown": "crownArt", "Tree": "treeArt", "Fish": "fishArt", "Bird": "birdArt", "Guitar": "guitarArt", "Hourglass": "hourglassArt", "Key": "keyArt", "Mushroom": "mushroomArt", "Rocket": "rocketArt", "Owl": "owlArt", "Whale": "whaleArt", "Cactus": "cactusArt", "Bolt": "boltArt", "Crab": "crabArt", "Penguin": "penguinArt", "Lighthouse": "lighthouseArt", "Bear": "bearArt", "Flower": "flowerArt", "Camera": "cameraArt", "Sailboat": "boatArt", "Dino": "dinoArt", "Bee": "beeArt", "Castle": "castleArt", "Ghost": "ghostArt", "Ice Cream": "iceArt", "Turtle": "turtleArt", "Robot": "robotArt", "Balloon": "balloonArt", "Fox": "foxArt", "Cupcake": "cupcakeArt", "Snail": "snailArt", "Mountain": "mountainArt", "Teapot": "teapotArt", "Keyhole": "keyholeArt", "Apple": "appleArt", "Dice": "diceArt", "Tower": "towerArt", "Rabbit": "rabbitArt", "Frog": "frogArt", "Octopus": "octopusArt", "Dolphin": "dolphinArt", "Ladybug": "ladybugArt", "Spider": "spiderArt", "Sun": "sunArt", "Moon": "moonArt", "Cloud": "cloudArt", "Star": "starArt", "Heartbeat": "heartBigArt", "Ring": "ringArt", "Gift": "giftArt", "Bell": "bellArt", "Lantern": "lanternArt", "Windmill": "windmillArt", "Pyramid": "pyramidArt", "Bridge": "bridgeArt", "Train": "trainArt", "Car": "carArt", "Plane": "planeArt", "Bicycle": "bikeArt", "Lamp": "lampArt", "Book": "bookArt", "Pencil": "pencilArt", "Clock": "clockArt", "Compass": "compassArt", "Kite": "kiteArt", "Donut": "donutArt", "Grid": "square5", "Diamond": "diamond7", "Heart": "heart9", "Cross": "cross7" };

/* ═══════════  tiers  ═══════════ */


/* Every hand-drawn shape, walked in a seeded order so nothing repeats until
   the whole set has been played. The old per-tier pools held 3-4 masks each,
   which meant the same silhouette returned every few levels. */
/* Every name in COLLECTABLE has to be reachable, or its slot in the Collection
   sits locked for ever and the player hunts something that cannot appear.
   Grid, Diamond, Heart and Cross were listed as collectable and given
   thumbnails, but their shapes were never in this pool, so no level ever used
   them — four of the seventy-seven slots were unwinnable. */
const ART_POOL = [
  "square5", "diamond7", "heart9", "cross7",
  "catArt", "dogArt", "elephantArt", "butterflyArt", "umbrellaArt", "anchorArt",
  "trophyArt", "crownArt", "treeArt", "fishArt", "birdArt", "guitarArt",
  "hourglassArt", "keyArt", "mushroomArt", "rocketArt", "owlArt", "whaleArt",
  "cactusArt", "boltArt", "crabArt", "penguinArt", "lighthouseArt", "bearArt",
  "flowerArt", "cameraArt", "boatArt", "dinoArt", "beeArt", "castleArt",
  "ghostArt", "iceArt", "turtleArt", "robotArt", "balloonArt", "foxArt",
  "cupcakeArt", "snailArt", "mountainArt", "teapotArt", "keyholeArt", "appleArt",
  "diceArt", "towerArt", "rabbitArt", "frogArt", "octopusArt", "dolphinArt",
  "ladybugArt", "spiderArt", "sunArt", "moonArt", "cloudArt", "starArt",
  "heartBigArt", "ringArt", "giftArt", "bellArt", "lanternArt", "windmillArt",
  "pyramidArt", "bridgeArt", "trainArt", "carArt", "planeArt", "bikeArt",
  "lampArt", "bookArt", "pencilArt", "clockArt", "compassArt", "kiteArt",
  "donutArt",
];

function shuffledCycle(cycle) {
  const order = [...ART_POOL];
  const r = mulberry32(cycle * 7717 + 91);
  for (let i = order.length - 1; i > 0; i--) {
    const j = (r() * (i + 1)) | 0;
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

function curatedKey(level) {
  const n = ART_POOL.length;
  const cycle = Math.floor((level - 1) / n);
  const order = shuffledCycle(cycle);
  // a fresh shuffle can open with a shape the last cycle just closed on, so
  // push any of the previous cycle's final four out of the opening four
  if (cycle > 0) {
    const tail = shuffledCycle(cycle - 1).slice(-4);
    for (let i = 0; i < 4; i++) {
      if (!tail.includes(order[i])) continue;
      for (let j = 4; j < n; j++) {
        if (tail.includes(order[j])) continue;
        [order[i], order[j]] = [order[j], order[i]];
        break;
      }
    }
  }
  return order[(level - 1) % n];
}

/* freedom is the difficulty target the board selector aims for: it builds
   several candidate boards and keeps the one whose measured freedom is closest
   to this. The original numbers all sat far BELOW anything a board could
   actually reach, so "closest to target" collapsed into "as constrained as
   possible" — an optimiser with no ceiling. Every new mechanic that allowed a
   tighter board then ratcheted difficulty up on its own, unasked.
   These values are what the original game measurably played at, tier by tier,
   so the curve stays where it was and the target does real work from now on. */
const TIERS = [
  { name: "Warm Up", span: 2,     maxLen: 10, hearts: 3, hints: 3, undos: 3, coverage: 0.94, tightness: 0.80, freedom: 0.494, pieces: 32, maxCells: 150 , diag: 0 , mirrors: 0 },
  { name: "Little Easy", span: 3,     maxLen: 11, hearts: 3, hints: 3, undos: 3, coverage: 0.95, tightness: 0.83, freedom: 0.426, pieces: 38, maxCells: 185 , diag: 0 , mirrors: 0 },
  { name: "Easy", span: 4,     maxLen: 12, hearts: 3, hints: 3, undos: 2, coverage: 0.95, tightness: 0.85, freedom: 0.360, pieces: 44, maxCells: 220 , diag: 0 , mirrors: 0 },
  { name: "Easy Plus", span: 5,     maxLen: 13, hearts: 3, hints: 2, undos: 2, coverage: 0.96, tightness: 0.87, freedom: 0.390, pieces: 49, maxCells: 255 , diag: 0 , mirrors: 0 },
  { name: "Little Medium", span: 6,     maxLen: 14, hearts: 3, hints: 2, undos: 2, coverage: 0.96, tightness: 0.88, freedom: 0.438, pieces: 55, maxCells: 290 , diag: 1 , mirrors: 0 },
  { name: "Medium", span: 8,     maxLen: 15, hearts: 3, hints: 2, undos: 2, coverage: 0.97, tightness: 0.90, freedom: 0.322, pieces: 62, maxCells: 325 , diag: 1 , mirrors: 0 },
  { name: "Medium Plus", span: 10,     maxLen: 16, hearts: 3, hints: 2, undos: 2, coverage: 0.97, tightness: 0.91, freedom: 0.372, pieces: 70, maxCells: 360 , diag: 2 , mirrors: 1 },
  { name: "Tricky", span: 12,     maxLen: 17, hearts: 3, hints: 2, undos: 1, coverage: 0.98, tightness: 0.92, freedom: 0.363, pieces: 77, maxCells: 395 , diag: 2 , mirrors: 1 },
  { name: "Tough", span: 14,     maxLen: 18, hearts: 3, hints: 2, undos: 1, coverage: 0.98, tightness: 0.93, freedom: 0.369, pieces: 84, maxCells: 430 , diag: 2 , mirrors: 1 },
  { name: "Hard", span: 17,     maxLen: 19, hearts: 3, hints: 1, undos: 1, coverage: 0.99, tightness: 0.94, freedom: 0.319, pieces: 91, maxCells: 470 , diag: 3 , mirrors: 2 },
  { name: "Very Hard", span: 20,     maxLen: 20, hearts: 3, hints: 1, undos: 1, coverage: 0.99, tightness: 0.95, freedom: 0.315, pieces: 100, maxCells: 510 , diag: 3 , mirrors: 2 },
  { name: "Super Hard", span: 24,     maxLen: 21, hearts: 3, hints: 1, undos: 1, coverage: 0.99, tightness: 0.96, freedom: 0.287, pieces: 109, maxCells: 555 , diag: 3 , mirrors: 2 },
  { name: "Expert", span: 30,     maxLen: 22, hearts: 3, hints: 1, undos: 1, coverage: 0.99, tightness: 0.97, freedom: 0.315, pieces: 117, maxCells: 600 , diag: 4 , mirrors: 3 },
  { name: "Elite", span: 36,     maxLen: 23, hearts: 3, hints: 1, undos: 1, coverage: 0.99, tightness: 0.98, freedom: 0.294, pieces: 128, maxCells: 645 , diag: 4 , mirrors: 3 },
  { name: "Master", span: 45,     maxLen: 24, hearts: 3, hints: 1, undos: 1, coverage: 0.99, tightness: 0.99, freedom: 0.284, pieces: 138, maxCells: 690 , diag: 4 , mirrors: 3 },
  { name: "Pro", span: Infinity,     maxLen: 26, hearts: 3, hints: 1, undos: 1, coverage: 0.99, tightness: 1.0, freedom: 0.267, pieces: 148, maxCells: 740 , diag: 4 , mirrors: 3 },
];
const MEDAL = { 1: "#CD7F32", 2: "#AEB6C4", 3: "#FFC24B" };
const TIER_HUE = ["#5FCB8A", "#4CC79B", "#3FBFD6", "#3EA8EE", "#3E9BF0", "#5580F2", "#6C7BF0", "#8470F2", "#9A6BF0", "#C07AD8", "#F0A93E", "#F2891B", "#F2761B", "#FF6A4A", "#FF3D9A", "#B14BFF"];

/* arrow palettes — competitors are all monochrome navy, this is free differentiation */
const PALETTES = {
  ink: { name: "Ink", base: "#1B2440" },
  candy: { name: "Candy", right: "#2F7BF6", left: "#FF4D6A", up: "#8B5CF6", down: "#F59E0B",
           upRight: "#06B6D4", downRight: "#EC4899", downLeft: "#F97316", upLeft: "#22C55E" },
  forest: { name: "Forest", right: "#0E9F6E", left: "#0EA5E9", up: "#65A30D", down: "#EAB308",
            upRight: "#14B8A6", downRight: "#3B82F6", downLeft: "#A3A635", upLeft: "#84CC16" },
  sunset: { name: "Sunset", right: "#F2761B", left: "#E11D74", up: "#7C3AED", down: "#FBBF24",
            upRight: "#F43F5E", downRight: "#A855F7", downLeft: "#FB923C", upLeft: "#D946EF" },
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

const CURATED_UNTIL = 200;
// Studio "quick pick" — a curated set of recognisable shapes so a casual player
// can start a custom board with one tap instead of drawing on the 11x11 canvas.
const QUICK_SHAPES = [
  "heartBigArt", "starArt", "keyArt", "crownArt", "trophyArt", "ringArt",
  "giftArt", "bellArt", "sunArt", "moonArt", "cloudArt", "donutArt",
  "anchorArt", "umbrellaArt", "mushroomArt", "rocketArt",
];
const HARD_TIER = 9; // TIERS index where "Hard" begins — chess-style boards from here up
const LOCK_TIER = 5; // "Medium" — sealed arrows start appearing here
// how much of a board is sealed: a taste at Medium, a real constraint by Pro
const lockRatio = (index) => (index < LOCK_TIER ? 0 : Math.min(0.26, 0.06 + (index - LOCK_TIER) * 0.02)); // hand-drawn art up to here, generated art beyond
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
  // nx/ny rather than dx/dy: on a diagonal, dx and dy are both 1, so scaling by
  // them would push the stub and the tip 1.41x too far.
  if (pts.length === 1) pts.unshift({ x: head.x - D.nx * 34, y: head.y - D.ny * 34 });
  const tip = { x: head.x + D.nx * 7, y: head.y + D.ny * 7 };
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
function departGeom(piece, cols, rows, mirrors) {
  const D = DIRS[piece.dir];
  const pts = [...piece.cells].reverse().map((i) => ({ x: cx(i, cols), y: cy(i, cols) }));
  const head = pts[pts.length - 1];
  if (pts.length === 1) pts.unshift({ x: head.x - D.nx * 34, y: head.y - D.ny * 34 });

  let bodyLen = 0;
  for (let i = 1; i < pts.length; i++) {
    bodyLen += Math.abs(pts[i].x - pts[i - 1].x) + Math.abs(pts[i].y - pts[i - 1].y);
  }
  bodyLen += 7; // out to the chevron base

  /* With deflectors the flight is no longer a straight run: walk the actual
     lane cells so the arrow visibly turns where the lane turns, then carry on
     past the last one to leave the board. */
  const lane = exitLine(piece.cells[0], piece.dir, cols, rows, mirrors) || [];
  const via = lane.map((i) => ({ x: cx(i, cols), y: cy(i, cols) }));
  let travel = 0;
  let prev = head;
  for (const q of via) {
    travel += Math.hypot(q.x - prev.x, q.y - prev.y);
    prev = q;
  }
  // direction of the final leg, so the exit continues the way the lane ended
  const lastD = via.length >= 2
    ? (() => {
        const a = via[via.length - 2], b = via[via.length - 1];
        const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        return { nx: (b.x - a.x) / L, ny: (b.y - a.y) / L };
      })()
    : { nx: D.nx, ny: D.ny };
  const tailRun = 1.5 * U + bodyLen;
  travel += tailRun;
  const end = { x: prev.x + lastD.nx * tailRun, y: prev.y + lastD.ny * tailRun };
  const d =
    `M ${pts[0].x} ${pts[0].y} ` +
    pts.slice(1).map((q) => `L ${q.x} ${q.y}`).join(" ") +
    via.map((q) => `L ${q.x} ${q.y}`).join(" ") +
    ` L ${end.x} ${end.y}`;
  return { d, bodyLen, travel, D, lastD };
}

/* The guide line a player sights along. It used to be a straight ray, which is
   wrong the moment a lane bends at a deflector — the arrow would fly somewhere
   the guide never pointed. */
function lanePath(head, dir, cols, rows, mirrors) {
  const lane = exitLine(head, dir, cols, rows, mirrors) || [];
  const far = (cols + rows + DOT_PAD * 2) * U;
  let d = `M ${cx(head, cols)} ${cy(head, cols)}`;
  let last = { x: cx(head, cols), y: cy(head, cols) };
  let prev = last;
  for (const i of lane) {
    const q = { x: cx(i, cols), y: cy(i, cols) };
    d += ` L ${q.x} ${q.y}`;
    prev = last; last = q;
  }
  // carry on past the final cell so the guide runs off the board
  const dx = last.x - prev.x, dy = last.y - prev.y;
  const L = Math.hypot(dx, dy) || 1;
  d += ` L ${last.x + (dx / L) * far} ${last.y + (dy / L) * far}`;
  return d;
}

function DepartingPiece({ piece, cols, rows, tone, mirrors }) {
  const g = departGeom(piece, cols, rows, mirrors);
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
      <g className="chev-out" style={{ "--tx": `${g.lastD.nx * g.travel}px`, "--ty": `${g.lastD.ny * g.travel}px` }}>
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

// A mask drawn as one path instead of one rect element per cell. The Collection shows
// dozens of thumbnails at once; at ~190 cells each that was thousands of DOM
// nodes and made the tab hang. Paths are built once and cached by key.
function maskPath(m, inset = 0.15, size = 0.7) {
  let d = "";
  for (const i of m.cells) {
    const x = (i % m.cols) + inset;
    const y = Math.floor(i / m.cols) + inset;
    d += `M${x} ${y}h${size}v${size}h-${size}z`;
  }
  return d;
}

const THUMB_PATH = new Map();
function cachedMask(shapeKey) {
  let hit = THUMB_PATH.get(shapeKey);
  if (!hit) {
    const m = parseMask(shapeKey);
    hit = { cols: m.cols, rows: m.rows, d: maskPath(m) };
    THUMB_PATH.set(shapeKey, hit);
  }
  return hit;
}

function ShapeThumb({ shapeKey, on }) {
  const m = cachedMask(shapeKey);
  return (
    <svg viewBox={`0 0 ${m.cols} ${m.rows}`} style={{ width: 40, height: 40 }}>
      <path d={m.d} fill={on ? C.accent : C.line} />
    </svg>
  );
}

const todayKey = () => new Date().toISOString().slice(0, 10);

/* ═══════════  game  ═══════════ */

export default function ArrowEscapeV3() {
  const [mode, setMode] = useState("journey");
  const [level, setLevel] = useState(1);
  const [best, setBest] = useState(1);
  const [setup, setSetup] = useState(() => makeLevel(1));
  const [alive, setAlive] = useState(() => new Set(setup.pieces.map((p) => p.id)));
  const aliveRef = useRef(alive); // synchronous mirror — fast taps must not miss the last arrow
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
  const [booted, setBooted] = useState(false); // first paint waits for saved settings
  const [phase, setPhase] = useState("playing"); // playing | reveal | cleared | gameover
  // The rank this clear earned (0 none, 1 bronze, 2 silver, 3 gold). Held in
  // state so the reveal and the win card can both show it — until now it was
  // computed inside the clear handler and thrown away, which is why the player
  // was never told what they had earned.
  const [earnedRank, setEarnedRank] = useState(0);
  const revealTimer = useRef(null);
  const [heartPop, setHeartPop] = useState(false);
  const [screen, setScreen] = useState("home"); // home | play | studio | collection | settings
  const [grid, setGrid] = useState(false);
  const [zen, setZen] = useState(false);
  const [bigTouch, setBigTouch] = useState(true);
  const [haptics, setHaptics] = useState(true);
  const [sfxOn, setSfxOn] = useState(true);
  const [musicOn, setMusicOn] = useState(true);
  const [theme, setTheme] = useState("ink");
  const [dark, setDark] = useState(true);
  const [coachSeen, setCoachSeen] = useState(true);
  const [seenTips, setSeenTips] = useState({});
  const [ranks, setRanks] = useState({}); // shape name -> 1 bronze | 2 silver | 3 gold
  const [customs, setCustoms] = useState([]);
  const [found, setFound] = useState([]);
  const [stickers, setStickers] = useState([]);
  const [levelStars, setLevelStars] = useState({}); // level -> 1..3
  const [adsRemoved, setAdsRemoved] = useState(false);
  const [adWatchCount, setAdWatchCount] = useState(0); // rewarded views toward free ad removal
  const [watchingAd, setWatchingAd] = useState(false);
  const [adNote, setAdNote] = useState("");
  const adGate = useRef({ at: 0, since: 0 });
  const advancing = useRef(false);   // one level advance at a time — the win overlay is tappable anywhere
  const adBusy = useRef(false);      // one reward watch at a time, so one ad counts once
  const adWatchRef = useRef(0);      // authoritative view count, immune to stale closures
  const returnTo = useRef("home");   // which shell screen opened the board, for Back
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
  // Saved boards from before deflectors existed have no mirrors field.
  const mirrors = setup.mirrors instanceof Map ? setup.mirrors : EMPTY_MIRRORS;
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
    /* Silence audio when the app leaves the foreground.

       visibilitychange alone is not enough: in an Android WebView it often
       does not fire when the user presses Home or takes a call, so the pads
       keep playing over whatever they switched to. Capacitor's appStateChange
       does fire, so use it when present — imported dynamically so the same
       file still runs in a plain browser with no Capacitor installed. */
    const sleep = () => Snd.suspend();
    const wake = () => Snd.resume();
    const vis = () => (document.hidden ? sleep() : wake());

    document.addEventListener("visibilitychange", vis);
    window.addEventListener("pagehide", sleep);
    window.addEventListener("blur", sleep);
    window.addEventListener("focus", wake);

    let capListener = null;
    let dropped = false;
    (async () => {
      try {
        const { App } = await import("@capacitor/app");
        const h = await App.addListener("appStateChange", ({ isActive }) => (isActive ? wake() : sleep()));
        if (dropped) h.remove();
        else capListener = h;
      } catch {
        /* not running under Capacitor — the web listeners above cover it */
      }
    })();

    return () => {
      dropped = true;
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("pagehide", sleep);
      window.removeEventListener("blur", sleep);
      window.removeEventListener("focus", wake);
      capListener?.remove();
      Snd.suspend();
    };
  }, []);

  /* Which mechanic on this board the player has not been shown yet. Only one
     at a time — a board can introduce a diagonal and a deflector at once, and
     two banners at once teaches neither. */
  const activeTip = useMemo(() => {
    if (mode !== "journey" || tut < 9) return null;
    const present = {
      seal: pieces.some((p) => p.needs !== undefined),
      diag: pieces.some((p) => DIAG_NAMES.includes(p.dir)),
      mirror: mirrors.size > 0,
    };
    return MECHANIC_TIPS.find((t) => present[t.key] && !seenTips[t.key]) || null;
  }, [mode, tut, pieces, mirrors, seenTips]);

  const dismissTip = useCallback(() => {
    if (!activeTip) return;
    const next = { ...seenTips, [activeTip.key]: true };
    setSeenTips(next);
    persistRef.current({ seenTips: next });
  }, [activeTip, seenTips]);

  const occupancy = useMemo(() => {
    const m = new Map();
    pieces.forEach((p) => alive.has(p.id) && p.cells.forEach((c) => m.set(c, p.id)));
    return m;
  }, [pieces, alive]);

  const blockerOf = useCallback(
    (piece) => {
      // sealed: the arrow it waits on is still on the board
      if (piece.needs !== undefined && alive.has(piece.needs)) return piece.needs;
      for (const c of exitLine(piece.cells[0], piece.dir, cols, rows, mirrors) || []) {
        const o = occupancy.get(c);
        if (o !== undefined && o !== piece.id) return o;
      }
      return null;
    },
    [occupancy, alive, cols, rows, mirrors]
  );

  // the dot grid never changes while a board is in play — rebuilding its few
  // hundred nodes on every tap was the main source of stutter
  const dotLayer = useMemo(
    () =>
      Array.from({ length: (cols + DOT_PAD * 2) * (rows + DOT_PAD * 2) }).map((_, k) => {
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
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cols, rows, mask, dark]
  );

  /* One solid silhouette of the level's shape. maskPath's defaults leave a gap
     around each cell for the thumbnail look; at full size we want the cells to
     meet so the picture reads as one figure rather than a mosaic. */
  const revealPath = useMemo(() => maskPath(mask, 0, 1), [mask]);

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
        setDark(p.dark !== false);
        setCoachSeen(!!p.coachSeen);
        setSeenTips(p.seenTips ?? {});
        setTut(p.tut ?? 0);
        // migrate the old flat list into bronze ranks
        setRanks(p.ranks ?? Object.fromEntries((p.collected ?? []).map((n) => [n, 1])));
        setCustoms(p.customs ?? []);
        setFound(p.found ?? []);
        setStickers(p.stickers ?? []);
        setLevelStars(p.levelStars ?? {});
        setAdsRemoved(!!p.adsRemoved);
        setAdWatchCount(Math.max(0, p.adWatchCount | 0));
        adWatchRef.current = Math.max(0, p.adWatchCount | 0);
        setBadges(p.badges ?? []);
        setStats(p.stats ?? { arrows: 0, flawRun: 0, noUndo: 0, bestChain: 0 });
        setStreak(p.streak ?? 0);
        setGrid(!!p.grid);
        setDailyDone(p.lastDaily === todayKey());
        if (p.level > 1) {
          const st = makeLevel(p.level);
          setLevel(p.level);
          setSetup(st);
          const fresh = new Set(st.pieces.map((x) => x.id));
          aliveRef.current = fresh;
          setAlive(fresh);
          setHearts(st.hearts);
          setHintsLeft(st.hints);
          setUndosLeft(st.undos);
              }
      } catch {
        setCoachSeen(false);
      } finally {
        setBooted(true);
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

  // A level win can fire several of these back to back (badges+stats, then
  // level/best, then levelStars) with no await between them. Each one used to
  // read the save file, merge its own patch, and write — so calls fired in
  // the same tick all read the SAME stale file, and only the last write
  // survived, silently dropping every earlier patch (including level/best).
  // Chaining every call onto one shared queue forces each read-modify-write
  // to fully finish before the next one starts, so nothing gets clobbered.
  const persistQueue = useRef(Promise.resolve());
  const persist = useCallback((patch) => {
    persistQueue.current = persistQueue.current.then(async () => {
      try {
        let cur = {};
        try {
          const raw = await Store.get(SAVE_KEY);
          if (raw) cur = JSON.parse(raw);
        } catch {}
        await Store.set(SAVE_KEY, JSON.stringify({ ...cur, ...patch }));
      } catch {}
    });
    return persistQueue.current;
  }, []);

  const persistRef = useRef(() => {});
  persistRef.current = persist;

  const flashNote = useCallback((t) => {
    setAdNote(t);
    setTimeout(() => setAdNote(""), 2600);
  }, []);

  /* Every reward goes through here. The native layer coalesces rapid taps into
     a single ad, so without one shared gate three taps on "watch for a hint"
     would collect three hints from one view. Returns null when a watch is
     already running — the extra tap is simply ignored. */
  /* Removing ads has to remove the banner too, not just the interstitials —
     otherwise the one thing a paying player still sees is an ad. Runs on load
     as well, so a restored purchase is honoured on the next launch. */
  useEffect(() => {
    if (adsRemoved) Ads.hideBanner();
  }, [adsRemoved]);

  const claimRewarded = useCallback(async (kind) => {
    if (adBusy.current) return null;
    adBusy.current = true;
    setWatchingAd(true);
    try {
      return await Ads.rewarded(kind);
    } finally {
      adBusy.current = false;
      setWatchingAd(false);
    }
  }, []);

  /* A life back, on the same board — the one reward players actually want. */
  const watchForLife = useCallback(async () => {
    const ok = await claimRewarded("life");
    if (ok === null) return;
    if (!ok) return flashNote("No ad available right now.");
    setHearts(1);
    setPhase("playing");
    Snd.shieldUp();
  }, [flashNote, claimRewarded]);

  const watchForHint = useCallback(async () => {
    const ok = await claimRewarded("hint");
    if (ok === null) return;
    if (!ok) return flashNote("No ad available right now.");
    setHintsLeft((n) => n + 1);
  }, [flashNote, claimRewarded]);

  const maybeInterstitial = useCallback(async () => {
    if (adsRemoved) return;
    const g = adGate.current;
    g.since++;
    const now = Date.now();
    if (g.since < AD_EVERY_LEVELS || now - g.at < AD_MIN_GAP_MS) return;
    g.since = 0;
    g.at = now;
    // awaited: the next board must not load underneath the ad
    await Ads.interstitial();
  }, [adsRemoved]);

  /* ── level control ── */
  const applySetup = useCallback((st, keepScore) => {
    setSetup(st);
    const fresh = new Set(st.pieces.map((p) => p.id));
    aliveRef.current = fresh;
    setAlive(fresh);
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
      setLevel(lvl); // whatever level is actually loading — replaying an old one must not silently advance from the wrong number later
      const pre = nextRef.current && nextRef.current.lvl === lvl ? nextRef.current.setup : makeLevel(lvl);
      nextRef.current = null;
      applySetup(pre, keepScore);
    },
    [applySetup]
  );

  const startCustom = useCallback(
    (mask) => {
      setMode("custom");
      // shapes you draw yourself always run at the hardest settings — Studio is the pro arena
      applySetup(makeLevelFromMask(mask, TIERS.length - 1), false);
    },
    [applySetup]
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

  // prebuild the next board during the celebration — no hitch on Next Level.
  // Starting at "reveal" rather than "cleared" buys the extra second.
  useEffect(() => {
    if ((phase !== "reveal" && phase !== "cleared") || mode === "daily") return;
    const t = setTimeout(() => {
      nextRef.current = { lvl: level + 1, setup: makeLevel(level + 1) };
    }, 80);
    return () => clearTimeout(t);
  }, [phase, mode, level]);

  // A replaying player should not have to sit through the reveal every time.
  const skipReveal = useCallback(() => {
    if (revealTimer.current) {
      clearTimeout(revealTimer.current);
      revealTimer.current = null;
    }
    setPhase("cleared");
  }, []);

  useEffect(() => () => { if (revealTimer.current) clearTimeout(revealTimer.current); }, []);

  const restart = useCallback(() => {
    if (mode === "daily") startDaily();
    else if (mode === "custom") applySetup(makeLevelFromMask(setup.mask, setup.tierIndex), false);
    else startJourney(level);
  }, [mode, level, startDaily, startJourney, applySetup, setup.mask]);

  // Android hardware back / side-swipe: step back through the app instead of
  // dropping straight out of the game
  useEffect(() => {
    let handle = null;
    let dropped = false;
    (async () => {
      try {
        const { App } = await import("@capacitor/app");
        const h = await App.addListener("backButton", () => {
          // step back one level of navigation, rather than always jumping home:
          // the board returns to whichever screen opened it, shell screens go
          // home, and only home itself exits.
          if (screen === "play") setScreen(returnTo.current || "home");
          else if (screen !== "home") setScreen("home");
          else App.exitApp();
        });
        if (dropped) h.remove();
        else handle = h;
      } catch {
        /* not running under Capacitor — nothing to hook */
      }
    })();
    return () => {
      dropped = true;
      handle?.remove();
    };
  }, [screen]);

  const nextLevel = useCallback(async () => {
    // the whole win overlay is tappable, so an impatient player can fire this
    // several times while the interstitial is still loading — one at a time.
    if (advancing.current) return;
    advancing.current = true;
    try {
      await maybeInterstitial();
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
      if (n >= b) persist({ level: n, best: b });
      else persist({ best: b });
      startJourney(n, true);
    } finally {
      advancing.current = false;
    }
  }, [mode, level, best, persist, startJourney, maybeInterstitial]);

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
      if (phase !== "playing" || !aliveRef.current.has(piece.id)) return;
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

      const freed = countFreed(pieces, alive, piece.id, cols, rows, mirrors);
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

      const nextAlive = new Set(aliveRef.current);
      nextAlive.delete(piece.id);
      aliveRef.current = nextAlive;
      const willClear = nextAlive.size === 0;
      setAlive(nextAlive);

      if (willClear) {
        setTimeout(() => {
          setPhase("reveal");
          Snd.win();
          /* The board is shaped like a picture, but until now the picture was
             never shown — the board just emptied. Hold the filled silhouette
             for a beat before the win card so the shape means something. */
          revealTimer.current = setTimeout(() => setPhase("cleared"), 1000);
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

          /* Rank rules, rewritten.

             Gold used to also require tierIndex >= 9, which starts at level 65
             — so for the entire first 64 levels a perfect, undo-free clear
             still capped at silver, and nothing told the player why. Gold is
             now earnable anywhere: play it perfectly.

             Bronze used to be granted for finishing at all, which made the
             collection a record of attendance rather than of skill. It now
             asks for a near-clean run; 0 means the shape is not collected and
             the player can come back for it. */
          const earned =
            mistakes === 0 && undosLeft === setup.undos
              ? 3
              : mistakes === 0
              ? 2
              : mistakes <= 1
              ? 1
              : 0;
          setEarnedRank(earned);
          if (earned > 0 && mask.procedural) {
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
          } else if (earned > 0 && COLLECTABLE.includes(mask.name)) {
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
          } else if (level >= best) {
            // only a level at the frontier moves progress forward; replaying
            // an old one must not drag the save back with it
            const bl = level + 1;
            setBest(bl);
            persist({ level: bl, best: bl });
          }

          // stars were being shown on the win screen but never written down,
          // so the Levels list always read back empty — keep the best run.
          if (mode === "journey" && (levelStars[level] ?? 0) < stars) {
            const nextStars = { ...levelStars, [level]: stars };
            setLevelStars(nextStars);
            persist({ levelStars: nextStars });
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
    const back = new Set(aliveRef.current);
    back.add(last);
    aliveRef.current = back;
    setAlive(back);
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
      const f = countFreed(pieces, alive, x.id, cols, rows, mirrors);
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

  // Nothing is drawn until the saved theme is known — otherwise the app flashes
  // its defaults and then repaints, which reads as a light/dark jitter on launch.
  if (!booted) {
    return <div style={{ position: "fixed", inset: 0, background: C.bg }} />;
  }

  /* ═══════════  PLAY SCREEN — full bleed, like a real puzzle app  ═══════════ */
  if (screen === "play") {
    return (
      <div style={adsRemoved ? { ...S.playRoot, paddingBottom: "env(safe-area-inset-bottom, 0px)" } : S.playRoot}>
        <style>{CSS}</style>

        <div style={S.hud} className="hud-in">
          <button style={S.hudBtn} onClick={() => setScreen(returnTo.current || "home")} aria-label="Back">
            <ChevLeft />
          </button>
          <button style={S.hudBtn} onClick={restart} aria-label="Restart">
            <Refresh />
          </button>

          <div style={S.hudMid}>
            <div style={{ ...S.diffLabel, color: mode === "journey" ? TIER_HUE[tierIndex] ?? C.accent : C.accent }}>
              {/* The shape's name used to live only in an aria-label, so a
                  sighted player never learned what they were clearing and the
                  Collection filled up with names they had never seen. */}
              {mode === "custom" ? "Your board" : mask.name}
              <span key={alive.size} style={S.leftCount} className="left-tick"> · {alive.size} left</span>
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
                  <span
                    key={i}
                    className={heartPop && i === hearts ? "hbreak" : hearts === 1 && i === 0 ? "heart-low" : ""}
                    style={S.inl}
                  >
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

        {tut < 9 && mode === "journey" && level <= 4 && (
          <div style={S.tutBar} className="ovin">
            <span style={S.tutStep}>{tut + 1}/3</span>
            <span style={S.tutText}>
              {tut === 0
                ? "Tap an arrow to send it off"
                : tut === 1
                ? "Its path must be clear — blocked costs a life"
                : "Hold an arrow to trace its route"}
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

        {tut >= 9 && coachSeen && activeTip && (
          <button style={S.coach} className="ovin" onClick={dismissTip}>
            <span style={S.coachText}>{activeTip.text}</span>
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
            style={{ transform: `translate3d(${view.tx}px, ${view.ty}px, 0) scale(${view.scale})`, transformOrigin: "0 0", transition: snap ? "transform 320ms cubic-bezier(.22,.9,.26,1)" : "none", willChange: "transform", backfaceVisibility: "hidden", width: "100%", height: "100%", touchAction: "none" }}
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
                  return (
                    <path
                      key={`ln${p.id}`}
                      d={lanePath(h, p.dir, cols, rows, mirrors)}
                      stroke={toneFor(p.dir, theme)}
                      strokeWidth={4.5}
                      fill="none"
                      opacity={0.3}
                    />
                  );
                })}

              {/* dot field across the whole surface, not just the shape */}
              {dotLayer}

              {/* Deflectors. Drawn under the arrows so a piece passing over one
                  still reads clearly, and as a bar on the diagonal the lane
                  actually reflects around. */}
              {mirrors.size > 0 &&
                [...mirrors.entries()].map(([cell, kind]) => {
                  const mx = cx(cell, cols), my = cy(cell, cols);
                  const r = U * 0.33;
                  const sx = kind === "/" ? r : -r;
                  return (
                    <g key={`mir${cell}`}>
                      <rect
                        x={mx - U * 0.44} y={my - U * 0.44}
                        width={U * 0.88} height={U * 0.88} rx={U * 0.22}
                        fill={C.card} stroke={C.edge} strokeWidth={3}
                      />
                      <path
                        d={`M ${mx - sx} ${my + r} L ${mx + sx} ${my - r}`}
                        stroke={C.muted} strokeWidth={9} strokeLinecap="round"
                      />
                    </g>
                  );
                })}


              {holdId !== null && alive.has(holdId) && pieces[holdId] && (() => {
                const hp = pieces[holdId];
                const h = hp.cells[0];
                return (
                  <path
                    d={lanePath(h, hp.dir, cols, rows, mirrors)}
                    fill="none"
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
                const isSealed = p.needs !== undefined && alive.has(p.needs);
                const tone = isBad || isBlk ? C.danger : isHint || isHeld ? C.accent : isSealed ? C.muted : toneFor(p.dir, theme);
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
                    style={{ "--d": `${Math.min(idx, 16) * 18}ms`, opacity: isSealed && !isBad && !isBlk && !isHint && !isHeld ? 0.45 : 1 }}
                    onDown={onPieceDown(p)}
                  />
                );
              })}

              {(phase === "reveal" || phase === "cleared") && (
                <g transform={`scale(${U})`} className="reveal-fill">
                  <path d={revealPath} fill={TIER_HUE[tierIndex] ?? C.accent} />
                </g>
              )}

              {[...flying.entries()].map(([id, key]) =>
                pieces[id] ? (
                  <DepartingPiece key={`f${key}`} piece={pieces[id]} cols={cols} rows={rows} tone={C.accent} mirrors={mirrors} />
                ) : null
              )}

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

        <div style={S.playFoot}>
          <div style={S.footGroup}>
            <button style={{ ...S.footBtn, opacity: undosLeft > 0 && history.length ? 1 : 0.35 }} onClick={undo} disabled={undosLeft <= 0 || !history.length}>
              <Undo />
              <span style={S.footNum}>{undosLeft}</span>
            </button>
            <button style={S.gridToggle} onClick={() => { setGrid((g) => !g); persist({ grid: !grid }); }} aria-label="Toggle grid">
              <Hash on={grid} />
            </button>
          </div>
          <div style={S.scoreWrap}>
            <div key={score} style={S.scorePill} className="score-tick">{score.toLocaleString()}</div>
            {combo >= 2 ? (
              <div key={`c${combo}`} style={S.comboCap} className="combo-in">
                {Math.min(combo, 5)}× chain
              </div>
            ) : (
              <div style={S.scoreCap}>score</div>
            )}
          </div>
          <div style={S.footGroup}>
            <span style={S.footSpacer} aria-hidden="true" />
            <button style={S.footBtn} onClick={cycleZoom}>
              <Magnifier zoomed={view.scale > 1.01} />
              {view.scale > 1.01 && <span style={S.footNum}>{Math.round(view.scale)}×</span>}
            </button>
          </div>
        </div>

        {phase === "reveal" && (
          <div
            style={{ position: "absolute", inset: 0, zIndex: 5 }}
            onClick={skipReveal}
            aria-hidden="true"
          />
        )}

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
              {/* This card used to redraw the arrows the player had just spent
                  the level removing. It now shows what they actually revealed. */}
              <svg viewBox={`0 0 ${mask.cols} ${mask.rows}`} style={{ width: "100%", height: "auto", maxHeight: 190 }}>
                <path d={revealPath} fill={TIER_HUE[tierIndex] ?? C.accent} />
              </svg>
              <div style={S.winShapeName}>{mode === "custom" ? "Your board" : mask.name}</div>
              {mode !== "custom" && (
                <div style={{ ...S.winRank, color: earnedRank ? MEDAL[earnedRank] : C.muted }}>
                  {earnedRank === 3 ? "GOLD" : earnedRank === 2 ? "SILVER" : earnedRank === 1 ? "BRONZE" : "NOT COLLECTED"}
                </div>
              )}
              {mode !== "custom" && earnedRank < 3 && (
                <div style={S.winNext}>
                  {earnedRank === 2
                    ? "Clear it without an undo for Gold"
                    : earnedRank === 1
                    ? "Clear it without a mistake for Silver"
                    : "Clear it with at most one mistake to collect it"}
                </div>
              )}
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
    <div style={adsRemoved ? { ...S.page, padding: "calc(10px + env(safe-area-inset-top, 0px)) 14px calc(10px + env(safe-area-inset-bottom, 0px))" } : S.page}>
      <style>{CSS}</style>

      <div style={S.shellBody}>
        {screen === "home" && (
          <div style={S.home} className="screen-in">
            <div style={S.streakChip}>
          🔥 {streak}
          {streak > 0 && (
            <span style={S.streakGoal}>
              {streak >= 30 ? " · legend" : ` · ${[3, 7, 14, 30].find((t) => t > streak) - streak} to ${[3, 7, 14, 30].find((t) => t > streak)}`}
            </span>
          )}
        </div>

            <div style={S.homeCards}>
              <button style={{ ...S.homeCard, animationDelay: "40ms" }} className="card-in" onClick={() => { returnTo.current = "home"; startDaily(); setScreen("play"); }}>
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
              <div style={{ ...S.homeDiff, color: TIER_HUE[tierFor(best).index] ?? C.accent }}>{tierFor(best).tier.name}</div>
            </div>

            <button style={{ ...S.continueBtn, animationDelay: "230ms" }} className="card-in" onClick={() => { returnTo.current = "home"; startJourney(best); setScreen("play"); }}>
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
                            onClick={() => { returnTo.current = "levels"; startJourney(n); setScreen("play"); }}
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
                        <path d={maskPath(m, 0.14, 0.72)} fill={C.accent} />
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
            onPlay={(m) => { returnTo.current = "studio"; startCustom(m); setScreen("play"); }}
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
                <span style={S.buyHint}>No banner, no ads between levels. Reward videos stay available.</span>
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
          {!adsRemoved && (
            <div style={S.watchRow}>
              <div style={S.watchTop}>
                <span style={S.buyName}>Or watch your way there</span>
                <span style={S.watchCount}>{Math.min(adWatchCount, AD_REMOVAL_GOAL)} / {AD_REMOVAL_GOAL}</span>
              </div>
              <span style={S.buyHint}>Every full view counts. Free, no purchase needed.</span>
              <div style={S.chapTrack}>
                <div style={{ ...S.chapFill, width: `${Math.min(100, (adWatchCount / AD_REMOVAL_GOAL) * 100)}%`, background: C.go }} />
              </div>
              <button
                style={{ ...S.buyBtn, width: "100%", marginTop: 10, background: C.go, opacity: watchingAd ? 0.6 : 1 }}
                disabled={watchingAd}
                onClick={async () => {
                  const watched = await claimRewarded("removeAdsProgress");
                  if (watched === null) return;
                  if (!watched) { flashNote("No ad available right now."); return; }
                  const n = adWatchRef.current + 1;
                  adWatchRef.current = n;
                  setAdWatchCount(n);
                  if (n >= AD_REMOVAL_GOAL) {
                    setAdsRemoved(true);
                    persist({ adsRemoved: true, adWatchCount: n });
                    flashNote("Ads removed — thank you.");
                  } else {
                    persist({ adWatchCount: n });
                  }
                }}
              >
                {watchingAd ? "Loading ad…" : "Watch ad"}
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
      <div style={S.colTitle}>Quick shapes</div>
      <div style={S.quickGrid}>
        {QUICK_SHAPES.map((key) => {
          const m = cachedMask(key);
          return (
            <button
              key={key}
              style={S.quickBtn}
              onClick={() => onPlay(parseMask(key))}
              aria-label={`Play ${SHAPES[key].name}`}
            >
              <svg viewBox={`0 0 ${m.cols} ${m.rows}`} style={{ width: 34, height: 34 }}>
                <path d={m.d} fill={C.accent} />
              </svg>
              <span style={S.quickName}>{SHAPES[key].name}</span>
            </button>
          );
        })}
      </div>

      <div style={{ ...S.colTitle, marginTop: 16 }}>Draw your own</div>
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
                      <path d={maskPath(m, 0.12, 0.76)} fill={C.accent} />
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
        <br />
        Studio boards are built at <b>Pro</b> — the hardest settings in the game.
      </div>
    </div>
  );
}

function MaskIcon({ mask, colour, size = 40 }) {
  return (
    <svg viewBox={`0 0 ${mask.cols} ${mask.rows}`} style={{ width: size, height: size, display: "block" }}>
      <path d={maskPath(mask, 0.12, 0.76)} fill={colour} />
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
        <span style={{ ...S.tglKnob, transform: `translate3d(${on ? 18 : 0}px, 0, 0)` }} />
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
  const m = cachedMask(shapeKey);
  return (
    <svg viewBox={`0 0 ${m.cols} ${m.rows}`} style={{ width: "100%", height: "100%" }}>
      <path d={m.d} fill={C.accent} opacity={0.85} />
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

/* The React root only paints its own box. Anything outside it — the strip
   behind a rubber-band scroll, a rounding gap at a screen edge — falls back
   to the browser's white, which reads as a flash against the dark theme.
   Colouring the document itself keeps the app one solid surface. */
html,body,#root{background:${C.bg};margin:0}
/* Android's WebView silently inflates text it judges too small, which pushes
   carefully sized labels out of their pills. Opt out and keep the tuned sizes. */
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
/* Long-pressing an arrow is a game gesture, not a request for the system
   text/copy menu. */
body{-webkit-touch-callout:none;-webkit-font-smoothing:antialiased}
/* Scrollbars belong to documents, not to a game screen. */
::-webkit-scrollbar{width:0;height:0;display:none}
*{scrollbar-width:none}

svg { shape-rendering: geometricPrecision; }
@keyframes settleIn{0%{opacity:0;transform:translateY(9px) scale(.94)}62%{transform:translateY(-1px) scale(1.015)}100%{opacity:1;transform:translateY(0) scale(1)}}
.settle{animation:settleIn 300ms cubic-bezier(.2,1.02,.3,1) backwards;animation-delay:var(--d,0ms);will-change:transform,opacity}
@keyframes snakeOut{to{stroke-dashoffset:var(--off)}}
.snake{animation:snakeOut 340ms cubic-bezier(.5,0,.28,1) forwards;will-change:stroke-dashoffset}
@keyframes chevOut{to{transform:translate(var(--tx),var(--ty))}}
.chev-out{animation:chevOut 340ms cubic-bezier(.5,0,.28,1) forwards;will-change:transform}
@keyframes depFade{0%,72%{opacity:1}100%{opacity:0}}
.dep-fade{animation:depFade 340ms cubic-bezier(.4,0,1,1) forwards}
@keyframes ringOut{0%{opacity:.5;transform:scale(.35)}100%{opacity:0;transform:scale(1.7)}}
.ring{animation:ringOut 460ms cubic-bezier(.14,.84,.26,1) forwards;transform-box:fill-box;transform-origin:center;will-change:transform,opacity}
@keyframes nudge{0%,100%{transform:translateX(0)}22%{transform:translateX(-9px)}55%{transform:translateX(9px)}80%{transform:translateX(-4px)}}
.shake{animation:nudge 420ms cubic-bezier(.36,.07,.19,.97);will-change:transform}
@keyframes flashDim{0%,100%{opacity:1}50%{opacity:.3}}
.flash{animation:flashDim 340ms ease infinite}
@keyframes hintPulse{0%,100%{opacity:1}50%{opacity:.25}}
.hint{animation:hintPulse 850ms ease infinite}
@keyframes hbreak{0%{transform:scale(1)}35%{transform:scale(1.4)}100%{transform:scale(1)}}
.hbreak{animation:hbreak 430ms ease;display:inline-flex}
@keyframes starpop{0%{transform:scale(0) rotate(-25deg);opacity:0}70%{transform:scale(1.25) rotate(7deg);opacity:1}100%{transform:scale(1) rotate(0);opacity:1}}
@keyframes scoreTick{0%{transform:scale(1)}28%{transform:scale(1.13)}100%{transform:scale(1)}}
.score-tick{animation:scoreTick 340ms cubic-bezier(.24,1.3,.4,1);will-change:transform}
@keyframes comboIn{0%{opacity:0;transform:translateY(4px) scale(.86)}55%{transform:translateY(0) scale(1.06)}100%{opacity:1;transform:scale(1)}}
.combo-in{animation:comboIn 300ms cubic-bezier(.24,1.3,.4,1)}
@keyframes leftTick{0%{opacity:.35}100%{opacity:1}}
.left-tick{animation:leftTick 260ms ease-out}
@keyframes heartLow{0%,100%{transform:scale(1)}50%{transform:scale(1.16)}}
.heart-low{animation:heartLow 1100ms ease-in-out infinite}
.starpop{animation:starpop 620ms cubic-bezier(.26,1.42,.42,1) backwards}
@keyframes badgeIn{0%{transform:scale(.4);opacity:0}100%{transform:scale(1);opacity:1}}
.badge-in{animation:badgeIn 340ms cubic-bezier(.26,1.46,.42,1)}
@keyframes popUp{0%{transform:translateY(0);opacity:0}20%{transform:translateY(calc(var(--rise,60px) * -0.3));opacity:1}100%{transform:translateY(calc(var(--rise,60px) * -1));opacity:0}}
.pop{animation:popUp 1000ms cubic-bezier(.12,.88,.24,1) forwards;pointer-events:none;will-change:transform,opacity}
@keyframes ovin{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:scale(1)}}
.ovin{animation:ovin 340ms cubic-bezier(.16,.86,.26,1)}
.confetti{position:absolute;top:-20px;width:9px;height:15px;border-radius:2px;animation-name:fall;animation-timing-function:linear;animation-iteration-count:infinite;will-change:transform,opacity}
@keyframes fall{0%{transform:translateY(0) rotate(0)}100%{transform:translateY(105vh) rotate(540deg)}}

/* every button gives instant physical feedback */
button { transition: transform 160ms cubic-bezier(.22,1.2,.36,1), background 200ms cubic-bezier(.4,0,.2,1), opacity 200ms cubic-bezier(.4,0,.2,1), box-shadow 200ms cubic-bezier(.4,0,.2,1); }
button:active:not(:disabled) { transform: scale(.945); }

@keyframes screenIn { from { opacity: 0; transform: translateY(18px) scale(.978); } to { opacity: 1; transform: none; } }
.screen-in { animation: screenIn 380ms cubic-bezier(.16,.84,.24,1) both; will-change: transform, opacity; }

@keyframes boardIn { from { opacity: 0; transform: scale(.88); } to { opacity: 1; transform: scale(1); } }
.board-in { animation: boardIn 420ms cubic-bezier(.16,.9,.24,1) backwards; transform-origin: center; will-change: transform, opacity; }

@keyframes hudIn { from { opacity: 0; transform: translateY(-12px); } to { opacity: 1; transform: none; } }
.hud-in { animation: hudIn 360ms cubic-bezier(.16,.86,.26,1) both; }

@keyframes cardIn { from { opacity: 0; transform: translateY(20px) scale(.955); } to { opacity: 1; transform: none; } }
.card-in { animation: cardIn 440ms cubic-bezier(.18,1.02,.28,1) both; will-change: transform, opacity; }

@keyframes navPop { 0% { transform: scale(1); } 40% { transform: scale(1.22) rotate(-3deg); } 70% { transform: scale(.97) rotate(1deg); } 100% { transform: scale(1) rotate(0); } }
.nav-on { animation: navPop 420ms cubic-bezier(.28,1.32,.44,1); }

button:focus-visible{outline:3px solid ${C.accent};outline-offset:3px}
@keyframes revealIn{0%{opacity:0;transform:scale(.93)}62%{transform:scale(1.02)}100%{opacity:1;transform:scale(1)}}
.reveal-fill{animation:revealIn 520ms cubic-bezier(.22,1.05,.32,1) backwards;transform-box:fill-box;transform-origin:center;will-change:transform,opacity}

@media (prefers-reduced-motion: reduce){
.settle,.snake,.chev-out,.dep-fade,.ring,.shake,.flash,.hint,.hbreak,.starpop,.ovin,.confetti,.badge-in,.pop,.score-tick,.combo-in,.heart-low,.left-tick,
.screen-in,.board-in,.hud-in,.card-in,.nav-on,.reveal-fill{animation-duration:1ms!important;animation-iteration-count:1!important}
button{transition-duration:1ms!important}
button:active:not(:disabled){transform:none}
*{scroll-behavior:auto!important}
}
`;

let CSS = makeCSS(C);

/* ═══════════  styles  ═══════════ */

const BOARD_W = "min(93vw, 412px)";
const CELL_CAP = 62;
const VIEW_PAD = 0.6;  // just enough margin for the stroke, no wasted screen
const DOT_PAD = 2;   // just past the viewBox edge; more is invisible and costs a render

const makeStyles = (C) => ({
  playRoot: { position: "fixed", inset: 0, height: "100dvh", boxSizing: "border-box", paddingTop: "env(safe-area-inset-top, 0px)", paddingBottom: "calc(56px + env(safe-area-inset-bottom, 0px))", touchAction: "none", overscrollBehavior: "none", background: C.bg, color: C.ink, fontFamily: "'Nunito', system-ui, sans-serif", display: "flex", flexDirection: "column", WebkitTapHighlightColor: "transparent", userSelect: "none", overflow: "hidden" },
  hud: { display: "flex", alignItems: "center", gap: 8, padding: "12px 14px 8px" },
  hudBtn: { width: 42, height: 42, borderRadius: "50%", background: C.card, border: `1px solid ${C.edge}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: C.sh1, flexShrink: 0 },
  hudMid: { flex: 1, textAlign: "center" },
  leftCount: { fontWeight: 800, fontSize: 12, color: C.muted },
  diffLabel: { fontWeight: 900, fontSize: 15, letterSpacing: "0.01em" },
  hudHearts: { display: "flex", gap: 4, justifyContent: "center", alignItems: "center", marginTop: 3 },
  hintPill: { display: "flex", alignItems: "center", gap: 5, background: C.card, border: `1px solid ${C.edge}`, borderRadius: 999, padding: "10px 14px", cursor: "pointer", boxShadow: C.sh1, flexShrink: 0, transition: "opacity 260ms cubic-bezier(.4,0,.2,1)" },
  hintTxt: { fontFamily: "'Nunito',sans-serif", fontWeight: 900, fontSize: 13, color: C.accent },
  topTrack: { height: 5, margin: "0 16px 4px", borderRadius: 999, background: C.line, overflow: "hidden", boxShadow: `inset 0 1px 2px ${C.bg}` },
  topFill: { height: "100%", borderRadius: 999, background: `linear-gradient(90deg, ${C.accent}, ${C.flow})`, transition: "width 420ms cubic-bezier(.22,.9,.26,1)", boxShadow: `0 0 10px ${C.accent}66` },
  playViewport: { flex: 1, minHeight: 0, width: "100%", overflow: "hidden", touchAction: "none", overscrollBehavior: "contain", background: `radial-gradient(120% 78% at 50% 34%, ${C.card} 0%, ${C.bg} 68%)` },
  gridToggle: { width: 46, height: 46, borderRadius: 999, background: C.card, border: `1px solid ${C.edge}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: C.sh1, flexShrink: 0 },
  footGroup: { display: "flex", alignItems: "center", gap: 8 },
  footSpacer: { display: "block", width: 46, flexShrink: 0 },
  playFoot: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "12px 16px 20px", borderTop: `1px solid ${C.edge}` },
  footBtn: { position: "relative", display: "flex", alignItems: "center", gap: 5, background: C.card, border: `1px solid ${C.edge}`, borderRadius: 999, padding: "11px 16px", cursor: "pointer", boxShadow: C.sh1, transition: "opacity 260ms cubic-bezier(.4,0,.2,1)" },
  footNum: { fontFamily: "'Nunito',sans-serif", fontWeight: 900, fontSize: 12, color: C.accent },
  scoreWrap: { display: "flex", flexDirection: "column", alignItems: "center", gap: 1, flexShrink: 0, minWidth: 92 },
  scorePill: { fontFamily: "'Nunito',sans-serif", fontWeight: 900, fontSize: 30, lineHeight: 1, letterSpacing: "-0.035em", color: C.ink, fontVariantNumeric: "tabular-nums", textAlign: "center" },
  comboCap: { fontSize: 10, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", color: C.flow },
  scoreCap: { fontSize: 9.5, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase", color: C.muted },

  shellBody: { flex: 1, minHeight: 0, width: BOARD_W, overflowY: "auto", overscrollBehavior: "contain", WebkitOverflowScrolling: "touch", scrollBehavior: "smooth", paddingBottom: 8 },
  home: { display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 6 },
  streakGoal: { fontWeight: 800, fontSize: 12, color: C.muted, letterSpacing: 0 },
  streakChip: { background: C.card, border: `1px solid ${C.edge}`, borderRadius: 999, padding: "7px 16px", fontWeight: 900, fontSize: 14, boxShadow: C.sh1, marginBottom: 16, letterSpacing: "0.01em" },
  homeCards: { display: "flex", gap: 12, width: "100%" },
  homeCard: { flex: 1, background: `linear-gradient(180deg, ${C.card} 0%, ${C.card} 62%, ${C.bg} 190%)`, border: `1px solid ${C.edge}`, borderRadius: 20, padding: "14px 12px 12px", cursor: "pointer", boxShadow: C.sh2, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, fontFamily: "'Nunito',sans-serif" },
  homeCardTitle: { fontWeight: 900, fontSize: 17, letterSpacing: "-0.01em", color: C.ink },
  homeCardSub: { fontSize: 11, fontWeight: 700, color: C.muted },
  homeCardArt: { width: 74, height: 62, margin: "8px 0" },
  homeCardBtn: { width: "100%", background: C.accent, color: "#fff", borderRadius: 999, padding: "9px 0", fontWeight: 900, fontSize: 13 },
  brandWrap: { textAlign: "center", margin: "auto 0", padding: "34px 0" },
  brand: { fontWeight: 900, fontSize: 34, letterSpacing: "-0.035em", color: C.ink, lineHeight: 1.05 },
  homeLevel: { fontWeight: 900, fontSize: 26, letterSpacing: "-0.03em", color: C.accent, marginTop: 8, lineHeight: 1.1 },
  homeDiff: { fontWeight: 900, fontSize: 15, marginTop: 2 },
  continueBtn: { width: "100%", background: C.accent, color: "#fff", border: "none", borderRadius: 999, padding: "17px 0", fontFamily: "'Nunito',sans-serif", fontWeight: 900, fontSize: 17, cursor: "pointer", boxShadow: `0 10px 26px ${C.accent}4d` },
  homeFoot: { fontSize: 12, fontWeight: 700, color: C.muted, marginTop: 12 },

  nav: { width: BOARD_W, display: "flex", gap: 4, background: C.card, border: `1px solid ${C.edge}`, borderRadius: 22, padding: 6, marginTop: 8, boxShadow: C.sh2 },
  navBtn: { flex: 1, background: "transparent", border: "none", borderRadius: 16, padding: "9px 1px", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, cursor: "pointer", fontFamily: "'Nunito',sans-serif", transition: "background 260ms cubic-bezier(.4,0,.2,1)" },
  navOn: { background: C.bg },
  navLabel: { fontSize: 8.5, fontWeight: 800, color: C.muted },
  page: { height: "100dvh", boxSizing: "border-box", overflow: "hidden", background: C.bg, color: C.ink, fontFamily: "'Nunito', system-ui, sans-serif", display: "flex", flexDirection: "column", alignItems: "center", padding: "calc(10px + env(safe-area-inset-top, 0px)) 14px calc(66px + env(safe-area-inset-bottom, 0px))", WebkitTapHighlightColor: "transparent", userSelect: "none", touchAction: "manipulation" },
  settings: { width: BOARD_W, background: `linear-gradient(180deg, ${C.card} 0%, ${C.card} 78%, ${C.bg} 240%)`, border: `1px solid ${C.edge}`, borderRadius: 18, padding: 14, marginBottom: 12, boxShadow: C.sh2 },
  tglRow: { width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", background: "transparent", border: "none", padding: "9px 2px", cursor: "pointer", textAlign: "left" },
  tglLabel: { display: "block", fontWeight: 800, fontSize: 13.5, color: C.ink },
  tglHint: { display: "block", fontSize: 11, color: C.muted, fontWeight: 600, marginTop: 1 },
  tglTrack: { width: 40, height: 22, borderRadius: 999, padding: 2, flexShrink: 0, transition: "background 260ms cubic-bezier(.4,0,.2,1)" },
  tglKnob: { display: "block", width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "transform 260ms cubic-bezier(.26,1.36,.4,1)", boxShadow: "0 1px 4px rgba(0,0,0,0.28)", willChange: "transform" },
  tip: { marginTop: 8, padding: "10px 12px", background: C.bg, borderRadius: 12, fontSize: 12, fontWeight: 600, color: C.muted, lineHeight: 1.5 },
  quickGrid: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 4 },
  quickBtn: { display: "flex", flexDirection: "column", alignItems: "center", gap: 4, background: C.bg, border: `1px solid ${C.edge}`, borderRadius: 14, padding: "10px 4px", cursor: "pointer", transition: "opacity 200ms ease" },
  quickName: { fontSize: 10, fontWeight: 800, color: C.muted, fontFamily: "'Nunito',sans-serif" },
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
  chapterCard: { width: "100%", background: `linear-gradient(180deg, ${C.card} 0%, ${C.card} 70%, ${C.bg} 200%)`, border: `1px solid ${C.edge}`, borderRadius: 18, padding: 14, boxShadow: C.sh2, marginTop: 14 },
  chapRow: { display: "flex", alignItems: "center", gap: 11 },
  chapBadge: { width: 34, height: 34, borderRadius: 12, color: "#fff", fontWeight: 900, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  chapName: { fontWeight: 900, fontSize: 15, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  chapSub: { fontSize: 11, fontWeight: 700, color: C.muted, marginTop: 1 },
  chapSticker: { flexShrink: 0 },
  chapTrack: { height: 6, borderRadius: 999, background: C.bg, overflow: "hidden", marginTop: 11 },
  chapFill: { height: "100%", borderRadius: 999, transition: "width 520ms cubic-bezier(.22,.9,.26,1)" },
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
  watchRow: { background: C.bg, borderRadius: 14, padding: "12px 14px", marginBottom: 8 },
  watchTop: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 },
  watchCount: { fontWeight: 900, fontSize: 13, color: C.go, fontVariantNumeric: "tabular-nums", flexShrink: 0 },
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
  tutBar: { display: "inline-flex", alignItems: "center", gap: 8, maxWidth: "calc(100% - 40px)", alignSelf: "center", background: C.card, border: `1.5px solid ${C.accent}44`, borderRadius: 999, padding: "7px 8px 7px 10px", marginBottom: 8, boxShadow: `0 6px 18px ${C.accent}1f` },
  tutStep: { fontWeight: 900, fontSize: 10, color: "#fff", background: C.accent, borderRadius: 999, padding: "2px 7px", flexShrink: 0, letterSpacing: 0.2 },
  tutText: { fontSize: 11.5, fontWeight: 700, color: C.ink, lineHeight: 1.3 },
  tutSkip: { background: "transparent", border: "none", borderRadius: 999, padding: "4px 7px", fontFamily: "'Nunito',sans-serif", fontWeight: 800, fontSize: 10.5, color: C.muted, cursor: "pointer", flexShrink: 0 },
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
  primary: { display: "block", width: "100%", background: C.accent, color: "#fff", border: "none", borderRadius: 999, padding: "14px 30px", fontFamily: "'Nunito',sans-serif", fontWeight: 800, fontSize: 15, cursor: "pointer", boxShadow: `0 8px 22px ${C.accent}52` },
  ghost: { display: "block", width: "100%", marginTop: 8, background: "transparent", color: C.muted, border: "none", padding: 10, fontFamily: "'Nunito',sans-serif", fontWeight: 800, fontSize: 13, cursor: "pointer" },
  winWrap: { position: "fixed", inset: 0, background: "radial-gradient(90% 60% at 50% 22%, #58B4FF 0%, #2E96FF 42%, #1668D8 100%)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", zIndex: 40, padding: 20 },
  winInner: { position: "relative", textAlign: "center", width: "100%", maxWidth: 320 },
  winKicker: { color: "rgba(255,255,255,0.92)", fontWeight: 800, fontSize: 15 },
  winTitle: { color: "#fff", fontWeight: 900, fontSize: 27, letterSpacing: "-0.02em", margin: "6px 0 18px" },
  winCard: { background: C.card, borderRadius: 22, padding: 20, boxShadow: "0 18px 48px rgba(0,20,60,0.34)" },
  winShapeName: { textAlign: "center", fontWeight: 900, fontSize: 18, color: C.ink, marginTop: 10, letterSpacing: "-0.01em" },
  winRank: { textAlign: "center", fontWeight: 900, fontSize: 11, letterSpacing: "0.12em", marginTop: 4 },
  winNext: { textAlign: "center", fontWeight: 700, fontSize: 11.5, color: C.muted, marginTop: 8, lineHeight: 1.35 },
  winStars: { display: "flex", gap: 10, justifyContent: "center", margin: "18px 0 6px" },
  winMeta: { color: "rgba(255,255,255,0.92)", fontSize: 13, fontWeight: 700, marginBottom: 18 },
  winBtn: { display: "block", width: "100%", background: "#fff", color: C.accent, border: "none", borderRadius: 999, padding: "14px 30px", fontFamily: "'Nunito',sans-serif", fontWeight: 900, fontSize: 15, cursor: "pointer", boxShadow: "0 8px 24px rgba(0,20,60,0.28)" },
  winGhost: { display: "block", width: "100%", marginTop: 10, background: "transparent", color: "#fff", border: "none", padding: 10, fontFamily: "'Nunito',sans-serif", fontWeight: 800, fontSize: 14, cursor: "pointer" },
});

let S = makeStyles(C);

function applyTheme(dark) {
  Object.assign(C, dark ? DARK : LIGHT);
  C.__dark = dark;
  S = makeStyles(C);
  CSS = makeCSS(C);
}

