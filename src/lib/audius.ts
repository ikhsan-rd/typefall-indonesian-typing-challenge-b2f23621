// Audius API helper — read-only (search + trending + stream).
// Catatan: kunci di bawah sengaja disertakan sesuai permintaan user.
// Untuk endpoint baca, app_name + api_key sudah cukup. Bearer hanya dipakai
// jika diperlukan oleh host tertentu.
const APP_NAME = "SanGames";
const API_KEY = "0xf9147cc0eafc5c188aa3c6954bb90b7fc7de7c14";
const BEARER = "Gm9dRf-R4QoKzXIn-K5RR6X_bVp28TxqUD_m86LlNRY=";

export type AudiusTrack = {
  id: string;
  title: string;
  artist: string;
  artwork?: string;
  duration: number;
  streamUrl: string;
};

let HOST: string | null = null;

async function getHost(): Promise<string> {
  if (HOST) return HOST;
  try {
    const res = await fetch("https://api.audius.co");
    const j = await res.json();
    const list: string[] = j.data || [];
    HOST = list[Math.floor(Math.random() * list.length)] || "https://discoveryprovider.audius.co";
  } catch {
    HOST = "https://discoveryprovider.audius.co";
  }
  return HOST!;
}

function authHeaders(): HeadersInit {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${BEARER}`,
    "X-API-KEY": API_KEY,
  };
}

function mapTrack(t: any, host: string): AudiusTrack {
  const art =
    t.artwork?.["480x480"] || t.artwork?.["150x150"] || t.artwork?.["1000x1000"];
  return {
    id: t.id,
    title: t.title,
    artist: t.user?.name || t.user?.handle || "Unknown",
    artwork: art,
    duration: t.duration ?? 0,
    streamUrl: `${host}/v1/tracks/${t.id}/stream?app_name=${APP_NAME}&api_key=${API_KEY}`,
  };
}

export async function fetchTrending(limit = 12): Promise<AudiusTrack[]> {
  const host = await getHost();
  const res = await fetch(
    `${host}/v1/tracks/trending?app_name=${APP_NAME}&api_key=${API_KEY}&limit=${limit}`,
    { headers: authHeaders() },
  );
  if (!res.ok) throw new Error(`Audius trending error ${res.status}`);
  const j = await res.json();
  return (j.data || []).slice(0, limit).map((t: any) => mapTrack(t, host));
}

export async function searchTracks(query: string, limit = 12): Promise<AudiusTrack[]> {
  const host = await getHost();
  const res = await fetch(
    `${host}/v1/tracks/search?query=${encodeURIComponent(query)}&app_name=${APP_NAME}&api_key=${API_KEY}&limit=${limit}`,
    { headers: authHeaders() },
  );
  if (!res.ok) throw new Error(`Audius search error ${res.status}`);
  const j = await res.json();
  return (j.data || []).slice(0, limit).map((t: any) => mapTrack(t, host));
}
