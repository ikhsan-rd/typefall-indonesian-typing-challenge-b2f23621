import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Trophy, ArrowLeft, RefreshCw, Medal } from "lucide-react";
import { fetchTopScores, type ScoreRow } from "@/lib/scores";

export const Route = createFileRoute("/scoreboard")({
  component: ScoreboardPage,
  head: () => ({
    meta: [
      { title: "Scoreboard — SanGames" },
      {
        name: "description",
        content: "Papan skor tertinggi pemain SanGames untuk semua game.",
      },
      { property: "og:title", content: "Scoreboard — SanGames" },
      {
        property: "og:description",
        content: "Lihat skor tertinggi pemain TypeFall di SanGames.",
      },
    ],
  }),
});

function ScoreboardPage() {
  const [rows, setRows] = useState<ScoreRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const data = await fetchTopScores("typefall", 100);
    setRows(data);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="min-h-screen bg-[#070713] text-white relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-40 w-[500px] h-[500px] rounded-full bg-amber-500/15 blur-3xl" />
        <div className="absolute bottom-0 -right-40 w-[600px] h-[600px] rounded-full bg-fuchsia-600/15 blur-3xl" />
      </div>

      <div className="relative z-10 max-w-4xl mx-auto px-6 py-10 md:py-14">
        <div className="flex items-center justify-between mb-8">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-white/60 hover:text-white transition"
          >
            <ArrowLeft className="w-4 h-4" /> Home
          </Link>
          <button
            onClick={load}
            className="inline-flex items-center gap-2 text-sm px-3 py-1.5 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 transition"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        <header className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-400 via-orange-500 to-rose-500 shadow-lg shadow-amber-500/30 mb-4">
            <Trophy className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-4xl md:text-5xl font-black tracking-tight">Scoreboard</h1>
          <p className="text-sm text-white/50 mt-2 uppercase tracking-[0.3em]">
            TypeFall · Top Players
          </p>
        </header>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm overflow-hidden">
          <div className="grid grid-cols-12 gap-2 px-4 py-3 text-[10px] uppercase tracking-[0.2em] text-white/40 border-b border-white/5">
            <div className="col-span-1">#</div>
            <div className="col-span-5">Player</div>
            <div className="col-span-2 text-right">Score</div>
            <div className="col-span-1 text-right">Lv</div>
            <div className="col-span-1 text-right">WPM</div>
            <div className="col-span-2 text-right">Acc</div>
          </div>

          {loading && rows.length === 0 && (
            <div className="px-4 py-10 text-center text-sm text-white/50">Memuat…</div>
          )}

          {!loading && rows.length === 0 && (
            <div className="px-4 py-10 text-center text-sm text-white/50">
              Belum ada skor. Jadi yang pertama!
            </div>
          )}

          {rows.map((r, i) => {
            const rank = i + 1;
            const top = rank <= 3;
            const medalColor =
              rank === 1
                ? "text-amber-300"
                : rank === 2
                  ? "text-slate-200"
                  : rank === 3
                    ? "text-orange-400"
                    : "text-white/30";
            return (
              <div
                key={r.id}
                className={`grid grid-cols-12 gap-2 px-4 py-3 items-center text-sm border-b border-white/5 last:border-0 ${
                  top ? "bg-white/[0.02]" : ""
                }`}
              >
                <div className="col-span-1 flex items-center gap-1.5 font-mono tabular-nums text-white/60">
                  {top ? <Medal className={`w-4 h-4 ${medalColor}`} /> : null}
                  <span>{rank}</span>
                </div>
                <div className="col-span-5 truncate font-semibold">{r.player_name}</div>
                <div className="col-span-2 text-right font-bold tabular-nums text-cyan-300">
                  {r.score}
                </div>
                <div className="col-span-1 text-right tabular-nums text-white/70">
                  {r.level}
                </div>
                <div className="col-span-1 text-right tabular-nums text-white/70">
                  {r.wpm}
                </div>
                <div className="col-span-2 text-right tabular-nums text-white/70">
                  {r.accuracy}%
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
