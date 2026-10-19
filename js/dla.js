/*
  Lightning and Coral
  Diffusion-limited aggregation (Witten and Sander, 1981): particles
  wander at random until they touch the growing cluster, and stick. The
  same rule grows coral, frost and mineral dendrites. Lightning uses its
  cousin, the dielectric breakdown model (Niemeyer, Pietronero and
  Wiesmann, 1984): the bolt grows where the electric field is strongest.
  https://github.com/evoluteur/lightning-and-coral
  (c) 2026 Olivier Giulieri
*/

const G = 400; // the grid is G x G

const FORMS = {
  coral: { name: "Coral", palette: "reef", stick: 0.9, drift: 0.15, text: "Grows up from the sea floor: particles rain down and stick to the tips." },
  lightning: { name: "Lightning", palette: "storm", stick: 1, drift: 0, text: "Steps down from the cloud where the electric field is strongest, until one branch strikes the ground." },
  frost: { name: "Frost", palette: "frost", stick: 0.6, drift: 0, text: "Grows out from a single grain in all directions, like frost on a window." },
  crystal: { name: "Six-fold crystal", palette: "frost", stick: 0.5, drift: 0, text: "The same growth, mirrored twelve ways around the center: a snow crystal." },
  roots: { name: "Roots", palette: "earth", stick: 0.35, drift: 0.2, text: "Hangs down from the surface: sticking less often, the branches grow thicker." },
};

const PALETTES = {
  storm: { name: "Storm", bg: "#05040f", stops: ["#ffffff", "#d8ccff", "#8b6cff", "#4a2ba8"], glow: true },
  reef: { name: "Reef", bg: "#041a2b", stops: ["#ffd3b0", "#ff8a66", "#e0457b", "#7a2a8c"], glow: true },
  frost: { name: "Frost", bg: "#06121f", stops: ["#ffffff", "#bff1ff", "#5cc4f0", "#2a5fa8"], glow: true },
  earth: { name: "Earth", bg: "#e9dcc2", stops: ["#2b1a0e", "#5c3a1e", "#8a5a2e", "#b98a52"], glow: false },
  ink: { name: "Ink on paper", bg: "#f3eee2", stops: ["#1c1b19", "#2e2a24", "#4a443a", "#7d7463"], glow: false },
  gold: { name: "Gold", bg: "#0b0906", stops: ["#fff4d6", "#e0b54f", "#a87a1f", "#5a3f0f"], glow: true },
};

const state = {
  form: "coral",
  stick: 0.9, // chance of sticking on contact
  drift: 0.15, // pull of the walkers toward the cluster
  eta: 1.5, // lightning: how strongly the field picks the next step (more: fewer branches)
  palette: "reef",
  seed: 1,
  running: true,
};

let canvas, ctx, off, offCtx, img, px;
let grid, count = 0, done = false, reach = 0; // reach: how far the cluster has grown from its seed
let rand;
let parent, pts, channel = null; // lightning

// a small seeded generator, so the same seed grows the same picture
const rng = (s) => {
  let a = s >>> 0 || 1;
  return () => {
    a ^= a << 13;
    a ^= a >>> 17;
    a ^= a << 5;
    return (a >>> 0) / 4294967296;
  };
};

// ------------------------------------------------------------ colors

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
let colors = []; // 256 colors along the palette
const makeColors = () => {
  const stops = PALETTES[state.palette].stops.map(hex);
  colors = [];
  for (let i = 0; i < 256; i++) {
    const t = (i / 255) * (stops.length - 1);
    const k = Math.min(stops.length - 2, Math.floor(t)), f = t - k;
    const c = stops[k].map((v, j) => Math.round(v + (stops[k + 1][j] - v) * f));
    colors.push((255 << 24) | (c[2] << 16) | (c[1] << 8) | c[0]);
  }
};

// ------------------------------------------------------------ the cluster

const radial = () => state.form === "frost" || state.form === "crystal";
const C = G / 2;

// where a particle at (x, y) sits along the growth, 0 at the seed, 1 at the edge
const along = (x, y) => {
  if (radial()) return Math.hypot(x - C, y - C) / C;
  if (state.form === "coral") return (G - 1 - y) / G;
  return y / G; // lightning, roots: from the top down
};

