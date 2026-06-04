import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Play, Pause, RotateCcw, Music, Trophy, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { submitScore, loadSavedName, saveName, sanitizeName } from "@/lib/scores";
import { fetchTrending, searchTracks, type AudiusTrack } from "@/lib/audius";
import {
  buildBeatmap,
  getChart,
  loadCachedBeatmap,
  saveCachedBeatmap,
  type Difficulty,
  type MasterBeatmap,
  type Note,
} from "@/lib/beatmap";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

/* ============================================================
   TypingHero — 6-lane falling notes game powered by Audius
   Keys: A S D  J K L
   ============================================================ */

const LANE_KEYS = ["a", "s", "d", "j", "k", "l"] as const;
const LANE_COLORS = [
  "from-rose-500 to-pink-600",
  "from-amber-400 to-orange-500",
  "from-lime-400 to-emerald-500",
  "from-cyan-400 to-sky-500",
  "from-indigo-400 to-violet-500",
  "from-fuchsia-500 to-purple-600",
];
const LANE_RING = [
  "shadow-rose-500/60",
  "shadow-amber-400/60",
  "shadow-lime-400/60",
  "shadow-cyan-400/60",
  "shadow-indigo-400/60",
  "shadow-fuchsia-500/60",
];

type Judgement = { id: number; lane: number; text: string; color: string; at: number };

const FALL_DURATION = 1.6;
const HIT_LINE_RATIO = 0.84;
const PERFECT_WINDOW = 0.06;
const GOOD_WINDOW = 0.14;
const MISS_WINDOW = 0.18;

const DIFFICULTIES: { id: Difficulty; label: string; desc: string; color: string }[] = [
  { id: "easy",   label: "Easy",   desc: "1–2 nps · pemula",        color: "from-emerald-400 to-lime-500" },
  { id: "normal", label: "Normal", desc: "2–4 nps · casual",         color: "from-cyan-400 to-sky-500" },
  { id: "hard",   label: "Hard",   desc: "4–6 nps · berpengalaman",  color: "from-amber-400 to-orange-500" },
  { id: "expert", label: "Expert", desc: "6–10+ nps · veteran",      color: "from-rose-500 to-fuchsia-600" },
];

