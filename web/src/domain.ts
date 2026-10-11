import {
  formatUnits,
  hexToString,
  parseUnits,
  type Address,
  type Hex,
} from "viem";

export type Failure = {
  status: number; // Intake v2: 1 refused, 2 no answer
  reason: string;
  agreed: number;
  answered: number;
  tx: Hex;
};
export type Plea = {
  id: bigint;
  seller: Address;
  factScore: number;
  need: number;
  score: number;
  status: number;
  appealed: boolean;
  isAppeal: boolean;
  amount: bigint;
  submittedAt: bigint;
  verdictAt: bigint;
  originalId: bigint;
  intakeId: Hex;
  text: string;
  tx: Hex;
  verdictTx?: Hex;
  oracleId?: Hex;
  completed: boolean;
  recorded: boolean;
  failed?: Failure;
};
export type Entry = { wallet: Address; points: number; pleaId: bigint };
export type PleaEntry = { pleaId: bigint; score: number };
export type Nft = {
  id: bigint;
  owner: Address;
  pleaId: bigint;
  season: bigint;
  rank: number;
  name: string;
  image: string;
};
export const shares = [25, 18, 14, 11, 9, 7, 6, 4, 3, 3]; // Seasons._shareBps: internal, no public getter.
export const short = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`;
export const eq = (a?: string, b?: string) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();
export const fmt = (n: bigint | undefined, digits = 3, decimals = 18) =>
  n === undefined
    ? "—"
    : Number(formatUnits(n, decimals)).toLocaleString("en-US", {
        maximumFractionDigits: digits,
      });
// sIMD has 24 decimals on Sepolia (TestSIMD); the Stacker's Stacked.imd is 18-decimal IMD.
export const SIMD_DECIMALS = 24;
export const fmtSimd = (n: bigint | undefined, digits = 5) =>
  fmt(n, digits, SIMD_DECIMALS);
export const compact = (n: bigint | undefined, decimals = 18) =>
  n === undefined
    ? "—"
    : Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumFractionDigits: 2,
      }).format(Number(formatUnits(n, decimals)));
export function amountOf(value: string): bigint {
  if (!/^\d+(\.\d{0,18})?$/.test(value)) return 0n;
  try {
    return parseUnits(value, 18);
  } catch {
    return 0n;
  }
}
export function duration(s: number | bigint): string {
  const v = Math.max(0, Number(s));
  if (v < 60) return `${Math.ceil(v)}s`;
  const h = Math.floor(v / 3600),
    m = Math.floor((v % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m ${Math.floor(v % 60)}s`;
}
export const when = (n: bigint) =>
  new Date(Number(n) * 1000).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }) + " UTC";
export const bytes = (s: string) => new TextEncoder().encode(s).length;
// Byte-for-byte mirror of CabalGate._validateText, including the entire F3 A0 block.
export function validatePlea(text: string, max = 280): string | undefined {
  const b = new TextEncoder().encode(text),
    n = b.length;
  if (!n || n > max) return `Use 1–${max} UTF-8 bytes.`;
  const bad =
    "Remove control characters, line breaks, invisible characters or [PLEA markers.";
  for (let i = 0; i < n;) {
    const c = b[i];
    if (c < 0x20 || c === 0x7f) return bad;
    if (c === 0x5b) {
      let j = i + 1;
      if (b[j] === 0x2f) j++;
      if (
        j + 4 <= n &&
        String.fromCharCode(...b.slice(j, j + 4)).toLowerCase() === "plea"
      )
        return bad;
    }
    if (c < 0x80) {
      i++;
      continue;
    }
    const len =
      c >= 0xc2 && c <= 0xdf
        ? 2
        : c >= 0xe0 && c <= 0xef
          ? 3
          : c >= 0xf0 && c <= 0xf4
            ? 4
            : 0;
    if (!len || i + len > n) return bad;
    for (let k = 1; k < len; k++) if ((b[i + k] & 0xc0) !== 0x80) return bad;
    const c1 = b[i + 1],
      c2 = b[i + 2];
    if (
      (c === 0xe0 && c1 < 0xa0) ||
      (c === 0xed && c1 > 0x9f) ||
      (c === 0xf0 && c1 < 0x90) ||
      (c === 0xf4 && c1 > 0x8f)
    )
      return bad;
    if (
      len === 2 &&
      ((c === 0xc2 && (c1 <= 0x9f || c1 === 0xad)) ||
        (c === 0xd8 && c1 === 0x9c))
    )
      return bad;
    if (
      len === 3 &&
      ((c === 0xe2 &&
        c1 === 0x80 &&
        ((c2 >= 0x8b && c2 <= 0x8f) || (c2 >= 0xa8 && c2 <= 0xae))) ||
        (c === 0xe2 &&
          c1 === 0x81 &&
          ((c2 >= 0xa0 && c2 <= 0xa4) || (c2 >= 0xa6 && c2 <= 0xa9))) ||
        (c === 0xef && c1 === 0xbb && c2 === 0xbf) ||
        (c === 0xef && c1 === 0xb8 && c2 <= 0x8f) ||
        (c === 0xe1 && c1 === 0xa0 && c2 === 0x8e))
    )
      return bad;
    if (len === 4 && c === 0xf3 && c1 === 0xa0) return bad;
    i += len;
  }
}
export function validateName(s: string) {
  return s === ""
    ? undefined
    : !/^([a-z0-9_]){3,20}$/.test(s)
      ? "Use 3–20 characters: a–z, 0–9 and _."
      : ["cabal", "admin", "imd", "plea", "owner"].includes(s)
        ? "This name is reserved. Choose another."
        : undefined;
}
export type PleaState =
  | "Pending"
  | "No verdict"
  | "Approved"
  | "Lapsed"
  | "Denied"
  | "Executed"
  | "Expired"
  | "None"
  | "Unknown";
