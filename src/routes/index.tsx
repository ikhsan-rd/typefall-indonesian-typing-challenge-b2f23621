import { createFileRoute, Link } from "@tanstack/react-router";
import { Keyboard, Gamepad2, Sparkles, Trophy } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Home,
  head: () => ({
    meta: [
      { title: "SanGames — Platform Game Web" },
      {
        name: "description",
        content:
          "SanGames: koleksi game web ringan dan seru. Mainkan TypeFall dan game lainnya langsung di browser.",
      },
      { property: "og:title", content: "SanGames — Platform Game Web" },
      {
        property: "og:description",
        content: "Koleksi game web ringan dan seru. Mainkan langsung di browser.",
      },
    ],
  }),
});

type GameCard = {
  id: string;
  title: string;
  tagline: string;
  description: string;
  to: string;
  badge?: string;
  icon: React.ReactNode;
  gradient: string;
  available: boolean;
};

const GAMES: GameCard[] = [
  {
    id: "typefall",
    title: "TypeFall",
    tagline: "Speed Typing Arcade",
    description:
      "Ketik kata baku KBBI secepat mungkin sebelum objek menyentuh garis bawah. Tersedia mode Solo dan Multiplayer 1v1 di dalam game.",
    to: "/typefall",
    badge: "Populer",
    icon: <Keyboard className="w-8 h-8" />,
    gradient: "from-cyan-500 via-blue-500 to-indigo-600",
    available: true,
  },
  {
    id: "soon-1",
    title: "Coming Soon",
    tagline: "Game baru segera hadir",
    description: "Game seru berikutnya sedang dalam pengembangan. Stay tuned!",
    to: "/",
    icon: <Gamepad2 className="w-8 h-8" />,
    gradient: "from-slate-600 via-slate-700 to-slate-800",
    available: false,
  },
];

function Home() {
  return (
    <div className="min-h-screen bg-[#070713] text-white overflow-hidden relative">
      {/* Background glow */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-40 w-[500px] h-[500px] rounded-full bg-fuchsia-600/20 blur-3xl" />
        <div className="absolute top-1/3 -right-40 w-[600px] h-[600px] rounded-full bg-cyan-500/20 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 w-[500px] h-[500px] rounded-full bg-indigo-600/20 blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.5) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
      </div>

      <div className="relative z-10 max-w-6xl mx-auto px-6 py-12 md:py-16">
        {/* Header */}
        <header className="flex items-center justify-between mb-16">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-cyan-400 via-fuchsia-500 to-indigo-500 flex items-center justify-center shadow-lg shadow-fuchsia-500/30">
              <Gamepad2 className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight">SanGames</h1>
              <p className="text-[10px] uppercase tracking-[0.25em] text-white/50">
                Web Game Hub
              </p>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-xs text-white/60 bg-white/5 px-3 py-1.5 rounded-full border border-white/10">
            <Sparkles className="w-3.5 h-3.5 text-cyan-300" />
            <span>v1.0 Beta</span>
          </div>
        </header>

        {/* Hero */}
        <section className="text-center mb-16 md:mb-20">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs font-medium text-white/70 mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Platform game web ringan & seru
          </div>
          <h2 className="text-5xl md:text-7xl font-black tracking-tight leading-[1.05] mb-6">
            Main Game{" "}
            <span className="bg-gradient-to-r from-cyan-300 via-fuchsia-400 to-indigo-400 bg-clip-text text-transparent">
              Langsung
            </span>
            <br />
            di Browser-mu.
          </h2>
          <p className="text-base md:text-lg text-white/60 max-w-2xl mx-auto">
            Koleksi game web bikinan SanGames. Tanpa install, tanpa ribet. Pilih game favoritmu
            dan mulai main sekarang.
          </p>
        </section>

        {/* Games Grid */}
        <section>
          <div className="flex items-end justify-between mb-6">
            <h3 className="text-2xl font-bold">Daftar Game</h3>
            <span className="text-sm text-white/50">{GAMES.filter((g) => g.available).length} game tersedia</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {GAMES.map((g) => {
              const card = (
                <div
                  className={`group relative h-full rounded-2xl p-6 border border-white/10 bg-white/[0.03] backdrop-blur-sm transition-all duration-300 ${
                    g.available
                      ? "hover:border-white/30 hover:-translate-y-1 hover:bg-white/[0.06] cursor-pointer"
                      : "opacity-60 cursor-not-allowed"
                  }`}
                >
                  {/* Gradient backdrop on hover */}
                  <div
                    className={`absolute inset-0 rounded-2xl bg-gradient-to-br ${g.gradient} opacity-0 group-hover:opacity-20 transition-opacity duration-300 pointer-events-none`}
                  />
                  <div className="relative">
                    <div className="flex items-start justify-between mb-5">
                      <div
                        className={`w-14 h-14 rounded-xl bg-gradient-to-br ${g.gradient} flex items-center justify-center shadow-lg`}
                      >
                        {g.icon}
                      </div>
                      {g.badge && (
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-white/10 border border-white/20 text-white/80">
                          {g.badge}
                        </span>
                      )}
                    </div>
                    <h4 className="text-xl font-bold mb-1">{g.title}</h4>
                    <p className="text-xs uppercase tracking-wider text-white/40 mb-3">
                      {g.tagline}
                    </p>
                    <p className="text-sm text-white/60 leading-relaxed mb-5">{g.description}</p>
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      {g.available ? (
                        <span className="text-cyan-300 group-hover:text-white transition-colors">
                          Mainkan →
                        </span>
                      ) : (
                        <span className="text-white/40">Segera Hadir</span>
                      )}
                    </div>
                  </div>
                </div>
              );

              return g.available ? (
                <Link key={g.id} to={g.to} className="block h-full">
                  {card}
                </Link>
              ) : (
                <div key={g.id} className="h-full">
                  {card}
                </div>
              );
            })}
          </div>
        </section>

        <footer className="mt-20 pt-8 border-t border-white/5 text-center text-xs text-white/40">
          © {new Date().getFullYear()} SanGames. Made with ❤ for web gamers.
        </footer>
      </div>
    </div>
  );
}