/* ---------- Beat detection (multi-band spectral flux + adaptive threshold) ---------- */
// Downmix to mono, split into 3 bands using simple IIR filters,
// compute per-band energy per ~11ms hop, take positive spectral flux,
// pick peaks above local median*sensitivity, and map band -> lane group.
function detectNotes(buffer: AudioBuffer): Note[] {
  const sr = buffer.sampleRate;
  const chs = buffer.numberOfChannels;
  const N = buffer.length;
  // mono mix
  const mono = new Float32Array(N);
  for (let c = 0; c < chs; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < N; i++) mono[i] += d[i] / chs;
  }

  // One-pole filter helper. cutoff in Hz.
  const alphaLP = (fc: number) => {
    const x = Math.exp((-2 * Math.PI * fc) / sr);
    return x;
  };
  // Low band: lowpass at 200 Hz (kick/bass)
  // Mid band: bandpass 200..2000 Hz (snare/vocals)
  // High band: highpass at 2000 Hz (hats/cymbals)
  const lpA = alphaLP(200);
  const midLoA = alphaLP(2000);
  const midHiA = alphaLP(200);
  const hpA = alphaLP(2000);

  const hop = Math.floor(sr * 0.011); // ~11ms
  const nFrames = Math.floor(N / hop);
  const eLow = new Float32Array(nFrames);
  const eMid = new Float32Array(nFrames);
  const eHigh = new Float32Array(nFrames);

  let lpPrev = 0;
  let midLoPrev = 0;
  let midHiPrev = 0;
  let hpPrev = 0;
  let prevSample = 0;

  let idx = 0;
  let accLow = 0;
  let accMid = 0;
  let accHigh = 0;
  let cnt = 0;
  for (let i = 0; i < N; i++) {
    const s = mono[i];
    // low-pass
    lpPrev = lpPrev * lpA + s * (1 - lpA);
    const low = lpPrev;
    // wider lowpass for mid upper bound
    midLoPrev = midLoPrev * midLoA + s * (1 - midLoA);
    midHiPrev = midHiPrev * midHiA + s * (1 - midHiA);
    const mid = midLoPrev - midHiPrev;
    // high-pass via x - lowpass
    hpPrev = hpPrev * hpA + s * (1 - hpA);
    const high = s - hpPrev;
    void prevSample;
    prevSample = s;

    accLow += low * low;
    accMid += mid * mid;
    accHigh += high * high;
    cnt++;
    if (cnt >= hop) {
      eLow[idx] = Math.sqrt(accLow / cnt);
      eMid[idx] = Math.sqrt(accMid / cnt);
      eHigh[idx] = Math.sqrt(accHigh / cnt);
      idx++;
      accLow = accMid = accHigh = 0;
      cnt = 0;
      if (idx >= nFrames) break;
    }
  }

  // Spectral flux per band (positive differences)
  const fluxBand = (e: Float32Array) => {
    const f = new Float32Array(e.length);
    for (let i = 1; i < e.length; i++) {
      const d = e[i] - e[i - 1];
      f[i] = d > 0 ? d : 0;
    }
    return f;
  };
  const fLow = fluxBand(eLow);
  const fMid = fluxBand(eMid);
  const fHigh = fluxBand(eHigh);

  // Combined onset function for tempo-agnostic peak picking
  const flux = new Float32Array(nFrames);
  for (let i = 0; i < nFrames; i++) flux[i] = fLow[i] * 1.3 + fMid[i] + fHigh[i] * 0.9;

  // Adaptive threshold: local mean over ~0.4s window
  const win = Math.max(8, Math.floor(0.4 / 0.011));
  const localMean = new Float32Array(nFrames);
  let runSum = 0;
  for (let i = 0; i < nFrames; i++) {
    runSum += flux[i];
    if (i >= win) runSum -= flux[i - win];
    localMean[i] = runSum / Math.min(i + 1, win);
  }
  const sensitivity = 1.55;
  const floor = 0.005;
  const minGapFrames = Math.floor(0.12 / 0.011); // 120ms

  // Pick peaks
  type Peak = { i: number; t: number; band: 0 | 1 | 2; strength: number };
  const peaks: Peak[] = [];
  let lastPeak = -minGapFrames;
  for (let i = 2; i < nFrames - 2; i++) {
    const v = flux[i];
    const th = localMean[i] * sensitivity + floor;
    if (
      v > th &&
      v >= flux[i - 1] &&
      v >= flux[i + 1] &&
      v >= flux[i - 2] &&
      v >= flux[i + 2] &&
      i - lastPeak >= minGapFrames
    ) {
      // dominant band at this frame
      const a = fLow[i];
      const b = fMid[i];
      const c = fHigh[i];
      let band: 0 | 1 | 2 = 0;
      if (b >= a && b >= c) band = 1;
      else if (c >= a && c >= b) band = 2;
      peaks.push({ i, t: (i * hop) / sr, band, strength: v });
      lastPeak = i;
    }
  }

  /* ============================================================
     Note generation — convert peaks into a musical chart
     - Band zones: bass=A/S, mid=D/J, treble=K/L (strict)
     - Lane memory: weighted stay/switch per band
     - Pattern engine: short repeating motifs during same-band runs
     - Phrase detection: 1.5s windows shape consistent micro-charts
     - Chord detection: simultaneous bands -> multi-lane notes
     - Min spacing per band, prioritize strongest events
     ============================================================ */

  // Per-band lane zones
  const BAND_LANES: Record<0 | 1 | 2, [number, number]> = {
    0: [0, 1], // bass: A, S
    1: [2, 3], // mid: D, J
    2: [4, 5], // treble: K, L
  };
  // Patterns expressed as indices into the band's 2-lane zone (0 or 1)
  const PATTERNS: Record<0 | 1 | 2, number[][]> = {
    0: [
      [0, 1, 0, 1],
      [0, 0, 1],
      [1, 0, 1],
      [0, 1, 1, 0],
    ],
    1: [
      [0, 1, 0, 1],
      [0, 0, 1],
      [1, 0, 1],
      [0, 1, 0, 0],
    ],
    2: [
      [0, 1, 0, 1],
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 0, 1],
    ],
  };
  const MIN_SPACING: Record<0 | 1 | 2, number> = {
    0: 0.12, // bass 120ms
    1: 0.10, // mid 100ms
    2: 0.08, // treble 80ms
  };
  const CHORD_TOLERANCE = 0.05; // 50ms

  // 1) Compute composite score & filter out weak noise
  const fluxAt = (i: number, b: 0 | 1 | 2) => (b === 0 ? fLow[i] : b === 1 ? fMid[i] : fHigh[i]);
  const energyAt = (i: number, b: 0 | 1 | 2) => {
    const e = b === 0 ? eLow : b === 1 ? eMid : eHigh;
    return Math.max(0, e[i] - (e[i - 1] ?? 0));
  };
  const scored = peaks
    .filter((p) => p.t >= 0.8)
    .map((p) => ({
      ...p,
      score: fluxAt(p.i, p.band) + energyAt(p.i, p.band) * 1.5 + p.strength,
    }));

  // 2) Per-band spacing: keep stronger, drop weaker neighbors
  const perBand: Record<0 | 1 | 2, typeof scored> = { 0: [], 1: [], 2: [] };
  for (const p of scored) perBand[p.band].push(p);
  for (const b of [0, 1, 2] as const) {
    perBand[b].sort((a, b2) => a.t - b2.t);
    const kept: typeof scored = [];
    for (const p of perBand[b]) {
      const last = kept[kept.length - 1];
      if (last && p.t - last.t < MIN_SPACING[b]) {
        if (p.score > last.score) kept[kept.length - 1] = p;
      } else {
        kept.push(p);
      }
    }
    perBand[b] = kept;
  }

  // 3) Chord detection: merge near-simultaneous events across bands
  type Event = { t: number; bands: { band: 0 | 1 | 2; score: number }[] };
  const events: Event[] = [];
  const all = [...perBand[0], ...perBand[1], ...perBand[2]].sort((a, b) => a.t - b.t);
  for (const p of all) {
    const last = events[events.length - 1];
    if (last && p.t - last.t <= CHORD_TOLERANCE && !last.bands.some((x) => x.band === p.band)) {
      last.bands.push({ band: p.band, score: p.score });
      last.t = (last.t + p.t) / 2;
    } else {
      events.push({ t: p.t, bands: [{ band: p.band, score: p.score }] });
    }
  }

  // 4) Lane memory + pattern engine
  const lastLane: Record<0 | 1 | 2, 0 | 1> = { 0: 0, 1: 0, 2: 0 };
  const runCount: Record<0 | 1 | 2, number> = { 0: 0, 1: 0, 2: 0 };
  const runPattern: Record<0 | 1 | 2, { pat: number[]; idx: number } | null> = {
    0: null, 1: null, 2: null,
  };
  const RUN_GAP = 0.6; // seconds — break a run
  const lastBandT: Record<0 | 1 | 2, number> = { 0: -99, 1: -99, 2: -99 };

  const chooseZoneIdx = (band: 0 | 1 | 2, t: number): 0 | 1 => {
    // Run detection per band
    if (t - lastBandT[band] <= RUN_GAP) {
      runCount[band]++;
    } else {
      runCount[band] = 1;
      runPattern[band] = null;
    }
    lastBandT[band] = t;

    // Start a pattern after 3+ same-band events within window
    if (runCount[band] >= 3) {
      if (!runPattern[band]) {
        const pats = PATTERNS[band];
        const pat = pats[Math.floor(Math.random() * pats.length)];
        runPattern[band] = { pat, idx: 0 };
      }
      const rp = runPattern[band]!;
      const v = rp.pat[rp.idx % rp.pat.length] as 0 | 1;
      rp.idx++;
      lastLane[band] = v;
      return v;
    }

    // Weighted lane memory: 70% stay, 25% switch, 5% switch (band has only 2 lanes)
    const r = Math.random();
    const prev = lastLane[band];
    let next: 0 | 1;
    if (r < 0.7) next = prev;
    else next = (1 - prev) as 0 | 1;
    lastLane[band] = next;
    return next;
  };

  // 5) Phrase smoothing — every ~1.5s window, bias toward the dominant band's pattern
  //    (already partly handled by run/pattern engine; phrase boundaries reset runs cleanly)
  const PHRASE = 1.5;
  let phraseEnd = events[0]?.t ?? 0;
  let phraseDom: 0 | 1 | 2 | null = null;
  const phraseCount = [0, 0, 0];

  const notes: Note[] = [];
  let id = 0;
  for (const ev of events) {
    if (ev.t > phraseEnd) {
      phraseEnd = ev.t + PHRASE;
      phraseDom = null;
      phraseCount[0] = phraseCount[1] = phraseCount[2] = 0;
    }
    // Sort bands in event by score (strongest first) for chord ordering
    ev.bands.sort((a, b) => b.score - a.score);
    for (const { band } of ev.bands) {
      phraseCount[band]++;
      if (phraseDom === null || phraseCount[band] > phraseCount[phraseDom]) phraseDom = band;
      const zoneIdx = chooseZoneIdx(band, ev.t);
      const lane = BAND_LANES[band][zoneIdx];
      notes.push({ id: id++, lane, time: ev.t, hit: false, judged: false });
    }
  }
  void phraseDom;

  // Fallback: if extremely sparse, fill with quarter-note grid using estimated tempo
  if (notes.length < 20 && buffer.duration > 5) {
    const step = 0.5;
    for (let t = 1.5; t < buffer.duration - 1; t += step) {
      notes.push({ id: id++, lane: id % 6, time: t, hit: false, judged: false });
    }
    notes.sort((a, b) => a.time - b.time);
  }
  return notes;
}

