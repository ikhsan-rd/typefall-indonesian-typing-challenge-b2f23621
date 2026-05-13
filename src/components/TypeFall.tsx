import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Home, Pause, Play, RotateCcw } from "lucide-react";
import { getRandomWord, randomNonsense } from "@/lib/words";
import { sfx } from "@/lib/sounds";

type FallObj = {
  id: number;
  word: string;
  typed: number;
  x: number; // 0-100 (%)
  y: number; // 0-100 (%)
  speed: number; // % per second
  special: boolean;
  typo: boolean;
  typoUntil: number;
  bornAt: number;
};

type Status = "menu" | "playing" | "paused" | "over";

const MAX_HP = 5;
const FLOOR_Y = 92; // % from top

// Cumulative score required to REACH given level.
// L1=0, L2=50, L3=110, L4=180, L5=260, ...
// Per-level gap = 50 + (level-2)*10 (i.e. L1->L2 gap=50, L2->L3=60, L3->L4=70 ...)
function thresholdToReach(level: number): number {
  if (level <= 1) return 0;
  return (level - 1) * (50 + 5 * (level - 2));
}
function levelFromScore(score: number): number {
  let lvl = 1;
  while (thresholdToReach(lvl + 1) <= score) lvl++;
  return lvl;
}

function makeObj(level: number, id: number): FallObj {
  const special = Math.random() < Math.min(0.18, 0.05 + level * 0.012);
  const baseLen = 4 + Math.floor(Math.random() * 3);
  const word = special
    ? randomNonsense(baseLen + Math.floor(Math.random() * 3))
    : getRandomWord(level);
  const speed = 2.4 + level * 0.45 + Math.random() * 0.8; // %/s
  return {
    id,
    word,
    typed: 0,
    x: 6 + Math.random() * 84,
    y: -4,
    speed,
    special,
    typo: false,
    typoUntil: 0,
    bornAt: performance.now(),
  };
}

function getZonePoints(y: number): number {
  if (y < 25) return 4;
  if (y < 50) return 3;
  if (y < 75) return 2;
  return 1;
}

