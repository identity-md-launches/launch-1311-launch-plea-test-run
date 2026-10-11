import { useEffect, useState } from "react";
import { keccak256, toHex, type Address } from "viem";
import { useApp } from "./context";
import { addresses, addressLink, read, txLink } from "./contracts";
import {
  External,
  Empty,
  Name,
  NFTGallery,
  Notice,
  PleaGrid,
  TxButton,
  WalletHint,
} from "./components";
import {
  approved,
  bonusOf,
  compact,
  duration,
  eq,
  fmt,
  fmtSimd,
  pleaState,
  shareOf,
  shares,
  standings,
  validateName,
  when,
  type Entry,
} from "./domain";
import { accountUrl, Position } from "./Trade";
import type { Hall } from "./data";
import { explainError } from "./errors";
export const priceOf = (price: bigint) => (price * 10n ** 18n) / 2n ** 96n;
export function Overview() {
  const { data, now } = useApp();
  const c = data?.constants;
  const dead =
    data && data.startedAt > 0n && now >= data.lastVerdictAt + c!.DEADMAN;
  const bonus = c ? compact(c.BONUS_PER_SEASON) : "5M";
  return (
    <>
      <section className="intro-grid">
        <div className="intro-title">
          <h1>Make your case.</h1>
          <p className="lead">Buy freely. Persuade the Cabal to sell.</p>
          <div className="actions">
            <a className="button primary" href="#/buy">
              Buy PLEA
            </a>
            <a className="button" href={dead ? "#/buy/sell" : "#/plead"}>
              {dead ? "Sell PLEA" : "Plead to sell"}
            </a>
          </div>
        </div>
        <div className="intro-copy">
          <p>
            Anyone can buy PLEA. To sell while the Cabal lives, you write a
            plea, and a panel of {c ? String(c.PANEL_SIZE) : "30"} oracle judges
            decides whether your case is good enough.
          </p>
          <p>
            Approved pleas earn season points, IMD prizes and the PLEA bonus:
            each of the first {c ? String(c.BONUS_SEASONS) : "4"} seasons also
            pays {bonus} PLEA to its top ten. The finest cases become Laureates,
            preserved on chain.
          </p>
          <p>
            If the Cabal goes {c ? Number(c.DEADMAN) / 3600 : "33"} hours
            without a verdict, it dies. PLEA then trades freely, forever.
          </p>
        </div>
      </section>
      <dl className="live-strip">
        <div>
          <dt>Price · IMD</dt>
          <dd>{data ? fmt(priceOf(data.price), 8) : "—"}</dd>
        </div>
        <div>
          <dt>PLEA burned</dt>
          <dd>{compact(data?.burned)}</dd>
        </div>
        <div>
          <dt>Pleas judged</dt>
          <dd>
            {data ? data.pleas.filter((p) => p.verdictAt > 0n).length : "—"}
          </dd>
        </div>
        <div>
          <dt>Season prize pot</dt>
          <dd>
            {fmt(data?.seasonPot, 4)} IMD
            {data && bonusOf(data.season, data.constants) > 0n && (
              <span className="dd-note">
                + {compact(bonusOf(data.season, data.constants))} PLEA
              </span>
            )}
          </dd>
        </div>
      </dl>
      <section className="section-block">
        <div className="section-heading">
          <div>
            <h2>The latest verdicts</h2>
            <p className="muted">Every case is public. Every word matters.</p>
          </div>
          <a className="text-link" href="#/wall">
            Read the Wall
          </a>
        </div>
        {data ? (
          <PleaGrid
            pleas={data.pleas
              .filter((p) => p.verdictAt > 0n)
              .sort((a, b) => (a.verdictAt > b.verdictAt ? -1 : 1))
              .slice(0, 6)}
            empty="The court has yet to speak"
          />
        ) : (
          <div className="loading-lines" role="status">
            Reading the court’s verdicts from Sepolia…
          </div>
        )}
      </section>
    </>
  );
}
const filters = [
  "All",
  "Approved",
  "Denied",
  "Pending",
  "No verdict",
  "Appeals",
  "Laureates",
];
export function Wall() {
  const { data, now } = useApp();
  const [filter, setFilter] = useState("All");
  const pleas =
    data?.pleas.filter((p) => {
      if (filter === "All") return true;
      if (filter === "Approved") return approved(p);
      if (filter === "Denied") return p.status === 3;
      if (filter === "Appeals") return p.isAppeal;
      if (filter === "Laureates")
        return data.nfts.some((n) => n.pleaId === p.id);
      const state = pleaState(
        p,
        now,
        data.constants.PENDING_EXPIRY,
        data.constants.EXECUTE_WINDOW,
      );
      return filter === "No verdict"
        ? state === "No verdict" || state === "Expired"
        : state === filter;
    }) ?? [];
  return (
    <>
      <div className="page-heading">
        <h1>The Wall</h1>
        <p>A ledger of persuasion. The newest pleas appear first.</p>
      </div>
      <div className="filters" aria-label="Filter pleas">
        {filters.map((f) => (
          <button
            key={f}
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>
      <p className="result-count small muted" role="status">
        {data
          ? `${pleas.length} ${pleas.length === 1 ? "plea" : "pleas"} · ${filter.toLowerCase()}`
          : "Reading the Gate’s events…"}
      </p>
      {pleas.length ? (
        <PleaGrid pleas={pleas} />
      ) : (
        <Empty
          title={
            data
              ? `No ${filter === "All" ? "" : filter.toLowerCase() + " "}pleas yet`
              : "Loading pleas…"
          }
        >
          {" "}
          {data
            ? "The court’s record will appear here."
            : "Fetching the event history from the launch block."}{" "}
          {filter !== "All" && (
            <button className="text-button" onClick={() => setFilter("All")}>
              Show all pleas
            </button>
          )}
        </Empty>
      )}
    </>
  );
}
function Leaderboard({
  entries,
  pot,
  bonus,
  closed = false,
  payouts = [],
  bonusPaid = [],
}: {
  entries: Entry[];
  pot: bigint;
  bonus: bigint;
  closed?: boolean;
  payouts?: { args: Record<string, any> }[];
  bonusPaid?: { args: Record<string, any> }[];
}) {
  const { data, account } = useApp();
  const paidTo = (list: { args: Record<string, any> }[], wallet?: string) =>
    list.find((p) => eq(p.args.wallet, wallet))?.args.amount ?? 0n;
  return (
    <div className="leaderboard">
      <table>
        <caption className="sr-only">
          {closed
            ? "Closed season winners and actual payouts"
            : "Top ten wallets and projected season prizes"}
        </caption>
        <thead>
          <tr>
            <th scope="col">Rank / wallet</th>
            <th scope="col">Points</th>
            <th scope="col" className="share-column">
              Share
            </th>
            <th scope="col">IMD {closed ? "paid" : "prize"}</th>
            {bonus > 0n && <th scope="col">PLEA {closed ? "paid" : "bonus"}</th>}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 10 }, (_, i) => {
            const entry = entries[i],
              occupied = entry && !/^0x0+$/.test(entry.wallet),
              qualified =
                occupied && entry.points >= Number(data!.constants.MIN_POINTS),
              payout = closed
                ? paidTo(payouts, entry?.wallet)
                : qualified
                  ? shareOf(pot, i)
                  : 0n,
              plea = closed
                ? paidTo(bonusPaid, entry?.wallet)
                : qualified
                  ? shareOf(bonus, i)
                  : 0n;
            return (
              <tr
                key={i}
                className={eq(entry?.wallet, account) ? "your-row" : ""}
              >
                <th scope="row">
                  <span className="rank">{i + 1}</span>
                  {occupied ? (
                    <Name address={entry.wallet} />
                  ) : (
                    <span className="muted">Open place</span>
                  )}
                  <span className="table-note share-note">{shares[i]}% share</span>
                </th>
                <td>{occupied ? entry.points : "—"}</td>
                <td className="share-column">{shares[i]}%</td>
                <td>
                  {fmt(payout, 5)}
                  {occupied && !qualified && (
                    <span className="table-note">
                      {closed ? "Rolled over" : "Rolls over"}
                    </span>
                  )}
                </td>
                {bonus > 0n && (
                  <td>
                    {fmt(plea, 0)}
                    {occupied && !qualified && (
                      <span className="table-note">
                        {closed ? "Burned" : "Burns"}
                      </span>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
function HallSeason({ h }: { h: Hall }) {
  return (
    <details className="hall-season" open>
      <summary>
        Season {String(h.season + 1n)} · {fmt(h.paid, 5)} IMD paid
        {h.bonusTotal > 0n
          ? ` · ${fmt(h.bonusTotal - h.bonusBurned, 0)} PLEA paid`
          : ""}
      </summary>
      <p>
        Prize pot {fmt(h.pot, 5)} IMD. {fmt(h.pot - h.paid, 5)} IMD rolled
        over.
        {h.bonusTotal > 0n &&
          ` PLEA bonus ${fmt(h.bonusTotal, 0)}: ${fmt(h.bonusTotal - h.bonusBurned, 0)} paid, ${fmt(h.bonusBurned, 0)} burned.`}
      </p>
      <Leaderboard
        entries={h.top}
        pot={h.pot}
        bonus={h.bonusTotal}
        closed
        payouts={h.payouts}
        bonusPaid={h.bonusPaid}
      />
      {(h.bonusPaid.length > 0 || h.bonusBurned > 0n) && (
        <ul className="event-list">
          {h.bonusPaid.map((e) => (
            <li key={`${e.tx}-${e.index}`}>
              BonusPaid · rank {String(e.args.rank)} ·{" "}
              <Name address={e.args.wallet} /> · {fmt(e.args.amount, 0)} PLEA ·{" "}
              <External href={txLink(e.tx)}>Transaction</External>
            </li>
          ))}
          {h.bonusBurned > 0n && (
            <li>BonusBurned · {fmt(h.bonusBurned, 0)} PLEA</li>
          )}
        </ul>
      )}
    </details>
  );
}
export function Seasons() {
  const { data, wallet, account, now } = useApp();
  if (!data)
    return (
      <>
        <div className="page-heading">
          <h1>Words worth keeping.</h1>
          <p>Reading the season ledger…</p>
        </div>
      </>
    );
  const c = data.constants,
    alive = now < data.lastVerdictAt + c.DEADMAN,
    bonus = bonusOf(data.season, c);
  const ready =
    data.closeBounds[0] && now >= data.closeBounds[2] + c.CLOSE_GRACE;
  const unrecorded = data.pleas
    .filter(
      (p) =>
        approved(p) &&
        !p.recorded &&
        (p.verdictAt - data.startedAt) / c.SEASON === data.nextToClose,
    )
    .map((p) => p.id);
  const ranking = standings(data.pleas, data.startedAt, c.SEASON, data.season),
    rank = ranking.findIndex((e) => eq(e.wallet, account)) + 1;
  const best = wallet?.best.filter((s) => s > 0) ?? [];
  return (
    <>
      <div className="page-heading">
        <h1>Words worth keeping.</h1>
        <p>
          Season {String(data.season + 1n)} ·{" "}
          {alive ? `${duration(data.endsAt - now)} left` : "The final season"} ·{" "}
          {fmt(data.seasonPot, 5)} IMD in prizes
          {bonus > 0n ? ` + ${fmt(bonus, 0)} PLEA bonus` : ""}
        </p>
      </div>
      <div className="section-heading">
        <div>
          <h2>The season’s top ten</h2>
          <p className="muted">
            Your three best scores count. Below {String(c.MIN_POINTS)} points
            the share rolls over (IMD) or is burned (PLEA).
          </p>
        </div>
      </div>
      {bonus > 0n && (
        <Notice>
          Seasons 1–{String(c.BONUS_SEASONS)} each pay {fmt(bonus, 0)} PLEA to
          the qualifying top ten with the same shares. Unpaid shares are burned
          at the close; after the Cabal dies the rest is burned. Supply split:
          88% pool, 2% season bonus, 10% distributor.
        </Notice>
      )}
      <Leaderboard entries={data.top} pot={data.seasonPot} bonus={bonus} />
      {account ? (
        <div className="personal-standing">
          <h3>Your standing</h3>
          <p>
            {rank
              ? `You’re #${rank} this season.`
              : "You have no recorded points this season."}{" "}
            Best three scores:{" "}
            {wallet ? (best.length ? best.join(" · ") : "none yet") : "Reading…"}
            .
          </p>
        </div>
      ) : (
        <WalletHint verb="see your rank and three best scores" />
      )}
      <section className="section-block">
        <h2>The five finest pleas</h2>
        <p className="muted">
          The season’s highest-scoring approved cases become Laureates.
        </p>
        <PleaGrid
          pleas={data.topPleas
            .filter((p) => p.pleaId > 0n)
            .map((p) => data.pleas.find((plea) => plea.id === p.pleaId)!)
            .filter(Boolean)}
          empty="A place in the record is open"
        />
      </section>
      <section className="season-close section-block">
        <h2>Bring a season to a close</h2>
        {data.closeBounds[0] ? (
          <>
            <p>
              Season {String(data.nextToClose + 1n)}{" "}
              {ready
                ? "is ready to close."
                : `can close in ${duration(data.closeBounds[2] + c.CLOSE_GRACE - now)}.`}{" "}
              Closing records {unrecorded.length} remaining approved{" "}
              {unrecorded.length === 1 ? "plea" : "pleas"}, pays eligible
              winners
              {bonusOf(data.nextToClose, c) > 0n
                ? `, pays or burns the ${fmt(bonusOf(data.nextToClose, c), 0)} PLEA bonus`
                : ""}{" "}
              and mints the Laureates.
            </p>
            <p className="small muted">
              Seasons close in order, after a {Number(c.CLOSE_GRACE) / 3600}
              -hour grace period.
            </p>
            <WalletHint verb="close the season" />
            <TxButton
              label={`Close season ${data.nextToClose + 1n}`}
              disabled={!ready}
              action={({ send }) =>
                send(
                  "Seasons",
                  "closeSeason",
                  [unrecorded],
                  false,
                  `Close season ${data.nextToClose + 1n}`,
                )
              }
            />
          </>
        ) : (
          <p>Every available season is closed.</p>
        )}
        {data.finished && (data.totalPot > 0n || data.bonusHeld > 0n) && (
          <>
            <p>
              {fmt(data.totalPot, 5)} IMD
              {data.bonusHeld > 0n
                ? ` and ${fmt(data.bonusHeld, 0)} unpaid bonus PLEA`
                : ""}{" "}
              remain after the last close. Sending the leftovers moves the IMD
              to the buy wall and burns the PLEA.
            </p>
            <WalletHint verb="send the leftovers" />
            <TxButton
              label="Send leftovers to the buy wall"
              action={({ send }) =>
                send(
                  "Seasons",
                  "flushToWall",
                  [],
                  false,
                  "Send leftovers to the buy wall",
                )
              }
            />
          </>
        )}
      </section>
      <section className="section-block">
        <h2>Hall of Fame</h2>
        <p className="muted">
          Closed seasons, paid prizes, the PLEA bonus and words preserved on
          chain. Bonus burned so far: {fmt(data.bonusBurned, 0)} PLEA.
        </p>
        {data.halls.length ? (
          data.halls.map((h) => <HallSeason key={String(h.season)} h={h} />)
        ) : (
          <Empty title="The Hall is waiting">
            Close an ended season after its grace period to settle prizes and
            mint the first Laureates.
          </Empty>
        )}
        <NFTGallery nfts={data.nfts} />
      </section>
    </>
  );
}
export function Profile() {
  const { data, account, wallet } = useApp();
  const [name, setName] = useState(""),
    [saved, setSaved] = useState(""),
    [availability, setAvailability] = useState<{
      name: string;
      available: boolean;
    }>(),
    [checking, setChecking] = useState(false),
    [problem, setProblem] = useState("");
  useEffect(() => {
    let current = true;
    setSaved("");
    setName("");
    if (account)
      void read<string>("Laureates", "nameOf", [account])
        .then((n) => {
          if (current) {
            setSaved(n);
            setName(n);
          }
        })
        .catch((e) => {
          if (current) setProblem(explainError(e));
        });
    return () => {
      current = false;
    };
  }, [account]);
  const localError = validateName(name);
  useEffect(() => {
    setAvailability(undefined);
    setProblem("");
    if (!account || !name || localError) return;
    let cancelled = false;
    setChecking(true);
    const timer = setTimeout(
      () =>
        void read<Address>("Laureates", "nameOwner", [keccak256(toHex(name))])
          .then((owner) => {
            if (!cancelled)
              setAvailability({
                name,
                available: /^0x0+$/.test(owner) || eq(owner, account),
              });
          })
          .catch((e) => {
            if (!cancelled) setProblem(explainError(e));
          })
          .finally(() => {
            if (!cancelled) setChecking(false);
          }),
      300,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
      setChecking(false);
    };
  }, [name, account, localError]);
  const mine = data?.pleas.filter((p) => eq(p.seller, account)) ?? [];
  const available = availability?.name === name && availability.available;
  const current = !!saved && name === saved;
  const keys = [
    ...new Set(
      mine
        .filter((p) => p.recorded)
        .map((p) => (p.verdictAt - data!.startedAt) / data!.constants.SEASON),
    ),
  ].sort((a, b) => (a > b ? -1 : 1));
  return (
    <>
      <div className="page-heading">
        <h1>Your name in the record.</h1>
        <p>A case, a reputation, a place in the court.</p>
      </div>
      <WalletHint verb="set a display name and see your profile" />
      <div className="two-column">
        <section>
          <h2>Display name</h2>
          <label htmlFor="display-name">Your public name</label>
          <input
            id="display-name"
            autoComplete="nickname"
            value={name}
            onChange={(e) => setName(e.target.value)}
            spellCheck={false}
            disabled={!account}
            aria-describedby="name-help name-state"
            aria-invalid={!!localError || availability?.available === false}
          />
          <p className="small muted" id="name-help">
            3–20 characters: a–z, 0–9 and _. Names are unique. Reserved: cabal,
            admin, imd, plea, owner.
          </p>
          <p
            id="name-state"
            className={
              localError || availability?.available === false
                ? "error-text"
                : "small"
            }
            role="status"
          >
            {localError ||
              (current
                ? "This is your current name."
                : checking
                  ? "Checking availability…"
                  : availability
                    ? available
                      ? "This name is available to you."
                      : "This name is taken. Choose another."
                    : "")}
          </p>
          {problem && <Notice error>{problem}</Notice>}
          <div className="actions">
            <TxButton
              label="Set display name"
              primary
              disabled={!name || !!localError || !available || current}
              action={async ({ send }) => {
                const hash = await send(
                  "Laureates",
                  "setName",
                  [name],
                  false,
                  "Set display name",
                );
                setSaved(name);
                return hash;
              }}
            />
            <TxButton
              label="Clear display name"
              disabled={!saved}
              action={async ({ send }) => {
                const hash = await send(
                  "Laureates",
                  "setName",
                  [""],
                  false,
                  "Clear display name",
                );
                setSaved("");
                setName("");
                return hash;
              }}
            />
          </div>
        </section>
        <aside className="side-notes">
          <h2>Your position and cashback</h2>
          <Position />
          <p className="small muted">
            Cashback is the IMD the hook has credited to you through the imd/acc
            Stacker; it is held as sIMD ({fmtSimd(wallet?.simd, 5)} in this
            wallet).
          </p>
          <External href={accountUrl}>View sIMD in imd/acc</External>
          <h2>Points by season</h2>
          {keys.length ? (
            <dl className="stats-list">
              {keys.map((key) => {
                const standing = standings(
                  data!.pleas,
                  data!.startedAt,
                  data!.constants.SEASON,
                  key,
                ).find((e) => eq(e.wallet, account));
                return (
                  <div key={String(key)}>
                    <dt>Season {String(key + 1n)}</dt>
                    <dd>{standing?.points ?? 0} points</dd>
                  </div>
                );
              })}
            </dl>
          ) : (
            <p className="muted">
              Recorded approvals will appear here. Each season counts your three
              best scores.
            </p>
          )}
        </aside>
      </div>
      <section className="section-block">
        <h2>Your Laureates</h2>
        <NFTGallery
          nfts={data?.nfts.filter((n) => eq(n.owner, account)) ?? []}
        />
      </section>
      <section className="section-block">
        <h2>Your pleas</h2>
        <PleaGrid
          pleas={mine}
          empty={
            account ? "Your case has yet to be heard" : "Your pleas live here"
          }
        />
      </section>
    </>
  );
}
export function Status() {
  const { data, now } = useApp();
  const alive =
    data &&
    data.startedAt > 0n &&
    now < data.lastVerdictAt + data.constants.DEADMAN;
  const lastVerdict = data?.pleas
    .filter((p) => p.verdictAt > 0n)
    .sort((a, b) => (a.verdictAt > b.verdictAt ? -1 : 1))[0];
  const metrics = data
    ? [
        [
          "Last verdict",
          lastVerdict
            ? `Plea ${lastVerdict.id} · ${approved(lastVerdict) ? "approved" : "denied"} · ${when(lastVerdict.verdictAt)}`
            : `None yet · clock set at ${when(data.lastVerdictAt)}`,
        ],
        ["Price", `${fmt(priceOf(data.price), 8)} IMD / PLEA`],
        ["Market cap", `${fmt((data.supply * data.price) / 2n ** 96n, 3)} IMD`],
        ["Current PLEA supply", fmt(data.supply, 0)],
        ["PLEA in market", fmt(data.market, 0)],
        ["Wall IMD", fmt(data.wall, 6)],
        ["Retained IMD", fmt(data.retained, 6)],
        ["PLEA burned", fmt(data.burned, 0)],
        ["Bonus PLEA burned", fmt(data.bonusBurned, 0)],
        ["Bonus PLEA held by Seasons", fmt(data.bonusHeld, 0)],
        ["Trading opened", when(data.startedAt)],
        ["Launch START", when(data.constants.START)],
        ["Last read", `Block ${data.block} · ${when(data.timestamp)}`],
      ]
    : [];
  return (
    <>
      <div className="page-heading">
        <h1>The state of the court.</h1>
        <p>
          {!data
            ? "Reading the live contracts…"
            : alive
              ? `Cabal alive · dies in ${duration(data.lastVerdictAt + data.constants.DEADMAN - now)} without a verdict`
              : "The Cabal is dead. PLEA trades freely forever."}
        </p>
      </div>
      <div className="two-column">
        <section>
          <h2>On the record</h2>
          <dl className="stats-list status-stats">
            {metrics.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
        <aside className="side-notes">
          <h2>A clock, not a vote.</h2>
          <p>
            The Cabal’s state is computed from the seed time and the last signed
            verdict. After {data ? Number(data.constants.DEADMAN) / 3600 : "…"}{" "}
            hours of silence, its authority ends permanently.
          </p>
          <h2>The buy wall</h2>
          <p>
            The hook burns PLEA and manages the market and IMD buy wall. Anyone
            can rebalance when there is work to do.
          </p>
          {data?.rebalance ? (
            <>
              <WalletHint verb="rebalance the pool" />
              <TxButton
                label="Rebalance"
                action={({ send }) =>
                  send("PleaHook", "rebalance", [], false, "Rebalance")
                }
              />
            </>
          ) : (
            <p className="muted">
              {data
                ? "The pool does not need rebalancing."
                : "Checking the pool…"}
            </p>
          )}
          <h2>Sepolia testnet</h2>
          <p>These contracts use test tokens. No mainnet assets are needed.</p>
        </aside>
      </div>
      <section className="section-block">
        <h2>Contract addresses</h2>
        <div className="address-list">
          {Object.entries(addresses).map(([name, address]) => (
            <div key={name}>
              <h3>{name}</h3>
              <External href={addressLink(address)}>
                <span className="address">{address}</span>
              </External>
            </div>
          ))}
        </div>
      </section>
      <details className="section-block">
        <summary>Read the live fees, caps and timings</summary>
        <dl className="stats-list constants-list">
          {data &&
            Object.entries(data.constants).map(([name, value]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{String(value)}</dd>
              </div>
            ))}
        </dl>
        <p className="small muted">
          Raw contract units: token amounts use 18 decimals; timings are
          seconds; BPS use a 10,000 denominator.
        </p>
      </details>
    </>
  );
}