/// The Gate's status plus the clocks. A pending plea stays "Pending" for the full
/// PENDING_EXPIRY; the Intake clears it at once when there is no verdict (PleaFailed, status 6
/// with a failure record). A plea cleared by expire() without a failure record is "Expired".
export function pleaState(
  p: Plea,
  now: bigint,
  pending: bigint,
  execute: bigint,
): PleaState {
  if (p.status === 1) return now > p.submittedAt + pending ? "No verdict" : "Pending";
  if (p.status === 2)
    return now > p.verdictAt + execute ? "Lapsed" : "Approved";
  if (p.status === 6) return p.failed ? "No verdict" : "Expired";
  return (
    (
      ["None", "Pending", "Approved", "Denied", "Executed", "Lapsed", "Expired"] as const
    )[p.status] || "Unknown"
  );
}
/// The stale fallback: the plea is still pending on chain after PENDING_EXPIRY, so anyone may
/// call expire(id). Intake v2 normally clears a verdict-less plea first.
export const canExpire = (p: Plea, now: bigint, pending: bigint) =>
  p.status === 1 && now > p.submittedAt + pending;
export const approved = (p: Plea) => [2, 4, 5].includes(p.status);
export type Tone = "approved" | "denied" | "pending" | "neutral" | "gold";
/// One colour per state, light and dark: approved/executed green, denied/upheld red, pending
/// amber, no verdict/expired/lapsed grey, Laureate gold.
export function toneOf(state: string): Tone {
  switch (state) {
    case "Approved":
    case "Executed":
    case "Overturned":
      return "approved";
    case "Denied":
    case "Upheld":
      return "denied";
    case "Pending":
      return "pending";
    case "Laureate":
      return "gold";
    default:
      return "neutral";
  }
}
/// Intake v2 failure reasons arrive as bytes32: a short ASCII tag when readable, else hex.
export function failureReason(reason: Hex | string | undefined): string {
  if (!reason || /^0x0*$/.test(reason)) return "";
  try {
    const text = hexToString(reason as Hex).replace(/\0+$/g, "");
    if (text && /^[\x20-\x7e]+$/.test(text)) return text;
  } catch {}
  return String(reason);
}
/// Plain words for an Intake v2 failure status and tag.
export function failureText(f: Failure) {
  const status =
    f.status === 1
      ? "The Intake refused the request"
      : f.status === 2
        ? "The panel gave no answer"
        : `The Intake reported status ${f.status}`;
  const reason = f.reason
    ? ` (${f.reason.replace(/[_-]+/g, " ")})`
    : "";
  return `${status}${reason}.`;
}
export function gasLimit(
  estimate: bigint,
  swap: boolean,
  creditGas: bigint = 0n,
) {
  const scaled = (estimate * (swap ? 130n : 150n) + 99n) / 100n;
  // Swaps never go below creditGas + 1,300,000: the hook's cashback credit plus the router,
  // Gate and EIP-150 forwarding before the hook's gas guard.
  const floor = swap ? creditGas + 1_300_000n : 0n;
  return scaled > floor ? scaled : floor;
}
export function deltas(delta: bigint) {
  return [
    BigInt.asIntN(128, delta >> 128n),
    BigInt.asIntN(128, delta),
  ] as const;
}
export function minimumOut(out: bigint, slippage: string) {
  const n = Number(slippage);
  if (!Number.isFinite(n) || n < 0.1 || n > 5)
    throw Error("Use slippage between 0.1% and 5%.");
  return (out * (10000n - BigInt(Math.round(n * 100)))) / 10000n;
}
/// A rank's share of a pot (IMD) or of the season's PLEA bonus, in token units.
export const shareOf = (pot: bigint, rank: number) =>
  (pot * BigInt(shares[rank] ?? 0)) / 100n;
/// Seasons 1-4 (keys 0-3) also pay BONUS_PER_SEASON PLEA to the qualifying top 10.
export const bonusOf = (
  seasonKey: bigint,
  c: Record<string, bigint>,
): bigint =>
  seasonKey < (c.BONUS_SEASONS ?? 0n) ? (c.BONUS_PER_SEASON ?? 0n) : 0n;
export function standings(
  pleas: Plea[],
  start: bigint,
  length: bigint,
  season: bigint,
) {
  const groups = new Map<string, Plea[]>();
  for (const p of pleas)
    if (
      p.recorded &&
      approved(p) &&
      p.verdictAt >= start &&
      (p.verdictAt - start) / length === season
    ) {
      const key = p.seller.toLowerCase();
      groups.set(key, [...(groups.get(key) ?? []), p]);
    }
  return [...groups.entries()]
    .map(([wallet, ps]) => {
      const best = ps
        .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))
        .slice(0, 3);
      return {
        wallet,
        points: best.reduce((n, p) => n + p.score, 0),
        newest: best.reduce((n, p) => (p.id > n ? p.id : n), 0n),
        scores: best.map((p) => p.score),
      };
    })
    .sort(
      (a, b) =>
        b.points - a.points ||
        (a.newest < b.newest ? -1 : a.newest > b.newest ? 1 : 0),
    );
}