export default function TypeFall() {
  const [status, setStatus] = useState<Status>("menu");
  const [objs, setObjs] = useState<FallObj[]>([]);
  const [score, setScore] = useState(0);
  const [hp, setHp] = useState(MAX_HP);
  const [level, setLevel] = useState(1);
  const [combo, setCombo] = useState(0);
  const [keysOk, setKeysOk] = useState(0);
  const [keysTotal, setKeysTotal] = useState(0);
  const [wordsDone, setWordsDone] = useState(0);
  const [startedAt, setStartedAt] = useState(0);
  const [shake, setShake] = useState(false);
  const [levelingUp, setLevelingUp] = useState(false);
  const [displayLevel, setDisplayLevel] = useState(1);
  const [highScore, setHighScore] = useState(0);
  const [particles, setParticles] = useState<{ id: number; x: number; y: number; color: string }[]>([]);
  const [hearts, setHearts] = useState<{ id: number; x: number; y: number }[]>([]);

  const idRef = useRef(1);
  const partIdRef = useRef(1);
  const heartIdRef = useRef(1);
  const lastTickRef = useRef(performance.now());
  const lastSpawnRef = useRef(performance.now());
  const rafRef = useRef<number | null>(null);

  // Load highscore
  useEffect(() => {
    if (typeof window === "undefined") return;
    const v = window.localStorage.getItem("typefall:highscore");
    if (v) setHighScore(parseInt(v, 10) || 0);
  }, []);

  // Save highscore on game over
  useEffect(() => {
    if (status !== "over") return;
    if (score > highScore) {
      setHighScore(score);
      window.localStorage.setItem("typefall:highscore", String(score));
    }
  }, [status, score, highScore]);

  const triggerLevelBreather = useCallback((lvl: number, explode: boolean) => {
    setDisplayLevel(lvl);
    if (explode) {
      setObjs((prev) => {
        const burst = prev.flatMap((o) =>
          Array.from({ length: 12 }).map(() => ({
            id: partIdRef.current++,
            x: o.x,
            y: o.y,
            color: "var(--neon-violet)",
          })),
        );
        if (burst.length > 0) {
          sfx.destroy();
          setParticles((p) => [...p, ...burst]);
          setTimeout(() => {
            setParticles((p) => p.filter((pp) => !burst.find((b) => b.id === pp.id)));
          }, 800);
        }
        return [];
      });
    }
    setLevelingUp(true);
    lastSpawnRef.current = performance.now() + 1900;
    setTimeout(() => {
      setLevelingUp(false);
      lastSpawnRef.current = performance.now();
    }, 1900);
  }, []);

  const reset = useCallback(() => {
    setObjs([]);
    setScore(0);
    setHp(MAX_HP);
    setLevel(1);
    setCombo(0);
    setKeysOk(0);
    setKeysTotal(0);
    setWordsDone(0);
    setParticles([]);
    setHearts([]);
    idRef.current = 1;
    lastTickRef.current = performance.now();
    lastSpawnRef.current = performance.now();
    setStartedAt(performance.now());
  }, []);

  const startGame = useCallback(() => {
    reset();
    setStatus("playing");
    // Show "LV 1" breather at start
    triggerLevelBreather(1, false);
  }, [reset, triggerLevelBreather]);

  const goHome = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setLevelingUp(false);
    setObjs([]);
    setParticles([]);
    setHearts([]);
    setStatus("menu");
  }, []);

  // Level from score (cumulative thresholds)
  useEffect(() => {
    const lvl = levelFromScore(score);
    if (lvl !== level) {
      setLevel(lvl);
      sfx.levelUp();
      triggerLevelBreather(lvl, true);
    }
  }, [score, level, triggerLevelBreather]);

  // Game loop
  useEffect(() => {
    if (status !== "playing") return;
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - lastTickRef.current) / 1000);
      lastTickRef.current = now;

      if (levelingUp) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      // Spawn
      const spawnEvery = Math.max(700, 3200 - level * 140);
      if (now - lastSpawnRef.current > spawnEvery) {
        lastSpawnRef.current = now;
        setObjs((prev) => [...prev, makeObj(level, idRef.current++)]);
      }

      // Move + floor collision
      setObjs((prev) => {
        const next: FallObj[] = [];
        let lostHp = 0;
        for (const o of prev) {
          const speedMul = o.typo && now < o.typoUntil ? 2 : 1;
          const ny = o.y + o.speed * speedMul * dt;
          if (ny >= FLOOR_Y) {
            lostHp++;
            continue;
          }
          let typo = o.typo;
          let typoUntil = o.typoUntil;
          if (typo && now > typoUntil) {
            typo = false;
          }
          next.push({ ...o, y: ny, typo, typoUntil });
        }
        if (lostHp > 0) {
          sfx.hpLoss();
          setShake(true);
          setTimeout(() => setShake(false), 350);
          setHp((h) => {
            const nh = h - lostHp;
            if (nh <= 0) {
              setStatus("over");
              sfx.gameOver();
              return 0;
            }
            return nh;
          });
          setCombo(0);
        }
        return next;
      });

      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [status, level, levelingUp]);

  // Keyboard input
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (status === "playing") setStatus("paused");
        else if (status === "paused") setStatus("playing");
        return;
      }
      if (status !== "playing" || levelingUp) return;
      if (e.key.length !== 1) return;
      const ch = e.key.toLowerCase();
      if (!/^[a-z]$/.test(ch)) return;
      e.preventDefault();

      setObjs((prev) => {
        if (prev.length === 0) return prev;
        let activeIdx = 0;
        for (let i = 1; i < prev.length; i++) {
          if (prev[i].y > prev[activeIdx].y) activeIdx = i;
        }
        const active = prev[activeIdx];
        const expected = active.word[active.typed];
        setKeysTotal((k) => k + 1);
        if (ch === expected) {
          sfx.type();
          setKeysOk((k) => k + 1);
          const newTyped = active.typed + 1;
          if (newTyped >= active.word.length) {
            // Destroy — points capped at 4 (zone only, no combo bonus)
            sfx.destroy();
            const pts = getZonePoints(active.y);
            setScore((s) => s + pts);
            setCombo((c) => c + 1);
            setWordsDone((w) => w + 1);
            if (active.special) {
              setHp((h) => h + 1);
              sfx.bonus();
              // Heart fly-up animation
              const heart = { id: heartIdRef.current++, x: active.x, y: active.y };
              setHearts((hs) => [...hs, heart]);
              setTimeout(() => {
                setHearts((hs) => hs.filter((h) => h.id !== heart.id));
              }, 1800);
            }
            const color = active.special ? "var(--neon-pink)" : "var(--neon-cyan)";
            const burst = Array.from({ length: 10 }).map(() => ({
              id: partIdRef.current++,
              x: active.x,
              y: active.y,
              color,
            }));
            setParticles((p) => [...p, ...burst]);
            setTimeout(() => {
              setParticles((p) => p.filter((pp) => !burst.find((b) => b.id === pp.id)));
            }, 700);
            return prev.filter((_, i) => i !== activeIdx);
          }
          const updated = { ...active, typed: newTyped, typo: false };
          const copy = prev.slice();
          copy[activeIdx] = updated;
          return copy;
        } else {
          sfx.typo();
          setShake(true);
          setTimeout(() => setShake(false), 280);
          setCombo(0);
          const updated: FallObj = {
            ...active,
            typo: true,
            typoUntil: performance.now() + 1500,
          };
          const copy = prev.slice();
          copy[activeIdx] = updated;
          return copy;
        }
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [status, combo, levelingUp]);

  const activeId = useMemo(() => {
    if (objs.length === 0) return null;
    let a = objs[0];
    for (const o of objs) if (o.y > a.y) a = o;
    return a.id;
  }, [objs]);

  const accuracy = keysTotal === 0 ? 100 : Math.round((keysOk / keysTotal) * 100);
  const elapsedMin = Math.max(0.0167, (performance.now() - startedAt) / 60000);
  const wpm = status === "playing" || status === "paused" ? Math.round(wordsDone / elapsedMin) : 0;

  // Progress to next level
  const nextThreshold = thresholdToReach(level + 1);
  const curThreshold = thresholdToReach(level);
  const lvlProgress = Math.min(
    1,
    Math.max(0, (score - curThreshold) / Math.max(1, nextThreshold - curThreshold)),
  );

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 grid-floor bg-drift opacity-40" />
      <AnimatePresence>
        {hp === 1 && status === "playing" && (
          <motion.div
            key="emergency"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="pointer-events-none absolute inset-0 z-10"
          >
            <motion.div
              className="absolute inset-0"
              style={{
                background:
                  "radial-gradient(ellipse at center, transparent 30%, color-mix(in oklch, var(--danger) 45%, transparent) 100%)",
              }}
              animate={{ opacity: [0.55, 1, 0.55] }}
              transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
            />
            <div
              className="absolute inset-0"
              style={{
                boxShadow:
                  "inset 0 0 120px 40px color-mix(in oklch, var(--danger) 70%, transparent)",
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
      <div
        className="pointer-events-none absolute inset-x-0"
        style={{
          top: `${FLOOR_Y}%`,
          height: "2px",
          background:
            "linear-gradient(90deg, transparent, color-mix(in oklch, var(--danger) 90%, transparent), transparent)",
          boxShadow: "0 0 18px color-mix(in oklch, var(--danger) 80%, transparent)",
        }}
      />

      {/* HUD */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 p-3 sm:p-5">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2">
          <div className="glass pointer-events-auto flex items-center gap-3 rounded-xl px-4 py-2 sm:gap-5">
            <Stat label="SCORE" value={score} accent="cyan" mono />
            <Sep />
            <div className="flex flex-col gap-1">
              <Stat label="LVL" value={level} accent="violet" />
              <div className="h-1 w-16 overflow-hidden rounded-full bg-border/60">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${lvlProgress * 100}%`,
                    background:
                      "linear-gradient(90deg, var(--neon-violet), var(--neon-cyan))",
                    boxShadow:
                      "0 0 8px color-mix(in oklch, var(--neon-violet) 70%, transparent)",
                  }}
                />
              </div>
            </div>
            <Sep />
            <HPBar hp={hp} />
          </div>
          <div className="glass pointer-events-auto flex items-center gap-3 rounded-xl px-4 py-2 sm:gap-5">
            <Stat label="ACC" value={`${accuracy}%`} accent="lime" />
            <Sep />
            <Stat label="WPM" value={wpm} accent="amber" />
            <Sep />
            <IconBtn
              label={status === "paused" ? "Resume" : "Pause"}
              onClick={() =>
                setStatus((s) => (s === "playing" ? "paused" : s === "paused" ? "playing" : s))
              }
            >
              {status === "paused" ? <Play size={16} /> : <Pause size={16} />}
            </IconBtn>
            <IconBtn label="Restart" onClick={startGame}>
              <RotateCcw size={16} />
            </IconBtn>
            <IconBtn label="Home" onClick={goHome}>
              <Home size={16} />
            </IconBtn>
          </div>
        </div>
        <div className="mx-auto mt-2 max-w-6xl text-center text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
          TypeFall · Speed Typing Arcade · Hi {highScore}
        </div>
      </div>

      {/* Game arena */}
      <div className={`absolute inset-0 ${shake ? "shake" : ""}`}>
        <AnimatePresence>
          {objs.map((o) => (
            <FallingWord key={o.id} obj={o} active={o.id === activeId} />
          ))}
        </AnimatePresence>

        {particles.map((p) => (
          <Particle key={p.id} x={p.x} y={p.y} color={p.color} />
        ))}

        {hearts.map((h) => (
          <FloatingHeart key={h.id} x={h.x} y={h.y} />
        ))}
      </div>

      {/* Overlays */}
      <AnimatePresence>
        {status === "menu" && (
          <Overlay key="menu">
            <Title />
            <p className="max-w-md text-center text-sm leading-relaxed text-muted-foreground">
              Ketik kata sebelum menyentuh garis.
            </p>
            <button onClick={startGame} className="cta">
              Mulai Bermain
            </button>
            <div className="text-xs text-muted-foreground">High Score: {highScore}</div>
          </Overlay>
        )}
        {status === "paused" && (
          <Overlay key="paused">
            <h2 className="neon-cyan text-3xl font-black tracking-[0.2em]">PAUSED</h2>
            <div className="flex gap-3">
              <button onClick={() => setStatus("playing")} className="cta">
                Lanjutkan
              </button>
              <button onClick={goHome} className="cta-ghost">
                Home
              </button>
            </div>
          </Overlay>
        )}
        {status === "over" && (
          <Overlay key="over">
            <h2 className="neon-pink text-4xl font-black tracking-[0.2em]">GAME OVER</h2>
            <div className="grid grid-cols-2 gap-x-10 gap-y-2 text-center text-sm">
              <span className="text-muted-foreground">Score</span>
              <span className="font-bold neon-cyan">{score}</span>
              <span className="text-muted-foreground">High</span>
              <span className="font-bold neon-lime">{Math.max(highScore, score)}</span>
              <span className="text-muted-foreground">Level</span>
              <span className="font-bold">{level}</span>
              <span className="text-muted-foreground">Akurasi</span>
              <span className="font-bold">{accuracy}%</span>
              <span className="text-muted-foreground">WPM</span>
              <span className="font-bold">{wpm}</span>
            </div>
            <div className="flex gap-3">
              <button onClick={startGame} className="cta">
                Main Lagi
              </button>
              <button onClick={goHome} className="cta-ghost">
                Home
              </button>
            </div>
          </Overlay>
        )}
      </AnimatePresence>

      {/* Level-up breather */}
      <AnimatePresence>
        {levelingUp && status === "playing" && (
          <motion.div
            key="lvlup"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-background/40 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.4, opacity: 0, filter: "blur(20px)" }}
              animate={{ scale: 1, opacity: 1, filter: "blur(0px)" }}
              exit={{ scale: 1.6, opacity: 0, filter: "blur(20px)" }}
              transition={{ type: "spring", stiffness: 180, damping: 16 }}
              className="flex flex-col items-center gap-3 text-center"
            >
              <span className="text-[10px] font-bold uppercase tracking-[0.6em] text-muted-foreground">
                {displayLevel === 1 ? "Get Ready" : "Level Up"}
              </span>
              <span className="neon-violet text-7xl font-black tracking-[0.2em] sm:text-9xl">
                LV {displayLevel}
              </span>
              <span className="text-xs uppercase tracking-[0.4em] neon-cyan">
                {displayLevel === 1 ? "Mulai mengetik..." : "Tarik nafas..."}
              </span>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        .cta-ghost {
          padding: 0.75rem 1.5rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.25em;
          font-size: 0.8rem;
          border-radius: 999px;
          color: var(--foreground);
          background: color-mix(in oklch, white 6%, transparent);
          border: 1px solid color-mix(in oklch, white 14%, transparent);
          transition: transform 0.15s ease, background 0.2s ease;
        }
        .cta-ghost:hover { background: color-mix(in oklch, white 12%, transparent); transform: translateY(-1px); }
      `}</style>
    </div>
  );
}

function FallingWord({ obj, active }: { obj: FallObj; active: boolean }) {
  const cls = obj.special
    ? `obj-special ${obj.typo ? "obj-typo" : ""} ${active ? "pulse-glow" : ""}`
    : `obj-capsule ${obj.typo ? "obj-typo" : active ? "obj-active pulse-glow" : ""}`;
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.6, filter: "blur(6px)" }}
      transition={{ duration: 0.25 }}
      style={{
        position: "absolute",
        left: `${obj.x}%`,
        top: `${obj.y}%`,
        transform: "translate(-50%, -50%)",
      }}
      className={cls}
    >
      <span className="text-base sm:text-lg">
        {obj.word.split("").map((ch, i) => {
          const done = active && i < obj.typed;
          const cursor = active && i === obj.typed;
          return (
            <span key={i} className={done ? "char-done" : "char-pending"}>
              <span className={cursor ? "char-cursor" : ""}>{ch}</span>
            </span>
          );
        })}
      </span>
    </motion.div>
  );
}

