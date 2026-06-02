import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Play, Pause, RotateCcw, Music, Trophy, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { submitScore, loadSavedName, saveName, sanitizeName } from "@/lib/scores";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

/* ============================================================
   RhythmHero — 6-lane falling notes rhythm game
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

type TrackPreset = { id: string; title: string; artist: string; url: string };

// SoundHelix royalty-free, CORS-enabled
const PRESETS: TrackPreset[] = [
  { id: "sh1", title: "Neon Pulse", artist: "SoundHelix #1", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3" },
  { id: "sh2", title: "Cyber Drive", artist: "SoundHelix #2", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3" },
  { id: "sh3", title: "Midnight Run", artist: "SoundHelix #3", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3" },
  { id: "sh4", title: "Echo Bloom", artist: "SoundHelix #4", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-7.mp3" },
];

type Note = {
  id: number;
  lane: number;
  time: number; // seconds, when it should be hit
  hit: boolean;
  judged: boolean;
};

type Judgement = { id: number; lane: number; text: string; color: string; at: number };

const FALL_DURATION = 1.6; // seconds a note takes to fall from top to hit line
const HIT_LINE_RATIO = 0.84; // vertical position of hit line (0..1)
const PERFECT_WINDOW = 0.06;
const GOOD_WINDOW = 0.14;
const MISS_WINDOW = 0.18;

/* ---------- Beat detection (energy-based onset) ---------- */
function detectNotes(buffer: AudioBuffer): Note[] {
  const data = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const frame = Math.floor(sampleRate * 0.023); // ~23ms
  const frames: number[] = [];
  for (let i = 0; i + frame < data.length; i += frame) {
    let sum = 0;
    for (let j = 0; j < frame; j++) sum += data[i + j] * data[i + j];
    frames.push(Math.sqrt(sum / frame));
  }
  // moving avg
  const win = 22; // ~0.5s
  const avg: number[] = new Array(frames.length).fill(0);
  for (let i = 0; i < frames.length; i++) {
    let s = 0;
    let c = 0;
    for (let j = Math.max(0, i - win); j <= Math.min(frames.length - 1, i + win); j++) {
      s += frames[j];
      c++;
    }
    avg[i] = s / c;
  }
  const notes: Note[] = [];
  let id = 0;
  let lastBeat = -1;
  const minGap = 6; // ~140ms minimum between notes
  for (let i = 1; i < frames.length - 1; i++) {
    const threshold = avg[i] * 1.45 + 0.01;
    if (
      frames[i] > threshold &&
      frames[i] > frames[i - 1] &&
      frames[i] >= frames[i + 1] &&
      i - lastBeat > minGap
    ) {
      const t = (i * frame) / sampleRate;
      // pick lane from local frequency-ish heuristic: energy delta
      const delta = frames[i] - avg[i];
      const lane = Math.abs(Math.floor((delta * 1000 + i * 7) % 6));
      notes.push({ id: id++, lane, time: t, hit: false, judged: false });
      lastBeat = i;
    }
  }
  // ensure variety — if too few, sprinkle in steady eighth-notes
  if (notes.length < 30) {
    const dur = buffer.duration;
    const step = 0.5;
    for (let t = 1.5; t < dur - 1; t += step) {
      notes.push({ id: id++, lane: Math.floor(Math.random() * 6), time: t, hit: false, judged: false });
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
  const [track, setTrack] = useState<TrackPreset>(PRESETS[0]);
  const [customUrl, setCustomUrl] = useState("");
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
  const startedAtRef = useRef<number>(0); // perf.now ms when play started
  const pauseOffsetRef = useRef<number>(0); // seconds played before pause
  const rafRef = useRef<number | null>(null);
  const [, force] = useState(0); // force re-render for falling notes
  const [judgements, setJudgements] = useState<Judgement[]>([]);
  const [laneFlash, setLaneFlash] = useState<number[]>([0, 0, 0, 0, 0, 0]);
  const submittedRef = useRef(false);

  useEffect(() => {
    setPlayerName(loadSavedName());
  }, []);

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
      game: "rhythmhero",
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
          <span className="font-bold tracking-wider">RHYTHM HERO</span>
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
              Rhythm Hero
            </span>
          </h1>
          <p className="text-center text-white/60 mb-8 text-sm">
            6 lajur · tekan <kbd className="px-1.5 py-0.5 rounded bg-white/10">A S D</kbd>{" "}
            <kbd className="px-1.5 py-0.5 rounded bg-white/10">J K L</kbd> tepat saat not menyentuh garis
          </p>

          <div className="space-y-3 mb-6">
            <p className="text-xs uppercase tracking-widest text-white/40">Pilih Lagu</p>
            {PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => setTrack(p)}
                className={`w-full text-left rounded-xl p-4 border transition flex items-center justify-between ${
                  track.id === p.id
                    ? "border-fuchsia-400/60 bg-fuchsia-500/10"
                    : "border-white/10 bg-white/5 hover:border-white/30"
                }`}
              >
                <div>
                  <div className="font-bold">{p.title}</div>
                  <div className="text-xs text-white/50">{p.artist}</div>
                </div>
                <Music className="w-4 h-4 text-white/40" />
              </button>
            ))}
          </div>

          <div className="space-y-2 mb-6">
            <p className="text-xs uppercase tracking-widest text-white/40">Atau URL audio (mp3, harus mengizinkan CORS)</p>
            <div className="flex gap-2">
              <Input
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                placeholder="https://.../song.mp3"
                className="bg-white/5 border-white/10"
              />
              <Button
                variant="secondary"
                onClick={() => {
                  if (customUrl.trim()) {
                    setTrack({ id: "custom", title: "Custom Track", artist: customUrl, url: customUrl.trim() });
                  }
                }}
              >
                Pakai
              </Button>
            </div>
          </div>

          {loadError && (
            <div className="text-sm text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg p-3 mb-4">
              {loadError}
            </div>
          )}

          <Button
            onClick={() => loadTrack(track.url)}
            className="w-full h-12 text-base font-bold bg-gradient-to-r from-fuchsia-500 to-cyan-500 hover:opacity-90"
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
            Track: <span className="text-white/70">{track.title}</span> · {track.artist}
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
