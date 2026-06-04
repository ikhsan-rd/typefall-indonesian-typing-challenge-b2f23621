/* ============================================================
   Beatmap generation + caching
   - Analyze audio ONCE → master events (with chord candidates)
   - Derive 4 difficulty charts from the same master beatmap
   - Cache to localStorage keyed by songId + algorithmVersion
   ============================================================ */

export const ALGO_VERSION = 2;

export type Lane = 0 | 1 | 2 | 3 | 4 | 5;
export type Band = 0 | 1 | 2;
export type Difficulty = "easy" | "normal" | "hard" | "expert";

export type Note = {
  id: number;
  lane: Lane;
  time: number;
  hit: boolean;
  judged: boolean;
};

export type MasterEvent = {
  t: number;
  band: Band; // dominant band
  score: number; // composite ranking score
  bands: { band: Band; score: number }[]; // chord candidates (incl. dominant)
};

export type MasterBeatmap = {
  songId: string;
  algorithmVersion: number;
  bpm: number;
  duration: number;
  generatedAt: string;
  masterEvents: MasterEvent[];
  easy: Note[];
  normal: Note[];
  hard: Note[];
  expert: Note[];
};

/* -------- Per-difficulty parameters -------- */
const DIFF_PARAMS: Record<
  Difficulty,
  {
    keepPct: number; // 0..1 — top fraction of master events to keep
    minSpacing: number; // seconds between successive events
    targetDensity: number; // notes/sec hard cap
    chordMode: "off" | "rare" | "regular" | "all";
    chordProb: number; // 0..1 probability to materialize chord when allowed
  }
> = {
  easy:   { keepPct: 0.28, minSpacing: 0.45, targetDensity: 2,  chordMode: "off",     chordProb: 0 },
  normal: { keepPct: 0.48, minSpacing: 0.26, targetDensity: 4,  chordMode: "rare",    chordProb: 0.2 },
  hard:   { keepPct: 0.72, minSpacing: 0.17, targetDensity: 6,  chordMode: "regular", chordProb: 0.55 },
  expert: { keepPct: 0.95, minSpacing: 0.10, targetDensity: 10, chordMode: "all",     chordProb: 0.85 },
};

/* -------- Lane zones & patterns (per band) -------- */
const BAND_LANES: Record<Band, [Lane, Lane]> = {
  0: [0, 1],
  1: [2, 3],
  2: [4, 5],
};
const PATTERNS: Record<Band, number[][]> = {
  0: [[0,1,0,1],[0,0,1],[1,0,1],[0,1,1,0]],
  1: [[0,1,0,1],[0,0,1],[1,0,1],[0,1,0,0]],
  2: [[0,1,0,1],[0,0,1],[1,0,1],[1,1,0,1]],
};

/* ============================================================
   Audio analysis → MasterEvent[]
   Multi-band spectral flux + adaptive threshold + chord merging
   ============================================================ */