function Particle({ x, y, color }: { x: number; y: number; color: string }) {
  const dx = (Math.random() - 0.5) * 200;
  const dy = (Math.random() - 0.5) * 200 - 40;
  return (
    <motion.span
      initial={{ opacity: 1, x: 0, y: 0, scale: 1 }}
      animate={{ opacity: 0, x: dx, y: dy, scale: 0.2 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      style={{
        position: "absolute",
        left: `${x}%`,
        top: `${y}%`,
        width: 8,
        height: 8,
        borderRadius: 999,
        background: color,
        boxShadow: `0 0 12px ${color}`,
        pointerEvents: "none",
      }}
    />
  );
}

function FloatingHeart({ x, y }: { x: number; y: number }) {
  const drift = (Math.random() - 0.5) * 30;
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.4, x: 0, y: 0 }}
      animate={{
        opacity: [0, 1, 1, 0],
        scale: [0.4, 1.2, 1, 0.9],
        x: drift,
        y: -180,
      }}
      transition={{ duration: 1.6, ease: "easeOut", times: [0, 0.15, 0.7, 1] }}
      style={{
        position: "absolute",
        left: `${x}%`,
        top: `${y}%`,
        transform: "translate(-50%, -50%)",
        pointerEvents: "none",
        zIndex: 15,
      }}
    >
      <div className="flex flex-col items-center gap-1">
        <svg
          width="44"
          height="44"
          viewBox="0 0 24 24"
          fill="var(--neon-pink)"
          style={{
            filter:
              "drop-shadow(0 0 10px color-mix(in oklch, var(--neon-pink) 80%, transparent)) drop-shadow(0 0 22px color-mix(in oklch, var(--neon-pink) 50%, transparent))",
          }}
        >
          <path d="M12 21s-7-4.5-9.5-9C1 8.5 3 5 6.5 5c2 0 3.5 1 5.5 3 2-2 3.5-3 5.5-3C21 5 23 8.5 21.5 12 19 16.5 12 21 12 21z" />
        </svg>
        <span className="rounded-full bg-background/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest neon-pink">
          +1 HP
        </span>
      </div>
    </motion.div>
  );
}

