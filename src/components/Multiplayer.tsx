import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Home, Copy, Check } from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { getRandomWord, randomNonsense } from "@/lib/words";
import { sfx } from "@/lib/sounds";
import { useRoomChannel } from "@/hooks/useRoomChannel";
import {
  ensureAnonAuth,
  rpcAward,
  rpcCreateRoom,
  rpcEndRound,
  rpcJoinRoom,
  rpcNextRound,
  rpcPenalize,
  rpcSetReady,
  rpcStartMatch,
} from "@/lib/multiplayer";

type FallObj = {
  id: number;
  word: string;
  typed: number;
  x: number;
  y: number;
  speed: number;
  special: boolean;
  typo: boolean;
  typoUntil: number;
  bornAt: number;
};

const FLOOR_Y = 92;
const NAME_KEY = "typefall:name";

function getZonePoints(y: number) {
  if (y < 25) return 4;
  if (y < 50) return 3;
  if (y < 75) return 2;
  return 1;
}

async function makeObj(level: number, id: number): Promise<FallObj> {
  const special = Math.random() < Math.min(0.18, 0.05 + level * 0.012);
  const baseLen = 4 + Math.floor(Math.random() * 3);
  const word = special
    ? randomNonsense(baseLen + Math.floor(Math.random() * 3))
    : await getRandomWord(level);
  const r = Math.random();
  const randomSpeed =
    r < 0.7 ? Math.random() * (1 + level * 0.08) : Math.random() * (2 + level * 0.12);
  const speed = 2.5 + level * 2.5 + randomSpeed;
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

export default function Multiplayer() {
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"home" | "create" | "join" | "in-room">("home");
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // settings (host only, applied at create_room)
  const [targetDiff, setTargetDiff] = useState(20);
  const [roundTime, setRoundTime] = useState(90);
  const [maxRounds, setMaxRounds] = useState(3);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setName(window.localStorage.getItem(NAME_KEY) ?? "");
    ensureAnonAuth().then(setUserId).catch((e) => setErr(String(e?.message ?? e)));
  }, []);

  useEffect(() => {
    if (name && typeof window !== "undefined") window.localStorage.setItem(NAME_KEY, name);
  }, [name]);

  const handleCreate = async () => {
    if (!name.trim()) return setErr("Masukkan nama dulu");
    setBusy(true); setErr(null);
    try {
      const res = await rpcCreateRoom({
        name: name.trim(),
        target_diff: targetDiff,
        round_time: roundTime,
        max_rounds: maxRounds,
      });
      setRoomId(res.room_id);
      setMode("in-room");
    } catch (e: any) { setErr(e.message ?? "Gagal create"); }
    finally { setBusy(false); }
  };

  const handleJoin = async () => {
    if (!name.trim()) return setErr("Masukkan nama dulu");
    if (joinCode.length < 4) return setErr("Kode tidak valid");
    setBusy(true); setErr(null);
    try {
      const id = await rpcJoinRoom(joinCode.trim(), name.trim());
      setRoomId(id);
      setMode("in-room");
    } catch (e: any) { setErr(e.message ?? "Gagal join"); }
    finally { setBusy(false); }
  };

  if (mode === "in-room" && roomId && userId) {
    return (
      <RoomView
        roomId={roomId}
        userId={userId}
        onLeave={() => { setRoomId(null); setMode("home"); }}
      />
    );
  }

  return (
    <div className="relative min-h-screen w-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 grid-floor bg-drift opacity-40" />
      <div className="absolute left-4 top-4 z-30">
        <Link to="/" className="glass flex h-9 w-9 items-center justify-center rounded-full">
          <Home size={16} />
        </Link>
      </div>
      <div className="relative z-10 mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-8 px-4 py-12">
        <h1 className="text-center font-black leading-none tracking-[0.18em]">
          <span className="block text-4xl sm:text-6xl">
            <span className="neon-cyan">DUEL</span>
            <span className="neon-pink">FALL</span>
          </span>
          <span className="mt-2 block text-[10px] uppercase tracking-[0.5em] text-muted-foreground">
            1v1 Tug-of-War Typing
          </span>
        </h1>

        <div className="glass w-full rounded-2xl p-6 sm:p-8">
          <label className="mb-4 block">
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
              Nama
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 20))}
              placeholder="Anda"
              className="w-full rounded-lg border border-border/60 bg-secondary/40 px-4 py-2 text-sm outline-none focus:border-[color:var(--neon-cyan)]"
            />
          </label>

          {mode === "home" && (
            <div className="grid grid-cols-2 gap-3">
              <button className="cta" onClick={() => setMode("create")}>Create</button>
              <button className="cta-ghost" onClick={() => setMode("join")}>Join</button>
            </div>
          )}

          {mode === "create" && (
            <div className="flex flex-col gap-4">
              <Slider label="Target Diff" min={5} max={50} step={1} value={targetDiff} onChange={setTargetDiff} />
              <Slider label="Round Time (s)" min={30} max={180} step={10} value={roundTime} onChange={setRoundTime} />
              <Slider label="Max Rounds" min={1} max={7} step={2} value={maxRounds} onChange={setMaxRounds} />
              <div className="grid grid-cols-2 gap-3">
                <button className="cta-ghost" onClick={() => setMode("home")}>Kembali</button>
                <button className="cta" disabled={busy} onClick={handleCreate}>
                  {busy ? "..." : "Create Room"}
                </button>
              </div>
            </div>
          )}

          {mode === "join" && (
            <div className="flex flex-col gap-4">
              <label>
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
                  Room Code
                </span>
                <input
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 6))}
                  placeholder="ABC123"
                  className="w-full rounded-lg border border-border/60 bg-secondary/40 px-4 py-3 text-center font-mono text-2xl tracking-[0.4em] outline-none focus:border-[color:var(--neon-cyan)]"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button className="cta-ghost" onClick={() => setMode("home")}>Kembali</button>
                <button className="cta" disabled={busy} onClick={handleJoin}>
                  {busy ? "..." : "Join"}
                </button>
              </div>
            </div>
          )}

          {err && (
            <p className="mt-4 rounded-lg border border-[color:var(--danger)]/40 bg-[color:var(--danger)]/10 p-3 text-sm neon-pink">
              {err}
            </p>
          )}
        </div>
      </div>
      <SharedStyles />
    </div>
  );
}

