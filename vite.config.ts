// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Disable the Cloudflare Workers build target when deploying to Vercel.
// Set DEPLOY_TARGET=vercel in Vercel project env vars.
const isVercel = process.env.VERCEL === "1" || process.env.DEPLOY_TARGET === "vercel";

export default defineConfig({
  cloudflare: isVercel ? false : undefined,
  tanstackStart: isVercel
    ? undefined
    : {
        server: { entry: "server" },
      },
});