function Stat({
  label,
  value,
  accent,
  mono,
}: {
  label: string;
  value: number | string;
  accent: "cyan" | "violet" | "lime" | "amber" | "pink";
  mono?: boolean;
}) {
  const cls =
    accent === "cyan"
      ? "neon-cyan"
      : accent === "violet"
        ? "neon-violet"
        : accent === "lime"
          ? "neon-lime"
          : accent === "amber"
            ? "neon-cyan"
            : "neon-pink";
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-muted-foreground">
        {label}
      </span>
      <span className={`${cls} ${mono ? "font-mono" : ""} text-lg font-extrabold tabular-nums`}>
        {value}
      </span>
    </div>
  );
}

function Sep() {
  return <span className="h-5 w-px bg-border/70" />;
}

function IconBtn({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-8 w-8 items-center justify-center rounded-md border border-border/60 bg-secondary/40 text-foreground transition hover:bg-secondary hover:text-[color:var(--neon-cyan)]"
    >
      {children}
    </button>
  );
}

function HPBar({ hp }: { hp: number }) {
  const slots = Math.max(MAX_HP, hp);
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-muted-foreground">HP</span>
      <div className="flex gap-1">
        {Array.from({ length: Math.min(slots, 8) }).map((_, i) => (
          <span
            key={i}
            className={`block h-3 w-3 rounded-sm transition-all ${
              i < hp
                ? "bg-[color:var(--neon-pink)] shadow-[0_0_10px_color-mix(in_oklch,var(--neon-pink)_70%,transparent)]"
                : "bg-border/60"
            }`}
          />
        ))}
        {hp > 8 && (
          <span className="ml-1 text-xs font-bold neon-pink tabular-nums">+{hp - 8}</span>
        )}
      </div>
    </div>
  );
}