const stickAt = (x, y) => {
  const put = (X, Y) => {
    if (X < 0 || Y < 0 || X >= G || Y >= G) return;
    const k = Y * G + X;
    if (grid[k]) return;
    grid[k] = 1;
    px[k] = colors[Math.min(255, Math.floor(along(X, Y) * 255 * 1.4))];
    count++;
  };
  if (state.form === "crystal") {
    // twelve copies: six rotations, each mirrored
    const dx = x - C, dy = y - C;
    const r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    for (let k = 0; k < 6; k++)
      for (const s of [1, -1]) {
        const b = s * a + (k * Math.PI) / 3;
        put(Math.round(C + r * Math.cos(b)), Math.round(C + r * Math.sin(b)));
      }
  } else put(x, y);
  const d = radial() ? Math.hypot(x - C, y - C) : state.form === "coral" ? G - 1 - y : y;
  if (d > reach) reach = d;
  if (state.form !== "lightning" && reach > (radial() ? C - 4 : G - 4)) done = true;
};

const reset = () => {
  grid = new Uint8Array(G * G);
  px = new Uint32Array(img.data.buffer);
  px.fill(0);
  count = 0;
  reach = 0;
  done = false;
  rand = rng(state.seed * 2654435761);
  makeColors();
  if (radial()) stickAt(C, C);
  else if (state.form === "lightning") resetBolt();
  else {
    // a few starting points, spread out: separate coral heads, separate roots
    const y = state.form === "coral" ? G - 1 : 0;
    const n = 3 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) stickAt(Math.floor(((i + 0.25 + rand() * 0.5) / n) * G), y);
  }
  reach = 0;
  done = false;
  saveHash();
};

const touches = (x, y) => {
  for (let dy = -1; dy <= 1; dy++) {
    const Y = y + dy;
    if (Y < 0 || Y >= G) continue;
    for (let dx = -1; dx <= 1; dx++) {
      const X = (x + dx + G) % G;
      if (grid[Y * G + X]) return true;
    }
  }
  return false;
};

// release one walker and let it wander until it sticks (or wanders off)
const walk = () => {
  let x, y;
  const R = reach + 6;
  if (radial()) {
    const a = rand() * Math.PI * 2;
    x = C + Math.cos(a) * R;
    y = C + Math.sin(a) * R;
  } else {
    x = rand() * G;
    y = state.form === "coral" ? G - 1 - R : R;
  }
  const kill = R * 2 + 20;
  // the drift pulls toward the seed: down for coral, up for roots, inward for frost
  for (let steps = 0; steps < 20000; steps++) {
    let gap; // how far the walker is from the region where the cluster might be
    if (radial()) gap = Math.hypot(x - C, y - C) - reach - 2;
    else if (state.form === "coral") gap = G - 1 - reach - 2 - y;
    else gap = y - reach - 2;
    const s = gap > 4 ? gap - 2 : 1; // big jumps far away, single steps near the cluster
    const a = rand() * Math.PI * 2;
    x += Math.cos(a) * s;
    y += Math.sin(a) * s;
    if (state.drift) {
      if (radial()) {
        const d = Math.hypot(x - C, y - C) || 1;
        x -= ((x - C) / d) * state.drift;
        y -= ((y - C) / d) * state.drift;
      } else y += state.form === "coral" ? state.drift : -state.drift;
    }
    x = (x + G) % G; // wrap left and right
    if (radial()) {
      if (Math.hypot(x - C, y - C) > kill) return;
    } else if (y < 0 || y >= G) {
      if (state.form === "coral" ? y < 0 : y >= G) return;
      y = Math.max(0, Math.min(G - 1, y));
    }
    const X = Math.round(x) % G, Y = Math.round(y);
    if (Y < 0 || Y >= G) continue;
    if (grid[Y * G + X]) continue;
    if (s === 1 && touches(X, Y) && rand() < state.stick) {
      stickAt(X, Y);
      return;
    }
  }
};

// ------------------------------------------------------------ lightning

