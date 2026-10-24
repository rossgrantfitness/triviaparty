// Room codes that double as directions to the game PC.
//
// When the game runs on someone's PC, the room code is this PC's home-network
// address, scrambled into letters. The website (docs/index.html) turns the code
// back into the address and sends the phone there, so players only ever type the
// website and the code. Home networks (192.168.x.x) give 4 letters; 172.16–31.x.x
// gives 5 and 10.x.x.x gives 6.
//
// The website uses a copy of this file built by tools/build_site.mjs; rebuild it
// after changing anything here.

export const JOIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";

/** Scramble constants: any multiplier sharing no factor with 24 works. */
const MULTIPLIER = 7919n;
const OFFSET = 104729n;

interface AddressClass {
  length: number;
  /** Number of addresses in the class. */
  size: number;
  toIndex(parts: number[]): number | null;
  fromIndex(index: number): number[];
}

const CLASSES: AddressClass[] = [
  {
    length: 4,
    size: 1 << 16,
    toIndex: (p) => (p[0] === 192 && p[1] === 168 ? p[2]! * 256 + p[3]! : null),
    fromIndex: (i) => [192, 168, i >> 8, i & 255],
  },
  {
    length: 5,
    size: 1 << 20,
    toIndex: (p) => (p[0] === 172 && p[1]! >= 16 && p[1]! <= 31 ? (p[1]! - 16) * 65536 + p[2]! * 256 + p[3]! : null),
    fromIndex: (i) => [172, 16 + (i >> 16), (i >> 8) & 255, i & 255],
  },
  {
    length: 6,
    size: 1 << 24,
    toIndex: (p) => (p[0] === 10 ? p[1]! * 65536 + p[2]! * 256 + p[3]! : null),
    fromIndex: (i) => [10, i >> 16, (i >> 8) & 255, i & 255],
  },
];

function modulus(length: number): bigint {
  return BigInt(JOIN_CODE_ALPHABET.length) ** BigInt(length);
}

function inverse(a: bigint, m: bigint): bigint {
  let [oldR, r] = [a % m, m];
  let [oldS, s] = [1n, 0n];
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
  }
  return ((oldS % m) + m) % m;
}

function parseAddress(address: string): number[] | null {
  const parts = address.trim().split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return parts;
}

/** The room code for a private IPv4 address, or null if it isn't a home-network address. */
export function encodeJoinCode(address: string): string | null {
  const parts = parseAddress(address);
  if (!parts) return null;
  for (const c of CLASSES) {
    const index = c.toIndex(parts);
    if (index === null) continue;
    const m = modulus(c.length);
    let value = (BigInt(index) * MULTIPLIER + OFFSET) % m;
    let code = "";
    for (let i = 0; i < c.length; i++) {
      code = JOIN_CODE_ALPHABET[Number(value % 24n)] + code;
      value /= 24n;
    }
    return code;
  }
  return null;
}

/** The PC address a room code points to, or null if the code doesn't point anywhere. */
export function decodeJoinCode(code: string): string | null {
  const clean = code.trim().toUpperCase();
  const c = CLASSES.find((k) => k.length === clean.length);
  if (!c) return null;
  let value = 0n;
  for (const letter of clean) {
    const digit = JOIN_CODE_ALPHABET.indexOf(letter);
    if (digit < 0) return null;
    value = value * 24n + BigInt(digit);
  }
  const m = modulus(c.length);
  const index = Number(((((value - OFFSET) % m) + m) % m * inverse(MULTIPLIER, m)) % m);
  return index < c.size ? c.fromIndex(index).join(".") : null;
}

/**
 * The best home-network address from a list: 192.168.x.x first, then 10.x, then
 * 172.16–31.x (last because virtual adapters like WSL and Docker use it).
 */
export function pickLanAddress(addresses: string[]): string | null {
  for (const c of [CLASSES[0]!, CLASSES[2]!, CLASSES[1]!]) {
    const hit = addresses.find((a) => {
      const parts = parseAddress(a);
      return parts !== null && c.toIndex(parts) !== null;
    });
    if (hit) return hit;
  }
  return null;
}