function extractMasterEvents(buffer: AudioBuffer): MasterEvent[] {
  const sr = buffer.sampleRate;
  const chs = buffer.numberOfChannels;
  const N = buffer.length;
  const mono = new Float32Array(N);
  for (let c = 0; c < chs; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < N; i++) mono[i] += d[i] / chs;
  }

  const alphaLP = (fc: number) => Math.exp((-2 * Math.PI * fc) / sr);
  const lpA = alphaLP(200);
  const midLoA = alphaLP(2000);
  const midHiA = alphaLP(200);
  const hpA = alphaLP(2000);

  const hop = Math.floor(sr * 0.011);
  const nFrames = Math.floor(N / hop);
  const eLow = new Float32Array(nFrames);
  const eMid = new Float32Array(nFrames);
  const eHigh = new Float32Array(nFrames);

  let lpPrev = 0, midLoPrev = 0, midHiPrev = 0, hpPrev = 0;
  let idx = 0, accL = 0, accM = 0, accH = 0, cnt = 0;
  for (let i = 0; i < N; i++) {
    const s = mono[i];
    lpPrev = lpPrev * lpA + s * (1 - lpA);
    midLoPrev = midLoPrev * midLoA + s * (1 - midLoA);
    midHiPrev = midHiPrev * midHiA + s * (1 - midHiA);
    hpPrev = hpPrev * hpA + s * (1 - hpA);
    const low = lpPrev;
    const mid = midLoPrev - midHiPrev;
    const high = s - hpPrev;
    accL += low * low; accM += mid * mid; accH += high * high; cnt++;
    if (cnt >= hop) {
      eLow[idx] = Math.sqrt(accL / cnt);
      eMid[idx] = Math.sqrt(accM / cnt);
      eHigh[idx] = Math.sqrt(accH / cnt);
      idx++; accL = accM = accH = 0; cnt = 0;
      if (idx >= nFrames) break;
    }
  }

  const flux = (e: Float32Array) => {
    const f = new Float32Array(e.length);
    for (let i = 1; i < e.length; i++) {
      const d = e[i] - e[i - 1];
      f[i] = d > 0 ? d : 0;
    }
    return f;
  };
  const fLow = flux(eLow), fMid = flux(eMid), fHigh = flux(eHigh);
  const combined = new Float32Array(nFrames);
  for (let i = 0; i < nFrames; i++) combined[i] = fLow[i] * 1.3 + fMid[i] + fHigh[i] * 0.9;

  const win = Math.max(8, Math.floor(0.4 / 0.011));
  const localMean = new Float32Array(nFrames);
  let run = 0;
  for (let i = 0; i < nFrames; i++) {
    run += combined[i];
    if (i >= win) run -= combined[i - win];
    localMean[i] = run / Math.min(i + 1, win);
  }
  const sensitivity = 1.55;
  const floor = 0.005;
  const minGap = Math.floor(0.08 / 0.011); // 80ms — keep tighter so chords survive

  type Peak = { i: number; t: number; band: Band; score: number };
  const peaks: Peak[] = [];
  let last = -minGap;
  for (let i = 2; i < nFrames - 2; i++) {
    const v = combined[i];
    const th = localMean[i] * sensitivity + floor;
    if (
      v > th &&
      v >= combined[i - 1] && v >= combined[i + 1] &&
      v >= combined[i - 2] && v >= combined[i + 2] &&
      i - last >= minGap
    ) {
      const a = fLow[i], b = fMid[i], c = fHigh[i];
      let band: Band = 0;
      if (b >= a && b >= c) band = 1;
      else if (c >= a && c >= b) band = 2;
      const fluxAt = band === 0 ? a : band === 1 ? b : c;
      const eAt = band === 0 ? eLow[i] : band === 1 ? eMid[i] : eHigh[i];
      const eDelta = Math.max(0, eAt - (band === 0 ? eLow[i-1] : band === 1 ? eMid[i-1] : eHigh[i-1]));
      const score = fluxAt + eDelta * 1.5 + v;
      peaks.push({ i, t: (i * hop) / sr, band, score });
      last = i;
    }
  }

  // Build master events: merge peaks within 50ms across bands into chord candidates
  const CHORD_TOL = 0.05;
  const events: MasterEvent[] = [];
  for (const p of peaks) {
    if (p.t < 0.8) continue;
    const prev = events[events.length - 1];
    if (prev && p.t - prev.t <= CHORD_TOL && !prev.bands.some((x) => x.band === p.band)) {
      prev.bands.push({ band: p.band, score: p.score });
      prev.t = (prev.t + p.t) / 2;
      if (p.score > prev.score) {
        prev.score = p.score;
        prev.band = p.band;
      }
    } else {
      events.push({ t: p.t, band: p.band, score: p.score, bands: [{ band: p.band, score: p.score }] });
    }
  }
  return events;
}

/* ============================================================
   MasterEvent[] → difficulty Note[]
   ============================================================ */
function buildChart(master: MasterEvent[], diff: Difficulty, duration: number): Note[] {
  const P = DIFF_PARAMS[diff];
  if (master.length === 0) return [];

  // 1) Rank by composite score, keep top keepPct
  const sortedByScore = [...master].sort((a, b) => b.score - a.score);
  const keepN = Math.max(8, Math.floor(sortedByScore.length * P.keepPct));
  const ranked = sortedByScore.slice(0, keepN);

  // 2) Greedy spacing pick — strongest-first, enforce minSpacing
  const pickedTimes: number[] = [];
  const picked: MasterEvent[] = [];
  for (const ev of ranked) {
    let ok = true;
    for (const t of pickedTimes) {
      if (Math.abs(t - ev.t) < P.minSpacing) { ok = false; break; }
    }
    if (ok) {
      picked.push(ev);
      pickedTimes.push(ev.t);
    }
  }

  // 3) Cap to target density via 1s sliding window
  picked.sort((a, b) => a.t - b.t);
  const capped: MasterEvent[] = [];
  const windowQ: { t: number; score: number; idx: number }[] = [];
  for (const ev of picked) {
    while (windowQ.length && ev.t - windowQ[0].t > 1) windowQ.shift();
    if (windowQ.length >= P.targetDensity) {
      // drop weakest in window if current is stronger; else skip current
      const weakest = windowQ.reduce((m, x) => (x.score < m.score ? x : m), windowQ[0]);
      if (ev.score > weakest.score) {
        capped[weakest.idx] = ev;
        windowQ.splice(windowQ.indexOf(weakest), 1);
        windowQ.push({ t: ev.t, score: ev.score, idx: weakest.idx });
      }
      continue;
    }
    const idx = capped.length;
    capped.push(ev);
    windowQ.push({ t: ev.t, score: ev.score, idx });
  }

  // 4) Apply lane mapping with lane memory + pattern engine + chord rules
  return mapToNotes(capped, diff);
  void duration;
}

