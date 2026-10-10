# PLEA

**A sell-gated meme token on Uniswap v4.** Anyone can buy. To sell, you write a plea, and **the Cabal** decides. The Cabal is a panel of 30 IdentityMD oracle judges that scores each plea from 0 to 45. While the Cabal lives, approved pleas also compete in **seasons** for IMD prizes and Laureate NFTs. If the Cabal goes 33 hours without a verdict, it dies, and PLEA trades freely forever.

Launched through the IMD swarm straight from this repository (`launch.open` with `repoUrl` + `baseCommit`). It builds on PLEA v2 (IMD launch #1148) and the v4 fixes.

---

## Contents

- [At a glance](#at-a-glance)
- [How it works](#how-it-works)
  - [Buying](#buying)
  - [Pleading to sell](#pleading-to-sell)
  - [The fact score](#the-fact-score)
  - [The dead-man](#the-dead-man)
  - [Seasons](#seasons)
- [Fees](#fees)
- [Contracts](#contracts)
- [Launch and lifecycle](#launch-and-lifecycle)
- [Build and test](#build-and-test)
- [Design notes](#design-notes)
- [Credits](#credits)

---

## At a glance

| | |
|---|---|
| Supply | 1,000,000,000 PLEA (90% pool liquidity, 10% Merkle distributor) |
| Pool | PLEA/IMD on Uniswap v4 with a fork of POOL4's CappedBurnHook: LP fee 0, the hook is the only LP, liquidity locked forever |
| Selling | Only through the Cabal's gate while it lives |
| Judges | 30-seat oracle panel, quorum 17, score 0–45 |
| Trade fee | 1.75%, paid inside the swap (0.5% back to the trader as staked IMD) |
| Seasons | 15 days each, top 10 paid, top 5 pleas minted as NFTs |
| End state | 33h with no verdict → the Cabal dies → free trading, no comeback |

---

## How it works

### Buying

Buying is open to everyone from the moment trading opens. PLEA bought while the Cabal lives is delivered as a plain ERC-20 to the buyer, and the hook records each buyer's cost basis and buy-weighted holding time for the fact score.

For the first **90 minutes** after trading opens, buys pay an extra launch fee that falls from 70% to 0% and are capped at **5M PLEA** each.

### Pleading to sell

While the Cabal lives, PLEA can leave a wallet only through `CabalGate`.

1. **Plead.** Ask to sell up to **2.5M PLEA** (and at most **35%** of your balance), with a plea of **1–280 bytes**, and pay the **0.5 IMD** oracle fee. The gate pays the IdentityMD Intake itself.
2. **Need.** The contract computes your fact score (0–55, below). Your **need** is `70 − fact score`. If the need is above 45, no plea can pass, so the gate refuses it (`CannotPass`) before you pay.
3. **Verdict.** The judges score the plea 0–45; the signed score comes back through the Intake's callback. **Score ≥ need** is an approval.
4. **Sell.** An approval opens a **7-minute** window to sell the whole amount through the gate in one swap (`executeSell(minOut)`).

| Outcome | What happens |
|---|---|
| Approved and sold | Sold; a **4-hour** cooldown before the next plea |
| Approved, not sold in 7 min | Lapsed; the score still counts for the season |
| Denied | **4-hour** cooldown, with **one appeal** inside it: same or smaller amount, 0.5 IMD oracle fee + 0.35 IMD to the buy wall |
| No verdict | Expires after **20 minutes**, or at once when the Intake reports the request finished without one (`expire(id)`, anyone) |

**Plea text rules:** well-formed UTF-8 only, with no control, zero-width, bidi, tag or variation-selector characters, and no `[PLEA]` / `[/PLEA]` markers. The judges are told that the plea is untrusted text, and that any manipulation scores 0.

### The fact score

Computed on chain at submit time (0–55). Prices come from the hook's hourly checkpoints, never the spot price.

| Fact | Points |
|---|---|
| Share of balance sold | ≤15%: 18 · ≤25%: 11 · more: 5 |
| Buy-weighted holding time | ≥7 days: 14 · ≥3 days: 9 · ≥1 day: 5 |
| Profit or loss on held PLEA | at a loss: 14 · gain ≤50%: 9 · gain ≤200%: 5 |
| 24h price trend | up >2%: 9 · flat (±2%) or no history: 5 · down: 0 |

### The dead-man

The Cabal is born when trading opens and lives until **33 hours** pass without a signed verdict (approved or denied). Then it is dead for good. No plea can be submitted, every transfer restriction ends, and a late callback cannot revive it. `cabalAlive()` is computed, never stored, so nobody has to trigger the death.

### Seasons

- Seasons of **15 days** run back to back from the moment trading opens. The last one ends when the Cabal dies.
- An approved plea earns its score as **points**. Each wallet's **best three** scores in a season count.
- Points are recorded by `Seasons.record(pleaId)` (anyone; the seller has every reason to), or by `closeSeason`.
- When a season ends, anyone calls `closeSeason(pleaIds)` after a **1-hour grace**:
  - the **top 10** wallets with at least **60 points** are paid **25 / 18 / 14 / 11 / 9 / 7 / 6 / 4 / 3 / 3 %** of the prize pot in IMD;
  - unpaid shares roll over to the next season;
  - the season's **five best pleas** are minted as **Laureate** NFTs to their authors, rendered fully on chain (JSON + SVG).
- Holders can set a display name (`Laureates.setName`, 3–20 characters `a-z 0-9 _`, unique).
- After the Cabal dies and its last season is closed, `flushToWall()` (anyone) sends what is left to the buy wall.

---

## Fees

Every trade pays **1.75%**, settled in the same swap. There are no claims to settle later.

| Share | Goes to |
|---|---|
| 0.50% | Cashback to the trader as staked IMD (sIMD), through imd/acc's Stacker |
| 0.50% | The owner |
| 0.25% | The season's prize pot (pool liquidity once the Cabal is dead) |
| 0.25% | Pool liquidity (the IMD buy wall) |
| 0.25% | Burned, taken from the PLEA side |

Beyond fees, the hook keeps the market supplied the way POOL4's CappedBurnHook does: PLEA above an inventory cap is trimmed and **burned**, and recovered IMD is redeployed as an IMD-only **buy wall** below the price (`rebalance()`, anyone).

---

## Contracts

| Contract | Role |
|---|---|
| `PLEA` | ERC-20, 1e9 supply. While the Cabal lives, PLEA leaves a wallet only through the gate. |
| `CabalGate` | Pleas, the Intake request and callback, appeals, gated sells and the dead-man. |
| `Seasons` | Points, leaderboard, `closeSeason` payouts, the final flush to the buy wall. |
| `Laureates` | ERC-721 for each season's top 5 pleas; display names. |
| `PleaHook` | The only liquidity provider (fork of POOL4's CappedBurnHook, IMD side): fees, cap and trim burns, buy wall, price checkpoints. Deployed after launch. |
| `PleaLaunch` | Registers the contracts at launch and commits to the hook's init code; `deployHook` and `seed` afterwards. |
| `PleaDistributor` | Merkle claims for the 10% swarm share. |
| `OracleAttestation` | EIP-712 verification of the IdentityMD oracle's signed answer. |

---

## Launch and lifecycle

`launch.json` lists the six launch contracts, deployed in order in one transaction:

```
PLEA → CabalGate → Seasons → Laureates → PleaDistributor → PleaLaunch
```

Then:

1. **Deploy the hook.** `script/MineSalt.s.sol` mines a CREATE2 salt whose address carries the hook's flag bits and calls `PleaLaunch.deployHook(salt, initCode)`. The init code is committed at launch, so the result is fixed whoever calls it. PLEA then mints 90% to the hook and 10% to the distributor.

   ```
   LAUNCH=… POOL_MANAGER=… IMD=… STACKER=… SEASONS=… CREDIT_GAS=… \
   forge script script/MineSalt.s.sol --rpc-url $RPC --private-key $KEY --broadcast
   ```

2. **Open trading.** `PleaLaunch.seed()` creates the pool at a 5,700 IMD market cap and starts the Cabal. The owner may call it any time, and anyone may call it once `START` has passed.

**Sepolia settings** (`launch.json`):

| Setting | Value |
|---|---|
| Season | 5 hours (fast clock for testing) |
| Dead-man | 33 hours (real) |
| Plea timings | real (20 min, 7 min, 4 h) |
| `START` | 1791817200 (Mon 2026-10-12 15:00 UTC) |
| Cashback credit gas | 1,300,000 |

The season length and the dead-man are constructor values so a testnet can run a fast clock. On Ethereum mainnet the gate refuses anything below 15 days and 33 hours.

---

## Build and test

Foundry 1.8.3:

```
forge build
forge test
forge test --isolate --match-path test/Launch.t.sol   # each call as its own transaction
```

`foundry.toml` turns off forge's lint-on-build (`[lint] lint_on_build = false`). With it on, the linter runs out of memory on `PleaHook`.

---

## Design notes

- **The oracle callback is kept small.** Mainnet gives it 200k gas, so it only stores the signed score. Points are recorded separately (`record`, or `closeSeason` with a list of plea ids).
- **Cashback can't be skipped by a low gas limit.** A swap must reach the hook with the credit gas plus a 1M reserve, or it reverts. A wallet's gas estimate therefore always includes the sIMD credit, and only a credit that itself reverts falls back to plain IMD.
- **Signatures:** a plain ECDSA signature is accepted first, then ERC-1271, so an oracle key with an EIP-7702 delegation still verifies.
- **The very first buy** after trading opens may find no IMD in the PoolManager yet. That one trade's cashback, owner and prize shares then go to pool liquidity instead of reverting.

---

## Credits

- **TokenWorks** and their CabalCoin (2025), the original "plead to the Cabal to sell" token. PLEA is inspired by it. Thank you for the idea.
- **POOL4**: `PleaHook` is a fork of POOL4's CappedBurnHook (Ethereum `0xc6c965bd164c483e87d0b550671798e9a3602840`), converted to the IMD side: IMD instead of ETH as the quote asset, trims burn 100%, and recovered IMD becomes an IMD-only buy wall.
