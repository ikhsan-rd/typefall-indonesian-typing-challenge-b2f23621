import { createFileRoute } from "@tanstack/react-router";
import RhythmHero from "@/components/RhythmHero";

export const Route = createFileRoute("/rhythm")({
  component: RhythmPage,
  head: () => ({
    meta: [
      { title: "Typing Hero — SanGames" },
      {
        name: "description",
        content:
          "Typing Hero: game ritme 6 lajur ala Guitar Hero dengan lagu langsung dari Audius.",
      },
      { property: "og:title", content: "Typing Hero — SanGames" },
      {
        property: "og:description",
        content: "Tekan A S D J K L mengikuti irama lagu Audius. Beatmap dibuat otomatis.",
      },
    ],
  }),
});

function RhythmPage() {
  return <RhythmHero />;
}
