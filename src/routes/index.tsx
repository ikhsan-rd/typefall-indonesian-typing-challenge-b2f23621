import { createFileRoute } from "@tanstack/react-router";
import TypeFall from "@/components/TypeFall";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "TypeFall — Speed Typing Arcade" },
      {
        name: "description",
        content:
          "TypeFall: game mengetik realtime dengan kata baku KBBI. Hancurkan objek yang jatuh sebelum menyentuh garis bawah.",
      },
      { property: "og:title", content: "TypeFall — Speed Typing Arcade" },
      {
        property: "og:description",
        content: "Game arcade mengetik kata baku KBBI dengan tema neon futuristik.",
      },
    ],
  }),
});

function Index() {
  return <TypeFall />;
}