function mapToNotes(events: MasterEvent[], diff: Difficulty): Note[] {
  const P = DIFF_PARAMS[diff];
  const lastLane: Record<Band, 0 | 1> = { 0: 0, 1: 0, 2: 0 };
  const runCount: Record<Band, number> = { 0: 0, 1: 0, 2: 0 };
  const runPattern: Record<Band, { pat: number[]; idx: number } | null> = { 0: null, 1: null, 2: null };
  const RUN_GAP = 0.6;
  const lastBandT: Record<Band, number> = { 0: -99, 1: -99, 2: -99 };

  const zoneFor = (band: Band, t: number): 0 | 1 => {
    if (t - lastBandT[band] <= RUN_GAP) runCount[band]++;
    else { runCount[band] = 1; runPattern[band] = null; }
    lastBandT[band] = t;

    if (runCount[band] >= 3) {
      if (!runPattern[band]) {
        const pats = PATTERNS[band];
        runPattern[band] = { pat: pats[Math.floor(Math.random() * pats.length)], idx: 0 };
      }
      const rp = runPattern[band]!;
      const v = rp.pat[rp.idx % rp.pat.length] as 0 | 1;
      rp.idx++;
      lastLane[band] = v;
      return v;
    }
    const r = Math.random();
    const prev = lastLane[band];
    const next: 0 | 1 = r < 0.7 ? prev : ((1 - prev) as 0 | 1);
    lastLane[band] = next;
    return next;
  };

  const notes: Note[] = [];
  let id = 0;
  for (const ev of events) {
    // Decide chord size based on difficulty
    let useBands: Band[];
    const candidates = [...ev.bands].sort((a, b) => b.score - a.score);
    if (P.chordMode === "off" || candidates.length < 2) {
      useBands = [candidates[0].band];
    } else if (P.chordMode === "all") {
      // include every band that contributed
      useBands = candidates.map((b) => b.band);
    } else {
      // rare / regular — probabilistic 2-note chord (3 only on expert)
      if (Math.random() < P.chordProb) {
        useBands = candidates.slice(0, 2).map((b) => b.band);
      } else {
        useBands = [candidates[0].band];
      }
    }

    for (const band of useBands) {
      const z = zoneFor(band, ev.t);
      const lane = BAND_LANES[band][z];
      notes.push({ id: id++, lane, time: ev.t, hit: false, judged: false });
    }
  }
  return notes;
}

/* ============================================================
   Public API
   ============================================================ */
export function buildBeatmap(buffer: AudioBuffer, songId: string): MasterBeatmap {
  const masterEvents = extractMasterEvents(buffer);
  const duration = buffer.duration;
  const bm: MasterBeatmap = {
    songId,
    algorithmVersion: ALGO_VERSION,
    bpm: 0,
    duration,
    generatedAt: new Date().toISOString(),
    masterEvents,
    easy: buildChart(masterEvents, "easy", duration),
    normal: buildChart(masterEvents, "normal", duration),
    hard: buildChart(masterEvents, "hard", duration),
    expert: buildChart(masterEvents, "expert", duration),
  };
  // Fallback grid if a difficulty ended up too sparse
  for (const d of ["easy", "normal", "hard", "expert"] as Difficulty[]) {
    if (bm[d].length < 12 && duration > 5) {
      const step = d === "easy" ? 1.0 : d === "normal" ? 0.6 : d === "hard" ? 0.4 : 0.3;
      const fill: Note[] = [];
      let id = 0;
      for (let t = 1.5; t < duration - 1; t += step) {
        fill.push({ id: id++, lane: (id % 6) as Lane, time: t, hit: false, judged: false });
      }
      bm[d] = fill;
    }
  }
  return bm;
}

export function getChart(bm: MasterBeatmap, diff: Difficulty): Note[] {
  // return fresh copies so the runtime can mutate hit/judged safely
  return bm[diff].map((n) => ({ ...n, hit: false, judged: false }));
}

/* -------- localStorage cache -------- */
const cacheKey = (songId: string) => `typinghero:beatmap:${songId}`;

export function loadCachedBeatmap(songId: string): MasterBeatmap | null {
  try {
    const raw = localStorage.getItem(cacheKey(songId));
    if (!raw) return null;
    const bm = JSON.parse(raw) as MasterBeatmap;
    if (!bm || bm.algorithmVersion !== ALGO_VERSION) return null;
    return bm;
  } catch {
    return null;
  }
}

export function saveCachedBeatmap(bm: MasterBeatmap): void {
  try {
    localStorage.setItem(cacheKey(bm.songId), JSON.stringify(bm));
  } catch {
    // quota / private mode — ignore
  }
}
