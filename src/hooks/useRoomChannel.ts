import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Room,
  RoomPlayer,
  RoomState,
  fetchPlayers,
  fetchRoom,
  fetchState,
} from "@/lib/multiplayer";

export function useRoomChannel(room_id: string | null) {
  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<RoomPlayer[]>([]);
  const [state, setState] = useState<RoomState | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!room_id) return;
    let cancelled = false;
    (async () => {
      const [r, p, s] = await Promise.all([
        fetchRoom(room_id),
        fetchPlayers(room_id),
        fetchState(room_id),
      ]);
      if (cancelled) return;
      setRoom(r);
      setPlayers(p);
      setState(s);
      setReady(true);
    })();

    const ch = supabase
      .channel(`room:${room_id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rooms", filter: `id=eq.${room_id}` },
        (payload) => {
          if (payload.eventType === "DELETE") setRoom(null);
          else setRoom(payload.new as Room);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_players", filter: `room_id=eq.${room_id}` },
        async () => {
          const p = await fetchPlayers(room_id);
          setPlayers(p);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_state", filter: `room_id=eq.${room_id}` },
        (payload) => setState(payload.new as RoomState),
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [room_id]);

  return { room, players, state, ready };
}