// The dielectric breakdown model, on its own coarser grid: the electric
// potential is 0 on the cloud and on the bolt, 1 on the ground, and solved
// in between (Laplace's equation, by successive over-relaxation). The bolt
// then steps to a cell next to it, with a probability of the potential
// there to the power eta: the field is strongest at the tips.
const L = 160;
// the bolt steps to any of its eight neighbors, straight ones first
const NB = [[0, -1], [-1, 0], [1, 0], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
let phi, bolt, cands;

const resetBolt = () => {
  phi = new Float32Array(L * L);
  bolt = new Uint8Array(L * L);
  parent = new Int32Array(L * L).fill(-1);
  cands = new Set();
  channel = null;
  pts = [];
  for (let y = 0; y < L; y++) for (let x = 0; x < L; x++) phi[y * L + x] = y / (L - 1);
  addBolt(L >> 1, 1, -1);
};

const relax = (sweeps) => {
  for (let n = 0; n < sweeps; n++)
    for (let y = 1; y < L - 1; y++) {
      const row = y * L;
      for (let x = 0; x < L; x++) {
        const k = row + x;
        if (bolt[k]) continue;
        const l = x ? k - 1 : k + 1, r = x < L - 1 ? k + 1 : k - 1; // the sides mirror
        const v = (phi[l] + phi[r] + phi[k - L] + phi[k + L]) / 4;
        phi[k] += 1.85 * (v - phi[k]);
      }
    }
};

const addBolt = (x, y, from) => {
  const k = y * L + x;
  bolt[k] = 1;
  phi[k] = 0;
  parent[k] = from;
  cands.delete(k);
  pts.push(k);
  count = pts.length;
  for (const [dx, dy] of NB) {
    const X = x + dx, Y = y + dy;
    if (X < 0 || X >= L || Y < 1 || Y >= L - 1) continue;
    const c = Y * L + X;
    if (!bolt[c]) cands.add(c);
  }
};

const growBolt = () => {
  relax(6);
  let total = 0;
  const ws = [];
  for (const c of cands) {
    const w = Math.pow(Math.max(0, phi[c]), state.eta);
    ws.push(w);
    total += w;
  }
  let r = rand() * total, i = 0, pick;
  for (const c of cands) {
    pick = c;
    r -= ws[i++];
    if (r <= 0) break;
  }
  const x = pick % L, y = (pick / L) | 0;
  // its parent: the bolt cell next to it
  let from = -1;
  for (const [dx, dy] of NB) {
    const X = x + dx, Y = y + dy;
    if (X >= 0 && X < L && Y >= 0 && Y < L && bolt[Y * L + X]) {
      from = Y * L + X;
      break;
    }
  }
  addBolt(x, y, from);
  if (y >= L - 2) strike(pick);
};

// the return stroke: the path from the cloud to the ground lights up
const strike = (k) => {
  done = true;
  channel = [];
  for (; k >= 0; k = parent[k]) channel.push(k);
};

const drawBolt = (w) => {
  if (!pts) return;
  const s = w / L, pal = PALETTES[state.palette];
  const P = (k) => [((k % L) + 0.5) * s, (((k / L) | 0) + 0.5) * s];
  ctx.save();
  ctx.lineCap = ctx.lineJoin = "round";
  // the branches
  ctx.beginPath();
  for (const k of pts) {
    if (parent[k] < 0) continue;
    ctx.moveTo(...P(parent[k]));
    ctx.lineTo(...P(k));
  }
  ctx.strokeStyle = channel ? pal.stops[2] : pal.stops[1];
  ctx.lineWidth = Math.max(1, w / 500);
  if (pal.glow) {
    ctx.shadowColor = pal.stops[2];
    ctx.shadowBlur = w / 80;
  }
  ctx.stroke();
  // the stroke that reached the ground
  if (channel) {
    ctx.beginPath();
    channel.forEach((k, i) => (i ? ctx.lineTo(...P(k)) : ctx.moveTo(...P(k))));
    ctx.strokeStyle = pal.stops[0];
    ctx.lineWidth = Math.max(2, w / 200);
    if (pal.glow) {
      ctx.shadowColor = pal.stops[1];
      ctx.shadowBlur = w / 30;
      ctx.stroke();
      ctx.shadowBlur = w / 90;
    }
    ctx.stroke();
  }
  ctx.restore();
};

// ------------------------------------------------------------ drawing

const draw = () => {
  const pal = PALETTES[state.palette];
  offCtx.putImageData(img, 0, 0);
  const w = canvas.width;
  ctx.globalCompositeOperation = "source-over";
  ctx.filter = "none";
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, w, w);
  ctx.imageSmoothingEnabled = true;
  if (pal.glow) {
    // a soft glow under the sharp picture
    ctx.globalCompositeOperation = "lighter";
    ctx.filter = `blur(${Math.round(w / 120)}px)`;
    ctx.globalAlpha = 0.9;
    ctx.drawImage(off, 0, 0, w, w);
    ctx.filter = "none";
    ctx.globalAlpha = 1;
  }
  ctx.drawImage(off, 0, 0, w, w);
  ctx.globalCompositeOperation = "source-over";
  if (state.form === "lightning") drawBolt(w);
  $("v-count").textContent = count.toLocaleString("en-US");
};

const loop = () => {
  if (state.running && !done) {
    const t0 = performance.now();
    const grow = state.form === "lightning" ? growBolt : walk;
    const batch = state.form === "lightning" ? 1 : 20;
    while (performance.now() - t0 < 14 && !done) for (let i = 0; i < batch && !done; i++) grow();
    draw();
    if (done) $("btn-run").textContent = "Done";
  }
  requestAnimationFrame(loop);
};

