import { supabase } from "@/integrations/supabase/client";

export type ScoreRow = {
  id: string;
  game: string;
  player_name: string;
  score: number;
  level: number;
  accuracy: number;
  wpm: number;
  duration_sec: number;
  created_at: string;
};

export type ScoreInput = {
  game?: string;
  player_name: string;
  score: number;
  level: number;
  accuracy: number;
  wpm: number;
  duration_sec: number;
};

export function sanitizeName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, 24);
}

export async function submitScore(input: ScoreInput): Promise<void> {
  const name = sanitizeName(input.player_name);
  if (!name) return;
  const payload = {
    game: input.game ?? "typefall",
    player_name: name,
    score: Math.max(0, Math.min(1_000_000, Math.floor(input.score))),
    level: Math.max(1, Math.min(999, Math.floor(input.level))),
    accuracy: Math.max(0, Math.min(100, Math.floor(input.accuracy))),
    wpm: Math.max(0, Math.min(1000, Math.floor(input.wpm))),
    duration_sec: Math.max(0, Math.min(86400, Math.floor(input.duration_sec))),
  };
  const { error } = await supabase.from("scores").insert(payload);
  if (error) {
    // eslint-disable-next-line no-console
    console.error("submitScore failed:", error.message);
  }
}

export async function fetchTopScores(
  game = "typefall",
  limit = 50,
): Promise<ScoreRow[]> {
  const { data, error } = await supabase
    .from("scores")
    .select("*")
    .eq("game", game)
    .order("score", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    // eslint-disable-next-line no-console
    console.error("fetchTopScores failed:", error.message);
    return [];
  }
  return (data ?? []) as ScoreRow[];
}

const NAME_KEY = "sangames:player_name";

export function loadSavedName(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(NAME_KEY) ?? "";
}

export function saveName(name: string) {
  if (typeof window === "undefined") return;
  const clean = sanitizeName(name);
  if (clean) window.localStorage.setItem(NAME_KEY, clean);
}
