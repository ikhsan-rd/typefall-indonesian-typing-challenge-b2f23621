import { supabase } from "@/integrations/supabase/client";

export type RoomStatus = "waiting" | "playing" | "round_end" | "match_end";

export type Room = {
  id: string;
  code: string;
  status: RoomStatus;
  host_user_id: string;
  target_diff: number;
  round_time: number;
  max_rounds: number;
  round_winner: number | null;
  match_winner: number | null;
};

export type RoomPlayer = {
  id: string;
  room_id: string;
  user_id: string;
  name: string;
  slot: 1 | 2;
  is_ready: boolean;
};

export type RoomState = {
  room_id: string;
  round: number;
  round_started_at: string | null;
  score_p1: number;
  score_p2: number;
  diff_score: number;
  combined_score: number;
  level: number;
  last_gain_p1: number;
  last_gain_p2: number;
  wins_p1: number;
  wins_p2: number;
};

export async function ensureAnonAuth(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  if (data.session?.user) return data.session.user.id;
  const { data: signed, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  return signed.user!.id;
}

export async function rpcCreateRoom(args: {
  name: string;
  target_diff: number;
  round_time: number;
  max_rounds: number;
}) {
  const { data, error } = await supabase.rpc("create_room", {
    _name: args.name,
    _target_diff: args.target_diff,
    _round_time: args.round_time,
    _max_rounds: args.max_rounds,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as { room_id: string; code: string };
}

export async function rpcJoinRoom(code: string, name: string) {
  const { data, error } = await supabase.rpc("join_room", {
    _code: code.toUpperCase(),
    _name: name,
  });
  if (error) throw error;
  return data as string;
}

export async function rpcSetReady(room_id: string, ready: boolean) {
  const { error } = await supabase.rpc("set_ready", { _room: room_id, _ready: ready });
  if (error) throw error;
}

export async function rpcStartMatch(room_id: string) {
  const { error } = await supabase.rpc("start_match", { _room: room_id });
  if (error) throw error;
}

export async function rpcAward(room_id: string, points: number) {
  const { error } = await supabase.rpc("award_score", { _room: room_id, _points: points });
  if (error) throw error;
}

export async function rpcPenalize(room_id: string) {
  const { error } = await supabase.rpc("penalize", { _room: room_id });
  if (error) throw error;
}

export async function rpcEndRound(room_id: string) {
  const { error } = await supabase.rpc("end_round", { _room: room_id });
  if (error) throw error;
}

export async function rpcNextRound(room_id: string) {
  const { error } = await supabase.rpc("next_round", { _room: room_id });
  if (error) throw error;
}

export async function fetchRoom(room_id: string) {
  const { data } = await supabase.from("rooms").select("*").eq("id", room_id).single();
  return data as Room | null;
}
export async function fetchPlayers(room_id: string) {
  const { data } = await supabase
    .from("room_players")
    .select("*")
    .eq("room_id", room_id)
    .order("slot");
  return (data ?? []) as RoomPlayer[];
}
export async function fetchState(room_id: string) {
  const { data } = await supabase.from("room_state").select("*").eq("room_id", room_id).single();
  return data as RoomState | null;
}