/* ---------- Hit SFX ---------- */
let actx: AudioContext | null = null;
function playHit(freq: number) {
  try {
    if (!actx) actx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = "triangle";
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.12, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + 0.12);
    o.connect(g).connect(actx.destination);
    o.start();
    o.stop(actx.currentTime + 0.13);
  } catch {}
}

export default function RhythmHero() {
  const [status, setStatus] = useState<"menu" | "loading" | "ready" | "playing" | "paused" | "over" | "name">("menu");
  const [track, setTrack] = useState<AudiusTrack | null>(null);
  const [tracks, setTracks] = useState<AudiusTrack[]>([]);
  const [tracksLoading, setTracksLoading] = useState(false);
  const [tracksError, setTracksError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  const [playerName, setPlayerName] = useState<string>("");
  const [pendingName, setPendingName] = useState<string>("");

  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [perfect, setPerfect] = useState(0);
  const [good, setGood] = useState(0);
  const [miss, setMiss] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const notesRef = useRef<Note[]>([]);
  const startedAtRef = useRef<number>(0);
  const pauseOffsetRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);
  const [, force] = useState(0);
  const [judgements, setJudgements] = useState<Judgement[]>([]);
  const [laneFlash, setLaneFlash] = useState<number[]>([0, 0, 0, 0, 0, 0]);
  const submittedRef = useRef(false);

  useEffect(() => {
    setPlayerName(loadSavedName());
  }, []);

  const loadTrending = useCallback(async () => {
    setTracksLoading(true);
    setTracksError(null);
    try {
      const list = await fetchTrending(12);
      setTracks(list);
      if (!track && list[0]) setTrack(list[0]);
    } catch (e: any) {
      setTracksError(e?.message || "Gagal memuat lagu dari Audius");
    } finally {
      setTracksLoading(false);
    }
  }, [track]);

  useEffect(() => {
    loadTrending();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runSearch = useCallback(async () => {
    if (!query.trim()) {
      loadTrending();
      return;
    }
    setTracksLoading(true);
    setTracksError(null);
    try {
      const list = await searchTracks(query.trim(), 12);
      setTracks(list);
    } catch (e: any) {
      setTracksError(e?.message || "Gagal mencari lagu");
    } finally {
      setTracksLoading(false);
    }
  }, [query, loadTrending]);


  /* ---------- Time helper ---------- */
  const getNow = useCallback(() => {
    if (status === "playing") {
      return pauseOffsetRef.current + (performance.now() - startedAtRef.current) / 1000;
    }
    return pauseOffsetRef.current;
  }, [status]);

  /* ---------- Load track ---------- */
  const loadTrack = useCallback(async (url: string) => {
    setStatus("loading");
    setLoadError(null);
    setProgress(0);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("Gagal memuat audio (" + res.status + ")");
      const buf = await res.arrayBuffer();
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const decoded = await ctx.decodeAudioData(buf.slice(0));
      const notes = detectNotes(decoded);
      notesRef.current = notes;
      // setup audio element from blob
      const blob = new Blob([buf], { type: "audio/mpeg" });
      const blobUrl = URL.createObjectURL(blob);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
      }
      const a = new Audio(blobUrl);
      a.preload = "auto";
      a.addEventListener("ended", () => endGame());
      audioRef.current = a;
      setStatus("ready");
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error(e);
      setLoadError(e?.message || "Gagal memuat lagu. Coba lagu lain atau periksa URL.");
      setStatus("menu");
    }
  }, []);

  /* ---------- Game loop ---------- */
  useEffect(() => {
    if (status !== "playing") return;
    const tick = () => {
      const now = getNow();
      setProgress(audioRef.current ? now / (audioRef.current.duration || 1) : 0);
      // judge missed notes
      let updated = false;
      for (const n of notesRef.current) {
        if (!n.judged && now - n.time > MISS_WINDOW) {
          n.judged = true;
          updated = true;
          setMiss((m) => m + 1);
          setCombo(0);
          pushJudgement(n.lane, "MISS", "text-rose-400");
        }
      }
      if (updated) force((x) => x + 1);
      else force((x) => x + 1); // also re-render for falling
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [status, getNow]);

  const pushJudgement = (lane: number, text: string, color: string) => {
    const id = Math.random();
    setJudgements((j) => [...j, { id, lane, text, color, at: performance.now() }].slice(-20));
    setTimeout(() => setJudgements((j) => j.filter((x) => x.id !== id)), 600);
  };

  /* ---------- Input ---------- */
  const hitLane = useCallback(
    (lane: number) => {
      if (status !== "playing") return;
      setLaneFlash((arr) => {
        const c = [...arr];
        c[lane] = performance.now();
        return c;
      });
      const now = getNow();
      // find nearest unhit note in this lane within MISS_WINDOW
      let best: Note | null = null;
      let bestDt = Infinity;
      for (const n of notesRef.current) {
        if (n.judged || n.lane !== lane) continue;
        const dt = Math.abs(n.time - now);
        if (dt < bestDt && dt <= MISS_WINDOW) {
          bestDt = dt;
          best = n;
        }
        if (n.time - now > MISS_WINDOW) break;
      }
      if (!best) return;
      best.judged = true;
      best.hit = true;
      if (bestDt <= PERFECT_WINDOW) {
        setScore((s) => s + 300);
        setPerfect((p) => p + 1);
        setCombo((c) => {
          const nc = c + 1;
          setMaxCombo((m) => Math.max(m, nc));
          return nc;
        });
        pushJudgement(lane, "PERFECT", "text-amber-300");
        playHit(880 + lane * 60);
      } else if (bestDt <= GOOD_WINDOW) {
        setScore((s) => s + 150);
        setGood((g) => g + 1);
        setCombo((c) => {
          const nc = c + 1;
          setMaxCombo((m) => Math.max(m, nc));
          return nc;
        });
        pushJudgement(lane, "GOOD", "text-cyan-300");
        playHit(660 + lane * 40);
      } else {
        setMiss((m) => m + 1);
        setCombo(0);
        pushJudgement(lane, "MISS", "text-rose-400");
      }
    },
    [status, getNow],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const idx = LANE_KEYS.indexOf(k as any);
      if (idx >= 0) {
        e.preventDefault();
        hitLane(idx);
      } else if (k === "escape" && status === "playing") {
        pauseGame();
      } else if (k === " " && (status === "ready" || status === "paused")) {
        e.preventDefault();
        startGame();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hitLane, status]);

  /* ---------- Controls ---------- */
  const startGame = () => {
    if (!audioRef.current) return;
    if (!playerName) {
      setStatus("name");
      return;
    }
    submittedRef.current = false;
    startedAtRef.current = performance.now();
    audioRef.current.currentTime = pauseOffsetRef.current;
    audioRef.current.play().catch(() => {});
    setStatus("playing");
  };
  const pauseGame = () => {
    if (!audioRef.current) return;
    pauseOffsetRef.current = pauseOffsetRef.current + (performance.now() - startedAtRef.current) / 1000;
    audioRef.current.pause();
    setStatus("paused");
  };
  const resumeGame = () => {
    if (!audioRef.current) return;
    startedAtRef.current = performance.now();
    audioRef.current.play().catch(() => {});
    setStatus("playing");
  };
  const resetGame = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    pauseOffsetRef.current = 0;
    notesRef.current = notesRef.current.map((n) => ({ ...n, judged: false, hit: false }));
    setScore(0);
    setCombo(0);
    setMaxCombo(0);
    setPerfect(0);
    setGood(0);
    setMiss(0);
    setProgress(0);
    setStatus("ready");
  };
  const endGame = useCallback(() => {
    if (audioRef.current) audioRef.current.pause();
    setStatus("over");
  }, []);

  /* ---------- Submit score on game over ---------- */
  useEffect(() => {
    if (status !== "over" || submittedRef.current) return;
    submittedRef.current = true;
    const total = perfect + good + miss;
    const accuracy = total > 0 ? Math.round(((perfect + good * 0.5) / total) * 100) : 0;
    const duration = Math.round(audioRef.current?.duration ?? 0);
    submitScore({
      game: "typinghero",
      player_name: playerName,
      score,
      level: maxCombo,
      accuracy,
      wpm: 0,
      duration_sec: duration,
    });
  }, [status, perfect, good, miss, playerName, score, maxCombo]);

  /* ---------- Falling notes positions ---------- */
  const now = getNow();
  const visibleNotes = notesRef.current.filter(
    (n) => !n.judged && n.time - now < FALL_DURATION + 0.3 && n.time - now > -MISS_WINDOW,
  );

  const total = perfect + good + miss;
  const accuracy = total > 0 ? Math.round(((perfect + good * 0.5) / total) * 100) : 0;

  return (
    <div className="min-h-screen w-full bg-[#070713] text-white overflow-hidden relative">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 -left-40 w-[500px] h-[500px] rounded-full bg-fuchsia-600/20 blur-3xl" />
        <div className="absolute -bottom-40 -right-40 w-[600px] h-[600px] rounded-full bg-cyan-500/20 blur-3xl" />
      </div>

      {/* Top bar */}
      <header className="relative z-10 flex items-center justify-between px-4 py-3 border-b border-white/10 bg-black/30 backdrop-blur">
        <Link to="/" className="flex items-center gap-2 text-sm text-white/70 hover:text-white">
          <ArrowLeft className="w-4 h-4" /> SanGames
        </Link>
        <div className="flex items-center gap-2 text-sm">
          <Music className="w-4 h-4 text-fuchsia-400" />
          <span className="font-bold tracking-wider">TYPING HERO</span>
        </div>
        <Link
          to="/leaderboard"
          className="flex items-center gap-1.5 text-xs text-white/70 hover:text-white px-3 py-1.5 rounded-full border border-white/10 bg-white/5"
        >
          <Trophy className="w-3.5 h-3.5 text-amber-300" /> Leaderboard
        </Link>
      </header>

      {/* MENU */}
      {status === "menu" && (
        <div className="relative z-10 max-w-2xl mx-auto px-6 py-10">
          <h1 className="text-4xl md:text-5xl font-black tracking-tight text-center mb-2">
            <span className="bg-gradient-to-r from-fuchsia-400 via-cyan-300 to-amber-300 bg-clip-text text-transparent">
              Typing Hero
            </span>
          </h1>
          <p className="text-center text-white/60 mb-8 text-sm">
            6 lajur · tekan <kbd className="px-1.5 py-0.5 rounded bg-white/10">A S D</kbd>{" "}
            <kbd className="px-1.5 py-0.5 rounded bg-white/10">J K L</kbd> tepat saat not menyentuh garis
          </p>

          <div className="space-y-2 mb-4">
            <p className="text-xs uppercase tracking-widest text-white/40">Cari Lagu di Audius</p>
            <div className="flex gap-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runSearch()}
                placeholder="Judul lagu atau artis…"
                className="bg-white/5 border-white/10"
              />
              <Button variant="secondary" onClick={runSearch}>
                <Search className="w-4 h-4" />
              </Button>
              <Button variant="outline" className="border-white/20 bg-white/5" onClick={loadTrending}>
                Trending
              </Button>
            </div>
          </div>

          <div className="space-y-2 mb-6 max-h-[50vh] overflow-y-auto pr-1">
            {tracksLoading && (
              <div className="flex items-center justify-center py-10 text-white/60 gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Memuat lagu…
              </div>
            )}
            {tracksError && (
              <div className="text-sm text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg p-3">
                {tracksError}
              </div>
            )}
            {!tracksLoading && !tracksError && tracks.length === 0 && (
              <div className="text-center text-white/50 py-10 text-sm">Tidak ada lagu ditemukan.</div>
            )}
            {tracks.map((p) => (
              <button
                key={p.id}
                onClick={() => setTrack(p)}
                className={`w-full text-left rounded-xl p-3 border transition flex items-center gap-3 ${
                  track?.id === p.id
                    ? "border-fuchsia-400/60 bg-fuchsia-500/10"
                    : "border-white/10 bg-white/5 hover:border-white/30"
                }`}
              >
                {p.artwork ? (
                  <img src={p.artwork} alt="" className="w-12 h-12 rounded-md object-cover" />
                ) : (
                  <div className="w-12 h-12 rounded-md bg-white/10 flex items-center justify-center">
                    <Music className="w-5 h-5 text-white/40" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-bold truncate">{p.title}</div>
                  <div className="text-xs text-white/50 truncate">{p.artist}</div>
                </div>
                <div className="text-xs text-white/40 tabular-nums">
                  {Math.floor(p.duration / 60)}:{String(p.duration % 60).padStart(2, "0")}
                </div>
              </button>
            ))}
          </div>

          {loadError && (
            <div className="text-sm text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg p-3 mb-4">
              {loadError}
            </div>
          )}

          <Button
            disabled={!track}
            onClick={() => track && loadTrack(track.streamUrl)}
            className="w-full h-12 text-base font-bold bg-gradient-to-r from-fuchsia-500 to-cyan-500 hover:opacity-90 disabled:opacity-50"
          >
            Muat & Siapkan
          </Button>

        </div>
      )}

      {status === "loading" && (
        <div className="relative z-10 flex flex-col items-center justify-center py-32 gap-4">
          <Loader2 className="w-10 h-10 animate-spin text-fuchsia-400" />
          <p className="text-white/70">Menganalisis lagu & membuat beatmap…</p>
        </div>
      )}

      {(status === "ready" || status === "playing" || status === "paused" || status === "over") && (
        <div className="relative z-10 max-w-5xl mx-auto px-4 py-4">
          {/* HUD */}
          <div className="flex items-center justify-between mb-3 text-sm">
            <div className="flex items-center gap-4">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-white/40">Score</div>
                <div className="text-2xl font-black tabular-nums">{score}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-widest text-white/40">Combo</div>
                <div className="text-2xl font-black tabular-nums text-amber-300">{combo}x</div>
              </div>
              <div className="hidden sm:block">
                <div className="text-[10px] uppercase tracking-widest text-white/40">Akurasi</div>
                <div className="text-2xl font-black tabular-nums text-cyan-300">{accuracy}%</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {status === "ready" && (
                <Button onClick={startGame} className="bg-emerald-500 hover:bg-emerald-600">
                  <Play className="w-4 h-4" /> Mulai
                </Button>
              )}
              {status === "playing" && (
                <Button onClick={pauseGame} variant="secondary">
                  <Pause className="w-4 h-4" /> Pause
                </Button>
              )}
              {status === "paused" && (
                <Button onClick={resumeGame} className="bg-emerald-500 hover:bg-emerald-600">
                  <Play className="w-4 h-4" /> Lanjut
                </Button>
              )}
              <Button onClick={resetGame} variant="outline" className="border-white/20 bg-white/5">
                <RotateCcw className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Progress */}
          <div className="h-1 w-full bg-white/10 rounded mb-3 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-fuchsia-400 to-cyan-400 transition-[width]"
              style={{ width: `${Math.min(100, progress * 100)}%` }}
            />
          </div>

          {/* Playfield */}
          <div className="relative w-full mx-auto rounded-2xl border border-white/10 bg-black/40 overflow-hidden" style={{ height: "min(72vh, 640px)" }}>
            {/* lane backgrounds */}
            <div className="absolute inset-0 grid" style={{ gridTemplateColumns: "repeat(6, 1fr)" }}>
              {LANE_KEYS.map((k, i) => (
                <div key={i} className="relative border-r border-white/5 last:border-r-0">
                  <div className={`absolute inset-0 bg-gradient-to-b ${LANE_COLORS[i]} opacity-[0.04]`} />
                  {/* lane flash */}
                  {performance.now() - laneFlash[i] < 150 && (
                    <div className={`absolute inset-0 bg-gradient-to-b ${LANE_COLORS[i]} opacity-20`} />
                  )}
                </div>
              ))}
            </div>

            {/* hit line */}
            <div
              className="absolute left-0 right-0 h-[3px] bg-gradient-to-r from-fuchsia-400 via-white to-cyan-400 shadow-[0_0_24px_rgba(255,255,255,0.6)]"
              style={{ top: `${HIT_LINE_RATIO * 100}%` }}
            />

            {/* falling notes */}
            {visibleNotes.map((n) => {
              const dt = n.time - now; // seconds until hit
              const t = 1 - dt / FALL_DURATION; // 0 at top, 1 at hit line
              const top = t * HIT_LINE_RATIO * 100;
              return (
                <div
                  key={n.id}
                  className="absolute"
                  style={{
                    left: `${(n.lane / 6) * 100}%`,
                    width: `${100 / 6}%`,
                    top: `${top}%`,
                    transform: "translateY(-50%)",
                  }}
                >
                  <div className="mx-2 h-10 flex items-center justify-center">
                    <div
                      className={`w-full h-full rounded-lg bg-gradient-to-b ${LANE_COLORS[n.lane]} shadow-lg ${LANE_RING[n.lane]} shadow-[0_0_24px_var(--tw-shadow-color)] border border-white/30`}
                    />
                  </div>
                </div>
              );
            })}

            {/* judgements */}
            <div className="absolute inset-0 pointer-events-none">
              {judgements.map((j) => (
                <div
                  key={j.id}
                  className={`absolute font-black text-sm ${j.color} animate-pulse`}
                  style={{
                    left: `${(j.lane / 6) * 100 + 100 / 12}%`,
                    top: `${HIT_LINE_RATIO * 100 - 8}%`,
                    transform: "translate(-50%, -50%)",
                  }}
                >
                  {j.text}
                </div>
              ))}
            </div>

            {/* key pads at bottom */}
            <div
              className="absolute left-0 right-0 grid"
              style={{ gridTemplateColumns: "repeat(6, 1fr)", top: `${HIT_LINE_RATIO * 100}%` }}
            >
              {LANE_KEYS.map((k, i) => (
                <button
                  key={k}
                  onMouseDown={() => hitLane(i)}
                  onTouchStart={(e) => {
                    e.preventDefault();
                    hitLane(i);
                  }}
                  className="mx-1 mt-3 h-14 rounded-lg border border-white/15 bg-white/5 backdrop-blur active:bg-white/20 flex items-center justify-center"
                >
                  <span className="text-lg font-black uppercase tracking-widest text-white/80">{k}</span>
                </button>
              ))}
            </div>

            {/* PAUSED overlay */}
            {status === "paused" && (
              <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center">
                <div className="text-center">
                  <div className="text-4xl font-black mb-3">Paused</div>
                  <Button onClick={resumeGame} className="bg-emerald-500 hover:bg-emerald-600">
                    <Play className="w-4 h-4" /> Lanjutkan
                  </Button>
                </div>
              </div>
            )}

            {/* GAME OVER overlay */}
            {status === "over" && (
              <div className="absolute inset-0 bg-black/75 backdrop-blur-md flex items-center justify-center p-6">
                <div className="text-center max-w-sm w-full">
                  <div className="text-xs uppercase tracking-widest text-white/50 mb-2">Selesai</div>
                  <div className="text-5xl font-black mb-1 bg-gradient-to-r from-fuchsia-400 to-cyan-300 bg-clip-text text-transparent">
                    {score}
                  </div>
                  <div className="text-sm text-white/60 mb-5">poin</div>
                  <div className="grid grid-cols-4 gap-2 text-center mb-5">
                    <Stat label="Perfect" value={perfect} color="text-amber-300" />
                    <Stat label="Good" value={good} color="text-cyan-300" />
                    <Stat label="Miss" value={miss} color="text-rose-300" />
                    <Stat label="MaxCombo" value={maxCombo} color="text-fuchsia-300" />
                  </div>
                  <div className="flex gap-2 justify-center">
                    <Button onClick={resetGame} className="bg-gradient-to-r from-fuchsia-500 to-cyan-500">
                      <RotateCcw className="w-4 h-4" /> Main Lagi
                    </Button>
                    <Link to="/leaderboard">
                      <Button variant="outline" className="border-white/20 bg-white/5">
                        <Trophy className="w-4 h-4" /> Leaderboard
                      </Button>
                    </Link>
                  </div>
                </div>
              </div>
            )}
          </div>

          <p className="text-center text-xs text-white/40 mt-3">
            Track: <span className="text-white/70">{track?.title}</span> · {track?.artist}
          </p>
        </div>
      )}

      {/* Name dialog */}
      <Dialog
        open={status === "name"}
        onOpenChange={(o) => {
          if (!o) setStatus("ready");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nama Pemain</DialogTitle>
            <DialogDescription>
              Nama ini akan disimpan bersama skormu di Leaderboard.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={pendingName}
            onChange={(e) => setPendingName(e.target.value)}
            placeholder="Mis. Sani"
            maxLength={24}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const clean = sanitizeName(pendingName);
                if (!clean) return;
                saveName(clean);
                setPlayerName(clean);
                setStatus("ready");
                setTimeout(startGame, 0);
              }
            }}
          />
          <DialogFooter>
            <Button
              onClick={() => {
                const clean = sanitizeName(pendingName);
                if (!clean) return;
                saveName(clean);
                setPlayerName(clean);
                setStatus("ready");
                setTimeout(startGame, 0);
              }}
              className="bg-gradient-to-r from-fuchsia-500 to-cyan-500"
            >
              Simpan & Mulai
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg bg-white/5 border border-white/10 p-2">
      <div className="text-[10px] uppercase tracking-wider text-white/50">{label}</div>
      <div className={`text-lg font-black tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
