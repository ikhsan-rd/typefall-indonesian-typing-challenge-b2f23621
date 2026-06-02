import { createFileRoute } from "@tanstack/react-router";
import RhythmHero from "@/components/RhythmHero";

export const Route = createFileRoute("/rhythm")({
  component: RhythmPage,
  head: () => ({
    meta: [
      { title: "Rhythm Hero — SanGames" },
      {
        name: "description",
        content:
          "Rhythm Hero: game ritme 6 lajur ala Guitar Hero dengan deteksi beat otomatis dari musik online.",
      },
      { property: "og:title", content: "Rhythm Hero — SanGames" },
      {
        property: "og:description",
        content: "Tekan A S D J K L mengikuti irama lagu. Beatmap dibuat otomatis dari audio.",
      },
    ],
  }),
});

function RhythmPage() {
  return <RhythmHero />;
}
