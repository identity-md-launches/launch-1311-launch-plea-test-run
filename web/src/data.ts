import {
  decodeEventLog,
  keccak256,
  hexToBytes,
  bytesToHex,
  type Address,
  type Hex,
  type Log,
} from "viem";
import {
  addresses,
  abis,
  client,
  launchBlock,
  read,
  stackerAbi,
} from "./contracts";
import runtime from "./runtime.json";
import {
  eq,
  failureReason,
  type Entry,
  type Plea,
  type PleaEntry,
  type Nft,
} from "./domain";

export type ChainEvent = {
  name: string;
  args: Record<string, any>;
  tx: Hex;
  block: bigint;
  index: number;
};
export type Hall = {
  season: bigint;
  pot: bigint;
  paid: bigint;
  top: Entry[];
  payouts: ChainEvent[];
  bonusPaid: ChainEvent[];
  bonusBurned: bigint;
  bonusTotal: bigint;
};
export type Snapshot = {
  constants: Record<string, bigint>;
  block: bigint;
  timestamp: bigint;
  loadedAt: number;
  alive: boolean;
  startedAt: bigint;
  lastVerdictAt: bigint;
  diedAt: bigint;
  season: bigint;
  endsAt: bigint;
  seasonPot: bigint;
  totalPot: bigint;
  rollover: bigint;
  nextToClose: bigint;
  closeBounds: readonly [boolean, bigint, bigint, boolean];
  finished: boolean;
  price: bigint;
  supply: bigint;
  burned: bigint;
  market: bigint;
  wall: bigint;
  retained: bigint;
  rebalance: boolean;
  launchExtra: bigint;
  pleaIsZero: boolean;
  bonusBurned: bigint;
  bonusHeld: bigint;
  poolKey: {
    currency0: Address;
    currency1: Address;
    fee: number;
    tickSpacing: number;
    hooks: Address;
  };
  pleas: Plea[];
  events: ChainEvent[];
  names: Record<string, string>;
  top: Entry[];
  topPleas: PleaEntry[];
  halls: Hall[];
  nfts: Nft[];
};
export type WalletData = {
  plea: bigint;
  imd: bigint;
  oracle: bigint;
  simd: bigint;
  cashback: bigint;
  cashbackCount: number;
  basis: readonly [bigint, bigint, bigint];
  best: readonly number[];
  pending: bigint;
  cooldownUntil: bigint;
  nextFaucetAt: bigint;
};
const constantsByContract: Record<string, string[]> = {
  CabalGate: [
    "SEASON",
    "DEADMAN",
    "ORACLE_FEE",
    "APPEAL_POOL_SHARE",
    "EXECUTE_WINDOW",
    "COOLDOWN",
    "PENDING_EXPIRY",
    "MAX_PLEA_BYTES",
    "MAX_SELL",
    "MAX_SHARE_BPS",
    "PASS_MARK",
    "MAX_PLEA_SCORE",
    "PANEL_SIZE",
    "QUORUM",
  ],
  PleaHook: [
    "BPS",
    "CASHBACK_BPS",
    "OWNER_BPS",
    "PRIZE_BPS",
    "POOL_BPS",
    "IMD_FEE_BPS",
    "PLEA_BURN_BPS",
    "LAUNCH_WINDOW",
    "LAUNCH_EXTRA_BPS",
    "LAUNCH_MAX_BUY",
    "creditGas",
    "SWAP_RESERVE",
    "CREDIT_RESERVE",
    "LP_FEE",
    "TICK_SPACING",
  ],
  PLEA: ["TOTAL_SUPPLY"],
  Seasons: [
    "MIN_POINTS",
    "CLOSE_GRACE",
    "TOP",
    "LAUREATES_PER_SEASON",
    "BONUS_SEASONS",
    "BONUS_PER_SEASON",
  ],
  PleaLaunch: ["START"],
  TestIMD: ["FAUCET_AMOUNT", "FAUCET_COOLDOWN"],
};
let constants: Record<string, bigint> | undefined;
let verified = false;
export async function verifyDeployment() {
  if (verified) return;
  const chain = await client.getChainId();
  if (chain !== 11155111)
    throw Error(
      "The RPC returned the wrong chain. Refresh to reconnect to Sepolia.",
    );
  await Promise.all(
    Object.entries(addresses).map(async ([name, address]) => {
      const code = await client.getBytecode({ address });
      if (!code || code === "0x")
        throw Error(
          `${name} has no deployed code on Sepolia. Writes are disabled.`,
        );
      const expected = runtime.find((r) => r.name === name);
      if (expected) {
        const bytes = hexToBytes(code);
        for (const { start, length } of expected.references)
          bytes.fill(0, start, start + length);
        if (keccak256(bytesToHex(bytes)) !== expected.expected)
          throw Error(
            `${name} runtime code differs from the verified source. Writes are disabled.`,
          );
      }
    }),
  );
  const [hook, launchHook] = await Promise.all([
    read<Address>("PLEA", "hook"),
    read<Address>("PleaLaunch", "hook"),
  ]);
  if (!eq(hook, addresses.PleaHook) || !eq(launchHook, addresses.PleaHook))
    throw Error(
      "The live PLEA hook differs from the verified launch. Writes are disabled.",
    );
  const refs = await Promise.all(
    ["gate", "seasons", "laureates", "distributor", "launcher"].map((fn) =>
      read<Address>("PLEA", fn),
    ),
  );
  [
    "CabalGate",
    "Seasons",
    "Laureates",
    "PleaDistributor",
    "PleaLaunch",
  ].forEach((name, i) => {
    if (!eq(refs[i], addresses[name]))
      throw Error(
        `PLEA.${name} does not match the launch manifest. Writes are disabled.`,
      );
  });
  verified = true;
}
export async function loadConstants() {
  if (constants) return constants;
  const entries = await Promise.all(
    Object.entries(constantsByContract).flatMap(([c, fs]) =>
      fs.map(async (f) => [f, BigInt(await read(c, f))] as const),
    ),
  );
  constants = Object.fromEntries(entries);
  return constants;
}
const rawLogs = new Map<string, Log>();
let indexedTo = launchBlock - 1n;
// Public RPCs cap the logs a range may return; halve the range until it fits.
async function bisect<T>(
  from: bigint,
  to: bigint,
  get: (from: bigint, to: bigint) => Promise<T[]>,
): Promise<T[]> {
  try {
    return await get(from, to);
  } catch (error) {
    if (to - from < 32n) throw error;
    const mid = (from + to) / 2n;
    return [
      ...(await bisect(from, mid, get)),
      ...(await bisect(mid + 1n, to, get)),
    ];
  }
}
const fetchLogs = (from: bigint, to: bigint) =>
  bisect(from, to, (fromBlock, toBlock) =>
    client.getLogs({
      address: [addresses.CabalGate, addresses.Seasons],
      fromBlock,
      toBlock,
    }),
  );