// ------------------------------------------------------------ controls

const $ = (id) => document.getElementById(id);

let hashTimer;
const saveHash = () => {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    const q = new URLSearchParams({ f: state.form, s: state.seed, c: state.palette });
    if (state.form === "lightning") q.set("e", state.eta);
    else {
      q.set("k", state.stick);
      q.set("d", state.drift);
    }
    history.replaceState(null, "", "#" + q.toString());
  }, 300);
};

const readHash = () => {
  const q = new URLSearchParams(location.hash.slice(1));
  if (FORMS[q.get("f")]) Object.assign(state, pick(FORMS[q.get("f")]), { form: q.get("f") });
  if (PALETTES[q.get("c")]) state.palette = q.get("c");
  const s = +q.get("s"), k = parseFloat(q.get("k")), d = parseFloat(q.get("d"));
  if (s > 0) state.seed = Math.floor(s);
  if (k > 0 && k <= 1) state.stick = k;
  if (d >= 0 && d <= 1) state.drift = d;
  const e = parseFloat(q.get("e"));
  if (e >= 1 && e <= 8) state.eta = e;
};
const pick = (f) => ({ palette: f.palette, stick: f.stick, drift: f.drift });

const showValues = () => {
  $("v-stick").textContent = Math.round(state.stick * 100) + "%";
  $("v-drift").textContent = state.drift ? state.drift.toFixed(2) : "none";
  $("form-text").textContent = FORMS[state.form].text;
  $("v-eta").textContent = state.eta;
  const bolt = state.form === "lightning";
  $("walk-box").hidden = bolt;
  $("eta-box").hidden = !bolt;
};
const sync = () => {
  $("form").value = state.form;
  $("palette").value = state.palette;
  $("stick").value = state.stick;
  $("drift").value = state.drift;
  $("eta").value = state.eta;
  showValues();
};

const restart = () => {
  reset();
  state.running = true;
  $("btn-run").textContent = "Pause";
  draw();
};

const options = (o) => Object.entries(o).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join("");

const initDLA = () => {
  canvas = $("dla");
  ctx = canvas.getContext("2d");
  off = document.createElement("canvas");
  off.width = off.height = G;
  offCtx = off.getContext("2d");
  img = offCtx.createImageData(G, G);
  readHash();
  $("form").innerHTML = options(FORMS);
  $("palette").innerHTML = options(PALETTES);
  sync();
  const fit = () => {
    const r = canvas.getBoundingClientRect();
    const w = Math.round(r.width * Math.min(2, window.devicePixelRatio || 1));
    if (w && canvas.width !== w) {
      canvas.width = canvas.height = w;
      draw();
    }
  };
  fit();
  window.addEventListener("resize", fit);

  $("form").addEventListener("change", (e) => {
    state.form = e.target.value;
    Object.assign(state, pick(FORMS[state.form]));
    sync();
    restart();
  });
  $("stick").addEventListener("input", (e) => {
    state.stick = +e.target.value;
    showValues();
  });
  $("drift").addEventListener("input", (e) => {
    state.drift = +e.target.value;
    showValues();
  });
  $("eta").addEventListener("input", (e) => {
    state.eta = +e.target.value;
    showValues();
  });
  ["stick", "drift", "eta"].forEach((id) => $(id).addEventListener("change", restart));
  $("palette").addEventListener("change", (e) => {
    state.palette = e.target.value;
    // recolor what has grown so far
    makeColors();
    for (let y = 0; y < G; y++)
      for (let x = 0; x < G; x++) if (grid[y * G + x]) px[y * G + x] = colors[Math.min(255, Math.floor(along(x, y) * 255 * 1.4))];
    draw();
    saveHash();
  });
  $("btn-run").addEventListener("click", () => {
    if (done) return;
    state.running = !state.running;
    $("btn-run").textContent = state.running ? "Pause" : "Grow";
  });
  $("btn-new").addEventListener("click", () => {
    state.seed = 1 + Math.floor(Math.random() * 1e6);
    restart();
  });
  $("btn-png").addEventListener("click", () => {
    canvas.toBlob((b) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = `${state.form}-${state.seed}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
  });
  // a click plants a new seed for the particles to stick to
  canvas.addEventListener("click", (e) => {
    if (state.form === "lightning") return;
    const r = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * G), y = Math.floor(((e.clientY - r.top) / r.height) * G);
    const keep = reach;
    stickAt(x, y);
    reach = Math.max(keep, Math.min(reach, radial() ? C - 10 : G - 10));
    done = false;
    draw();
  });

  reset();
  draw();
  requestAnimationFrame(loop);
};
