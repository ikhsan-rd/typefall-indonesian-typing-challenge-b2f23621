const ALPHA = "abcdefghijklmnopqrstuvwxyz";

export function randomNonsense(len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) {
    s += ALPHA[Math.floor(Math.random() * ALPHA.length)];
  }
  return s;
}

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function getLengthByLevel(level: number): number {
  // Naik tiap 2 level
  // level 1-2 => 3-5
  // level 3-4 => 4-6
  // level 5-6 => 5-7
  // dst...
  const base = 3 + Math.floor((level - 1) / 2);

  const minLen = base;
  const maxLen = base + 2;

  return randInt(minLen, maxLen);
}

export async function getRandomWord(level: number): Promise<string> {
  const len = getLengthByLevel(level);

  const pattern = "?".repeat(len);
  const url = `/api/public/words?sp=${pattern}&max=300`;

  const res = await fetch(url);
  if (!res.ok) {
    return randomNonsense(len);
  }

  const data: { word: string }[] = await res.json();

  const filtered = data
    .map((x) => x.word.toLowerCase())
    .filter((w) => w.length === len)
    .filter((w) => /^[a-z]+$/.test(w));

  if (filtered.length === 0) {
    return randomNonsense(len);
  }

  return filtered[Math.floor(Math.random() * filtered.length)];
}