function Slider({ label, min, max, step, value, onChange }: {
  label: string; min: number; max: number; step: number;
  value: number; onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground">{label}</span>
        <span className="font-mono text-sm neon-cyan">{value}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[color:var(--neon-cyan)]"
      />
    </label>
  );
}

function RoomView({ roomId, userId, onLeave }: {
  roomId: string; userId: string; onLeave: () => void;
}) {
  const { room, players, state, ready } = useRoomChannel(roomId);
  const me = players.find((p) => p.user_id === userId) ?? null;
  const opp = players.find((p) => p.user_id !== userId) ?? null;
  const mySlot = (me?.slot ?? 1) as 1 | 2;
  const isHost = !!room && room.host_user_id === userId;

  if (!ready || !room) {
    return <CenterMsg>Memuat room…</CenterMsg>;
  }

  if (room.status === "waiting") {
    return (
      <LobbyView
        room={room}
        players={players}
        userId={userId}
        isHost={isHost}
        onLeave={onLeave}
      />
    );
  }

  if (!state || !me) return <CenterMsg>Menyiapkan match…</CenterMsg>;

  return (
    <ArenaView
      room={room}
      state={state}
      mySlot={mySlot}
      myName={me.name}
      oppName={opp?.name ?? "—"}
      isHost={isHost}
      onLeave={onLeave}
    />
  );
}

