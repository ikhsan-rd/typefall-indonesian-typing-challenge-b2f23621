import { createFileRoute } from "@tanstack/react-router";
import TypeFall from "@/components/TypeFall";

export const Route = createFileRoute("/typefall")({
  component: TypeFallPage,
  head: () => ({
    meta: [
      { title: "TypeFall — SanGames" },
      {
        name: "description",
        content:
          "TypeFall: game mengetik realtime dengan kata. Hancurkan objek yang jatuh sebelum menyentuh garis bawah.",
      },
      { property: "og:title", content: "TypeFall — SanGames" },
      {
        property: "og:description",
        content: "Game arcade mengetik kata dengan tema neon futuristik.",
      },
    ],
  }),
});

function TypeFallPage() {
  return <TypeFall />;
}