async function eventsTo(head: bigint) {
  const from = indexedTo >= launchBlock + 12n ? indexedTo - 12n : launchBlock;
  const fetched: Log[] = [];
  for (let start = from; start <= head; start += 2000n)
    fetched.push(
      ...(await fetchLogs(start, start + 1999n < head ? start + 1999n : head)),
    );
  for (const [key, log] of rawLogs)
    if (log.blockNumber! >= from) rawLogs.delete(key);
  for (const log of fetched)
    rawLogs.set(`${log.transactionHash}:${log.logIndex}`, log);
  indexedTo = head;
  return [...rawLogs.values()]
    .flatMap((log) => {
      try {
        const d = decodeEventLog({
          abi: eq(log.address, addresses.CabalGate)
            ? abis.CabalGate
            : abis.Seasons,
          data: log.data,
          topics: log.topics,
        });
        return [
          {
            name: String(d.eventName),
            args: d.args as Record<string, any>,
            tx: log.transactionHash!,
            block: log.blockNumber!,
            index: log.logIndex!,
          },
        ];
      } catch {
        return [];
      }
    })
    .sort((a, b) =>
      a.block === b.block ? a.index - b.index : a.block < b.block ? -1 : 1,
    );
}
export async function loadSnapshot(): Promise<Snapshot> {
  await verifyDeployment();
  const [c, block] = await Promise.all([loadConstants(), client.getBlock()]);
  const r = async <T = bigint>(
    name: string,
    fn: string,
    args: readonly unknown[] = [],
  ) => read<T>(name, fn, args);
  const [
    events,
    startedAt,
    lastVerdictAt,
    diedAt,
    alive,
    seasonNow,
    rollover,
    totalPot,
    nextToClose,
    finished,
    price,
    supply,
    burned,
    market,
    wall,
    retained,
    rebalance,
    launchExtra,
    pleaIsZero,
    poolKey,
    bonusBurned,
    bonusHeld,
  ] = await Promise.all([
    eventsTo(block.number),
    r("CabalGate", "startedAt"),
    r("CabalGate", "lastVerdictAt"),
    r("CabalGate", "diedAt"),
    r<boolean>("CabalGate", "cabalAlive"),
    r<readonly [boolean, bigint, bigint]>("Seasons", "currentSeason"),
    r("Seasons", "rollover"),
    r("Seasons", "pot"),
    r("Seasons", "nextToClose"),
    r<boolean>("Seasons", "finished"),
    r("PleaHook", "priceX96"),
    r("PLEA", "totalSupply"),
    r("PleaHook", "totalBurned"),
    r("PleaHook", "pleaInMarket"),
    r("PleaHook", "wallImd"),
    r("PleaHook", "retainedImd"),
    r<boolean>("PleaHook", "pendingRebalance"),
    r("PleaHook", "launchExtraBps"),
    r<boolean>("PleaHook", "pleaIsZero"),
    r<Snapshot["poolKey"]>("PleaHook", "poolKey"),
    r("Seasons", "bonusBurned"),
    r("PLEA", "balanceOf", [addresses.Seasons]),
  ]);
  const season = alive
    ? seasonNow[1]
    : diedAt && startedAt
      ? (diedAt - 1n - startedAt) / c.SEASON
      : 0n;
  const endsAt = alive ? seasonNow[2] : diedAt;
  const submissions = events.filter((e) => e.name === "PleaSubmitted");
  const verdicts = new Map(
    events
      .filter((e) => e.name === "Verdict")
      .map((e) => [String(e.args.id), e]),
  );
  // Intake v2 clears a plea with no verdict at once; the Gate records why.
  const failures = new Map(
    events
      .filter((e) => e.name === "PleaFailed")
      .map((e) => [String(e.args.id), e]),
  );
  const records = new Set(
    events
      .filter((e) => e.name === "Recorded")
      .map((e) => String(e.args.pleaId)),
  );
  const pleas: Plea[] = [];
  for (let offset = 0; offset < submissions.length; offset += 35) {
    pleas.push(
      ...(await Promise.all(
        submissions.slice(offset, offset + 35).map(async (e) => {
          const p = await r<
            Omit<Plea, "id" | "tx" | "completed" | "recorded" | "failed">
          >("CabalGate", "getPlea", [e.args.id]);
          const v = verdicts.get(String(e.args.id));
          const f = failures.get(String(e.args.id));
          return {
            ...p,
            id: e.args.id,
            tx: e.tx,
            completed: !!f,
            recorded: records.has(String(e.args.id)),
            verdictTx: v?.tx,
            oracleId: v?.args.oracleRequestId,
            failed: f
              ? {
                  status: Number(f.args.status),
                  reason: failureReason(f.args.reason),
                  agreed: Number(f.args.agreed),
                  answered: Number(f.args.answered),
                  tx: f.tx,
                }
              : undefined,
          };
        }),
      )),
    );
  }
  const [seasonFees, top, topPleas, closeBounds, halls, nfts] =
    await Promise.all([
      r("Seasons", "seasonFees", [season]),
      r<Entry[]>("Seasons", "topOf", [season]),
      r<PleaEntry[]>("Seasons", "topPleasOf", [season]),
      r<Snapshot["closeBounds"]>("Seasons", "seasonBounds", [nextToClose]),
      Promise.all(
        events
          .filter((e) => e.name === "SeasonClosedOut")
          .map(async (e): Promise<Hall> => {
            const bonusPaid = events.filter(
              (p) => p.name === "BonusPaid" && p.args.season === e.args.season,
            );
            const burnedEvents = events.filter(
              (p) =>
                p.name === "BonusBurned" &&
                p.args.season === e.args.season &&
                p.tx === e.tx,
            );
            return {
              season: e.args.season,
              pot: e.args.pot,
              paid: e.args.paid,
              top: await r<Entry[]>("Seasons", "topOf", [e.args.season]),
              payouts: events.filter(
                (p) =>
                  p.name === "PrizePaid" && p.args.season === e.args.season,
              ),
              bonusPaid,
              bonusBurned: burnedEvents.reduce(
                (n, b) => n + BigInt(b.args.amount),
                0n,
              ),
              bonusTotal:
                e.args.season < c.BONUS_SEASONS ? c.BONUS_PER_SEASON : 0n,
            };
          }),
      ),
      Promise.all(
        events
          .filter((e) => e.name === "LaureateMinted")
          .map(async (e) => {
            const [uri, owner] = await Promise.all([
              r<string>("Laureates", "tokenURI", [e.args.tokenId]),
              r<Address>("Laureates", "ownerOf", [e.args.tokenId]),
            ]);
            const metadata = JSON.parse(
              new TextDecoder().decode(
                Uint8Array.from(atob(uri.split(",")[1]), (c) =>
                  c.charCodeAt(0),
                ),
              ),
            );
            return {
              id: e.args.tokenId,
              owner,
              pleaId: e.args.pleaId,
              season: e.args.season,
              rank: e.args.rank,
              name: metadata.name,
              image:
                typeof metadata.image === "string" &&
                metadata.image.startsWith("data:image/svg+xml;base64,")
                  ? metadata.image
                  : "",
            } as Nft;
          }),
      ),
    ]);
  const wallets = [
    ...new Set([
      ...pleas.map((p) => p.seller),
      ...top.map((t) => t.wallet),
      ...halls.flatMap((h) => h.top.map((t) => t.wallet)),
      ...nfts.map((n) => n.owner),
    ]),
  ].filter((a) => !/^0x0+$/.test(a));
  const names = Object.fromEntries(
    await Promise.all(
      wallets.map(async (a) => [
        a.toLowerCase(),
        await r<string>("Laureates", "nameOf", [a]),
      ]),
    ),
  );
  return {
    constants: c,
    block: block.number,
    timestamp: block.timestamp,
    loadedAt: Date.now(),
    alive,
    startedAt,
    lastVerdictAt,
    diedAt,
    season,
    endsAt,
    seasonPot: seasonFees + rollover,
    totalPot,
    rollover,
    nextToClose,
    closeBounds,
    finished,
    price,
    supply,
    burned: c.TOTAL_SUPPLY - supply,
    market,
    wall,
    retained,
    rebalance,
    launchExtra,
    pleaIsZero,
    bonusBurned,
    bonusHeld,
    poolKey,
    pleas: pleas.reverse(),
    events,
    names,
    top,
    topPleas,
    halls: halls.reverse(),
    nfts: nfts.reverse(),
  };
}
/// Cashback earned: the Stacker's Stacked(project = the hook, trader = this wallet) events,
/// summed in IMD, from the launch block.
export async function loadCashback(account: Address, head: bigint) {
  const logs: { args: { project?: Address; trader?: Address; imd?: bigint } }[] =
    [];
  for (let start = launchBlock; start <= head; start += 2000n)
    logs.push(
      ...(await bisect(
        start,
        start + 1999n < head ? start + 1999n : head,
        (fromBlock, toBlock) =>
          client.getLogs({
            address: addresses.Stacker,
            event: stackerAbi[0],
            args: { project: addresses.PleaHook, trader: account },
            fromBlock,
            toBlock,
          }),
      )),
    );
  let total = 0n,
    count = 0;
  for (const log of logs)
    if (
      eq(log.args.project, addresses.PleaHook) &&
      eq(log.args.trader, account) &&
      log.args.imd !== undefined
    ) {
      total += log.args.imd;
      count++;
    }
  return { total, count };
}
export async function loadWallet(
  account: Address,
  s: Snapshot,
): Promise<WalletData> {
  const [
    plea,
    imd,
    oracle,
    simd,
    cashback,
    basis,
    best,
    pending,
    executed,
    denied,
    lapsed,
    nextFaucetAt,
  ] = await Promise.all([
    read("PLEA", "balanceOf", [account]),
    read("TestIMD", "balanceOf", [account]),
    read("OracleIMD", "balanceOf", [account]),
    read("TestSIMD", "balanceOf", [account]),
    loadCashback(account, s.block),
    read<WalletData["basis"]>("PleaHook", "basisOf", [account]),
    read<WalletData["best"]>("Seasons", "bestOf", [s.season, account]),
    read("CabalGate", "pendingOf", [account]),
    read("CabalGate", "lastExecutedAt", [account]),
    read("CabalGate", "lastDeniedAt", [account]),
    read("CabalGate", "lastLapsedAt", [account]),
    read("TestIMD", "nextFaucetAt", [account]),
  ]);
  const last = [
    executed,
    denied,
    lapsed,
    ...s.pleas
      .filter(
        (p) =>
          eq(p.seller, account) &&
          p.status === 2 &&
          s.timestamp > p.verdictAt + s.constants.EXECUTE_WINDOW,
      )
      .map((p) => p.verdictAt),
  ].reduce((a, b) => (a > b ? a : b), 0n);
  return {
    plea,
    imd,
    oracle,
    simd,
    cashback: cashback.total,
    cashbackCount: cashback.count,
    basis,
    best,
    pending,
    nextFaucetAt,
    cooldownUntil: last ? last + s.constants.COOLDOWN : 0n,
  };
}
