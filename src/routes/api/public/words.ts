import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/words")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const sp = url.searchParams.get("sp") ?? "";
        const max = url.searchParams.get("max") ?? "300";

        const datamuseUrl = `https://api.datamuse.com/words?sp=${encodeURIComponent(sp)}&max=${encodeURIComponent(max)}`;

        const res = await fetch(datamuseUrl);
        if (!res.ok) {
          return new Response(
            JSON.stringify({ error: "Upstream request failed" }),
            { status: 502, headers: { "Content-Type": "application/json" } }
          );
        }

        const data = await res.json();
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