function Title() {
  return (
    <h1 className="text-center font-black leading-none tracking-[0.18em]">
      <span className="block text-5xl sm:text-7xl">
        <span className="neon-cyan">TYPE</span>
        <span className="neon-pink">FALL</span>
      </span>
      <span className="mt-2 block text-[10px] uppercase tracking-[0.5em] text-muted-foreground">
        Speed Typing Arcade
      </span>
    </h1>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-30 flex items-center justify-center bg-background/70 backdrop-blur-md"
    >
      <motion.div
        initial={{ y: 20, scale: 0.96, opacity: 0 }}
        animate={{ y: 0, scale: 1, opacity: 1 }}
        exit={{ y: 10, scale: 0.98, opacity: 0 }}
        transition={{ type: "spring", stiffness: 220, damping: 22 }}
        className="glass flex flex-col items-center gap-6 rounded-2xl p-8 sm:p-12"
      >
        {children}
        <style>{`
          .cta {
            position: relative;
            padding: 0.75rem 2rem;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.25em;
            font-size: 0.85rem;
            border-radius: 999px;
            color: oklch(0.15 0.04 270);
            background: linear-gradient(135deg, var(--neon-cyan), var(--neon-violet));
            box-shadow: 0 0 30px color-mix(in oklch, var(--neon-cyan) 50%, transparent), 0 0 60px color-mix(in oklch, var(--neon-violet) 30%, transparent);
            transition: transform 0.15s ease, box-shadow 0.2s ease;
          }
          .cta:hover { transform: translateY(-2px) scale(1.02); }
          .cta:active { transform: translateY(0) scale(0.98); }
        `}</style>
      </motion.div>
    </motion.div>
  );
}
