import { createFileRoute } from "@tanstack/react-router";
import Multiplayer from "@/components/Multiplayer";

export const Route = createFileRoute("/multiplayer")({
  component: Multiplayer,
  head: () => ({
    meta: [
      { title: "TypeFall Multiplayer — 1v1 Duel" },
      { name: "description", content: "Duel mengetik 1v1 realtime dengan tug-of-war meter." },
      { property: "og:title", content: "TypeFall Multiplayer" },
      { property: "og:description", content: "Duel mengetik 1v1 realtime." },
    ],
  }),
});