function LobbyView({ room, players, userId, isHost, onLeave }: {
  room: any; players: any[]; userId: string; isHost: boolean; onLeave: () => void;
}) {
  const me = players.find((p) => p.user_id === userId);
  const allReady = players.length === 2 && players.every((p) => p.is_ready);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const copy = async () => {
    await navigator.clipboard.writeText(room.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const toggleReady = async () => {
    try { await rpcSetReady(room.id, !me?.is_ready); }
    catch (e: any) { setErr(e.message); }
  };
  const start = async () => {
    try { await rpcStartMatch(room.id); }
    catch (e: any) { setErr(e.message); }
  };

  const slot1 = players.find((p) => p.slot === 1);
  const slot2 = players.find((p) => p.slot === 2);

  return (
    <div className="relative min-h-screen w-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 grid-floor bg-drift opacity-40" />
      <div className="relative z-10 mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 px-4 py-12">
        <button onClick={onLeave} className="text-[10px] uppercase tracking-[0.4em] text-muted-foreground hover:neon-cyan">
          ← Keluar
        </button>
        <div className="glass flex w-full flex-col items-center gap-3 rounded-2xl p-6">
          <span className="text-[10px] uppercase tracking-[0.5em] text-muted-foreground">Room Code</span>
          <button onClick={copy} className="flex items-center gap-3 font-mono text-5xl font-black tracking-[0.3em] neon-cyan transition hover:scale-105">
            {room.code}
            {copied ? <Check size={22} className="neon-lime" /> : <Copy size={22} className="opacity-60" />}
          </button>
          <span className="text-xs text-muted-foreground">Bagikan kode ini ke lawan</span>
        </div>

        <div className="grid w-full grid-cols-2 gap-3">
          <PlayerSlot player={slot1} side="left" />
          <PlayerSlot player={slot2} side="right" />
        </div>

        <div className="glass w-full rounded-2xl p-4 text-xs text-muted-foreground">
          <div className="grid grid-cols-3 gap-2 text-center">
            <Setting label="Target" value={`±${room.target_diff}`} />
            <Setting label="Waktu" value={`${room.round_time}s`} />
            <Setting label="Rounds" value={`Bo${room.max_rounds}`} />
          </div>
        </div>

        <div className="grid w-full grid-cols-2 gap-3">
          <button className="cta-ghost" onClick={toggleReady}>
            {me?.is_ready ? "Cancel Ready" : "Ready"}
          </button>
          <button className="cta" disabled={!isHost || !allReady} onClick={start} style={{ opacity: isHost && allReady ? 1 : 0.4 }}>
            {isHost ? "Start Game" : "Tunggu Host"}
          </button>
        </div>

        {err && <p className="text-xs neon-pink">{err}</p>}
      </div>
      <SharedStyles />
    </div>
  );
}

function PlayerSlot({ player, side }: { player: any; side: "left" | "right" }) {
  const accent = side === "left" ? "neon-cyan" : "neon-pink";
  return (
    <div className="glass flex h-32 flex-col items-center justify-center gap-2 rounded-2xl p-4">
      <span className={`text-[10px] uppercase tracking-[0.4em] ${accent}`}>P{side === "left" ? 1 : 2}</span>
      {player ? (
        <>
          <span className="text-lg font-bold">{player.name}</span>
          <span className={`text-[10px] uppercase tracking-[0.3em] ${player.is_ready ? "neon-lime" : "text-muted-foreground"}`}>
            {player.is_ready ? "● READY" : "○ Menunggu"}
          </span>
        </>
      ) : (
        <span className="text-sm text-muted-foreground">Menunggu pemain…</span>
      )}
    </div>
  );
}

function Setting({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] uppercase tracking-[0.3em] text-muted-foreground">{label}</span>
      <span className="font-mono text-lg neon-cyan">{value}</span>
    </div>
  );
}

function ArenaView({ room, state, mySlot, myName, oppName, isHost, onLeave }: {
  room: any; state: any; mySlot: 1 | 2; myName: string; oppName: string;
  isHost: boolean; onLeave: () => void;
}) {
  const [objs, setObjs] = useState<FallObj[]>([]);
  const [shake, setShake] = useState(false);
  const [particles, setParticles] = useState<{ id: number; x: number; y: number; color: string }[]>([]);
  const idRef = useRef(1);
  const partIdRef = useRef(1);
  const lastTickRef = useRef(performance.now());
  const lastSpawnRef = useRef(performance.now());
  const rafRef = useRef<number | null>(null);

  const myScore = mySlot === 1 ? state.score_p1 : state.score_p2;
  const oppScore = mySlot === 1 ? state.score_p2 : state.score_p1;
  const myWins = mySlot === 1 ? state.wins_p1 : state.wins_p2;
  const oppWins = mySlot === 1 ? state.wins_p2 : state.wins_p1;
  // From "my" perspective: positive = I'm winning
  const myDiff = mySlot === 1 ? state.diff_score : -state.diff_score;

  // Round timer (synced via round_started_at)
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(i);
  }, []);
  const startedMs = state.round_started_at ? new Date(state.round_started_at).getTime() : now;
  const elapsed = Math.max(0, Math.floor((now - startedMs) / 1000));
  const remaining = Math.max(0, room.round_time - elapsed);

  // When time runs out, ANY client may end the round (idempotent server-side).
  useEffect(() => {
    if (room.status === "playing" && remaining === 0) {
      rpcEndRound(room.id).catch(() => {});
    }
  }, [room.status, room.id, remaining]);

  // Clear arena when not playing
  useEffect(() => {
    if (room.status !== "playing") {
      setObjs([]);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    } else {
      lastTickRef.current = performance.now();
      lastSpawnRef.current = performance.now();
    }
  }, [room.status, state.round]);

  // Spawn + falling loop (local, per-player)
  useEffect(() => {
    if (room.status !== "playing") return;
    let cancelled = false;
    const loop = (t: number) => {
      const dt = Math.min(0.05, (t - lastTickRef.current) / 1000);
      lastTickRef.current = t;

      const spawnEvery = Math.max(700, 3200 - state.level * 140);
      if (t - lastSpawnRef.current > spawnEvery) {
        lastSpawnRef.current = t;
        (async () => {
          const obj = await makeObj(state.level, idRef.current++);
          if (cancelled) return;
          setObjs((p) => [...p, obj]);
        })();
      }

      setObjs((prev) => {
        const next: FallObj[] = [];
        let missed = 0;
        for (const o of prev) {
          const ny = o.y + o.speed * dt;
          if (ny >= FLOOR_Y) { missed++; continue; }
          const typo = o.typo && t < o.typoUntil ? true : false;
          next.push({ ...o, y: ny, typo });
        }
        if (missed > 0) {
          sfx.hpLoss(); setShake(true); setTimeout(() => setShake(false), 250);
          for (let i = 0; i < missed; i++) rpcPenalize(room.id).catch(() => {});
        }
        return next;
      });

      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [room.status, state.level, room.id]);

  // Keyboard
  useEffect(() => {
    if (room.status !== "playing") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.length !== 1) return;
      const ch = e.key.toLowerCase();
      if (!/^[a-z]$/.test(ch)) return;
      e.preventDefault();
      setObjs((prev) => {
        if (prev.length === 0) return prev;
        let i = 0;
        for (let j = 1; j < prev.length; j++) if (prev[j].bornAt < prev[i].bornAt) i = j;
        const active = prev[i];
        const expected = active.word[active.typed];
        if (ch === expected) {
          sfx.type();
          const typed = active.typed + 1;
          if (typed >= active.word.length) {
            sfx.destroy();
            const base = getZonePoints(active.y);
            const pts = active.special ? base * 2 : base;
            rpcAward(room.id, pts).catch(() => {});
            const color = active.special ? "var(--neon-pink)" : "var(--neon-cyan)";
            const burst = Array.from({ length: 10 }).map(() => ({
              id: partIdRef.current++, x: active.x, y: active.y, color,
            }));
            setParticles((p) => [...p, ...burst]);
            setTimeout(() => setParticles((p) => p.filter((pp) => !burst.find((b) => b.id === pp.id))), 700);
            return prev.filter((_, k) => k !== i);
          }
          const copy = prev.slice();
          copy[i] = { ...active, typed, typo: false };
          return copy;
        } else {
          sfx.typo(); setShake(true); setTimeout(() => setShake(false), 200);
          const copy = prev.slice();
          copy[i] = { ...active, speed: active.speed * 2, typo: true, typoUntil: performance.now() + 1500 };
          return copy;
        }
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [room.status, room.id]);

  const activeId = useMemo(() => {
    if (objs.length === 0) return null;
    let a = objs[0];
    for (const o of objs) if (o.bornAt < a.bornAt) a = o;
    return a.id;
  }, [objs]);

  // Tug bar: percent (-1..1) where positive = me
  const meterPct = Math.max(-1, Math.min(1, myDiff / room.target_diff));

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 grid-floor bg-drift opacity-40" />
      <div
        className="pointer-events-none absolute inset-x-0"
        style={{
          top: `${FLOOR_Y}%`,
          height: "2px",
          background: "linear-gradient(90deg, transparent, color-mix(in oklch, var(--danger) 90%, transparent), transparent)",
          boxShadow: "0 0 18px color-mix(in oklch, var(--danger) 80%, transparent)",
        }}
      />

      {/* HUD */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 p-3 sm:p-5">
        <div className="mx-auto flex max-w-5xl flex-col gap-3">
          <div className="grid grid-cols-3 items-center gap-3">
            <PlayerPanel name={myName} score={myScore} wins={myWins} maxWins={Math.ceil(room.max_rounds / 2)} side="left" />
            <div className="flex flex-col items-center gap-1">
              <div className="flex items-center gap-3">
                <span className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Round</span>
                <span className="font-mono text-xl font-black neon-cyan">{state.round}/{room.max_rounds}</span>
              </div>
              <div className={`font-mono text-3xl font-black tabular-nums ${remaining < 10 ? "neon-pink" : "neon-cyan"}`}>
                {String(Math.floor(remaining / 60)).padStart(1, "0")}:{String(remaining % 60).padStart(2, "0")}
              </div>
              <span className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">LV {state.level}</span>
            </div>
            <PlayerPanel name={oppName} score={oppScore} wins={oppWins} maxWins={Math.ceil(room.max_rounds / 2)} side="right" />
          </div>

          <TugBar pct={meterPct} myDiff={myDiff} targetDiff={room.target_diff} />
        </div>
      </div>

      {/* Arena */}
      <div className={`absolute inset-0 ${shake ? "shake" : ""}`}>
        <AnimatePresence>
          {objs.map((o) => (
            <FallingWord key={o.id} obj={o} active={o.id === activeId} />
          ))}
        </AnimatePresence>
        {particles.map((p) => (
          <Particle key={p.id} x={p.x} y={p.y} color={p.color} />
        ))}
      </div>

      <button
        onClick={onLeave}
        className="absolute right-4 top-4 z-30 glass flex h-9 w-9 items-center justify-center rounded-full"
        title="Keluar"
      >
        <Home size={16} />
      </button>

      {/* Round end / Match end overlay */}
      <AnimatePresence>
        {room.status === "round_end" && (
          <Overlay key="round_end">
            <h2 className="neon-cyan text-3xl font-black tracking-[0.2em]">
              ROUND {state.round} {room.round_winner === 0 ? "DRAW" : room.round_winner === mySlot ? "WIN" : "LOSE"}
            </h2>
            <div className="text-sm text-muted-foreground">
              Wins: <span className="neon-cyan font-bold">{myName} {myWins}</span> — <span className="neon-pink font-bold">{oppWins} {oppName}</span>
            </div>
            {isHost ? (
              <button className="cta" onClick={() => rpcNextRound(room.id)}>Next Round</button>
            ) : (
              <span className="text-xs uppercase tracking-[0.4em] text-muted-foreground">Menunggu host…</span>
            )}
          </Overlay>
        )}
        {room.status === "match_end" && (
          <Overlay key="match_end">
            <h2 className={`text-4xl font-black tracking-[0.2em] ${room.match_winner === mySlot ? "neon-lime" : "neon-pink"}`}>
              {room.match_winner === 0 ? "DRAW" : room.match_winner === mySlot ? "VICTORY" : "DEFEAT"}
            </h2>
            <div className="text-sm text-muted-foreground">
              Final: <span className="neon-cyan font-bold">{myWins}</span> — <span className="neon-pink font-bold">{oppWins}</span>
            </div>
            <button className="cta" onClick={onLeave}>Kembali</button>
          </Overlay>
        )}
      </AnimatePresence>

      <SharedStyles />
    </div>
  );
}

function PlayerPanel({ name, score, wins, maxWins, side }: {
  name: string; score: number; wins: number; maxWins: number; side: "left" | "right";
}) {
  const accent = side === "left" ? "neon-cyan" : "neon-pink";
  return (
    <div className={`glass flex flex-col gap-1 rounded-xl px-4 py-2 ${side === "right" ? "items-end" : ""}`}>
      <span className={`text-[10px] uppercase tracking-[0.3em] ${accent}`}>{name}</span>
      <span className="font-mono text-2xl font-black tabular-nums">{score}</span>
      <div className="flex gap-1">
        {Array.from({ length: maxWins }).map((_, i) => (
          <span key={i} className={`h-2 w-4 rounded-sm ${i < wins ? `bg-[color:var(--${side === "left" ? "neon-cyan" : "neon-pink"})]` : "bg-border/60"}`} />
        ))}
      </div>
    </div>
  );
}

function TugBar({ pct, myDiff, targetDiff }: { pct: number; myDiff: number; targetDiff: number }) {
  // pct: -1..1 (positive = me)
  const halfWidth = 50 * Math.abs(pct);
  const isMe = pct >= 0;
  return (
    <div className="glass relative h-8 w-full overflow-hidden rounded-full">
      <div className="absolute inset-y-0 left-1/2 w-px bg-border/80" />
      <motion.div
        layout
        className="absolute inset-y-0"
        style={{
          left: isMe ? "50%" : `${50 - halfWidth}%`,
          width: `${halfWidth}%`,
          background: isMe
            ? "linear-gradient(90deg, color-mix(in oklch, var(--neon-cyan) 20%, transparent), var(--neon-cyan))"
            : "linear-gradient(90deg, var(--neon-pink), color-mix(in oklch, var(--neon-pink) 20%, transparent))",
          boxShadow: isMe
            ? "0 0 24px color-mix(in oklch, var(--neon-cyan) 70%, transparent)"
            : "0 0 24px color-mix(in oklch, var(--neon-pink) 70%, transparent)",
        }}
        transition={{ type: "spring", stiffness: 220, damping: 26 }}
      />
      <div className="absolute inset-0 flex items-center justify-between px-4 text-[10px] font-bold uppercase tracking-[0.3em]">
        <span className="neon-cyan">{Math.max(0, myDiff)} →</span>
        <span className="font-mono text-xs text-muted-foreground">±{targetDiff}</span>
        <span className="neon-pink">← {Math.max(0, -myDiff)}</span>
      </div>
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
        position: "absolute", left: `${x}%`, top: `${y}%`,
        width: 8, height: 8, borderRadius: 999,
        background: color, boxShadow: `0 0 12px ${color}`, pointerEvents: "none",
      }}
    />
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
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
      </motion.div>
    </motion.div>
  );
}

function CenterMsg({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-screen items-center justify-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function SharedStyles() {
  return (
    <style>{`
      .cta {
        position: relative; padding: 0.75rem 2rem; font-weight: 800;
        text-transform: uppercase; letter-spacing: 0.25em; font-size: 0.85rem;
        border-radius: 999px; color: oklch(0.15 0.04 270);
        background: linear-gradient(135deg, var(--neon-cyan), var(--neon-violet));
        box-shadow: 0 0 30px color-mix(in oklch, var(--neon-cyan) 50%, transparent),
                    0 0 60px color-mix(in oklch, var(--neon-violet) 30%, transparent);
        transition: transform 0.15s ease, box-shadow 0.2s ease;
      }
      .cta:hover { transform: translateY(-2px) scale(1.02); }
      .cta:active { transform: translateY(0) scale(0.98); }
      .cta:disabled { cursor: not-allowed; }
      .cta-ghost {
        padding: 0.75rem 1.5rem; font-weight: 700;
        text-transform: uppercase; letter-spacing: 0.25em; font-size: 0.8rem;
        border-radius: 999px; color: var(--foreground);
        background: color-mix(in oklch, white 6%, transparent);
        border: 1px solid color-mix(in oklch, white 14%, transparent);
        transition: transform 0.15s ease, background 0.2s ease;
      }
      .cta-ghost:hover { background: color-mix(in oklch, white 12%, transparent); transform: translateY(-1px); }
    `}</style>
  );
}
