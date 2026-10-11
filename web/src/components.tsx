import { useState, useEffect, useRef, type ReactNode } from "react";
import {
  ArrowUpRight,
  CheckCircle,
  WarningCircle,
} from "@phosphor-icons/react";
import type { Hex } from "viem";
import { useApp, type TxSession } from "./context";
import { txLink, addressLink } from "./contracts";
import { explainError } from "./errors";
import { oracleIdOf } from "./oracle";
import {
  approved,
  canExpire,
  eq,
  failureText,
  fmt,
  short,
  when,
  duration,
  pleaState,
  toneOf,
  type Plea,
  type Nft,
} from "./domain";

export function External({
  href,
  children,
  className = "",
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a
      className={`external ${className}`}
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      {children}
      <ArrowUpRight size={14} weight="regular" aria-hidden="true" />
    </a>
  );
}
export function Notice({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <div
      className={`notice ${error ? "error" : ""}`}
      role={error ? "alert" : "status"}
    >
      {error && <WarningCircle size={20} aria-hidden="true" />}
      <div>{children}</div>
    </div>
  );
}
export function WalletHint({ verb }: { verb: string }) {
  const { account, walletError } = useApp();
  return walletError ? (
    <Notice error>{walletError}</Notice>
  ) : !account ? (
    <p className="muted wallet-hint">Connect in the top bar to {verb}.</p>
  ) : null;
}
export function TxButton({
  label,
  action,
  disabled = false,
  primary = false,
}: {
  label: string;
  action: (session: TxSession) => Promise<Hex>;
  disabled?: boolean;
  primary?: boolean;
}) {
  const { account, data, error, busy, run } = useApp();
  const [state, setState] = useState(""),
    [hash, setHash] = useState<Hex>(),
    [problem, setProblem] = useState(""),
    [working, setWorking] = useState(false);
  const click = async () => {
    setWorking(true);
    setProblem("");
    setHash(undefined);
    try {
      await run(action, (s, h) => {
        setState(s);
        if (h) setHash(h);
      });
    } catch (e) {
      setProblem(explainError(e));
      setState("");
    } finally {
      setWorking(false);
    }
  };
  return (
    <div className="tx-control">
      <button
        className={primary ? "button primary" : "button"}
        onClick={() => void click()}
        disabled={disabled || !account || !data || !!error || busy}
        aria-busy={working}
      >
        {working ? `${label}…` : label}
      </button>
      <div className="tx-feedback" aria-live="polite">
        {state && (
          <p className={state === "Confirmed" ? "success" : ""}>
            {state === "Confirmed" && (
              <CheckCircle size={16} aria-hidden="true" />
            )}
            {state}
            {hash && (
              <>
                {" "}
                · <External href={txLink(hash)}>View transaction</External>
              </>
            )}
          </p>
        )}
      </div>
      {problem && (
        <p className="error-text" role="alert">
          {problem}
          {hash && (
            <>
              {" "}
              <External href={txLink(hash)}>Transaction</External>
            </>
          )}
        </p>
      )}
    </div>
  );
}
export function Empty({
  title,
  children,
  link,
  label,
}: {
  title: string;
  children: ReactNode;
  link?: string;
  label?: string;
}) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      <p>{children}</p>
      {link && (
        <a className="text-link" href={link}>
          {label}
        </a>
      )}
    </div>
  );
}
export function FaucetButton() {
  const { data, wallet, now } = useApp();
  const waiting = !!wallet && now < wallet.nextFaucetAt;
  return (
    <>
      <TxButton
        label="Get tIMD"
        disabled={waiting}
        action={({ send }) => send("TestIMD", "faucet", [], false, "Get tIMD")}
      />
      <p className="small muted">
        {waiting
          ? `The faucet opens for you in ${duration(wallet.nextFaucetAt - now)}.`
          : data
            ? `${fmt(data.constants.FAUCET_AMOUNT, 0)} tIMD per visit, every ${duration(data.constants.FAUCET_COOLDOWN)}.`
            : "Reading the faucet allowance…"}
      </p>
    </>
  );
}
export function Name({ address }: { address: string }) {
  const { data } = useApp();
  return (
    <External href={addressLink(address)}>
      <bdi title={address}>
        {data?.names[address.toLowerCase()] || short(address)}
      </bdi>
    </External>
  );
}
/// The wax-seal stamp. One colour per state (data-tone), light and dark; the text names the
/// state so colour is never the only cue.
export function Stamp({
  label,
  animate = false,
  small = false,
}: {
  label: string;
  animate?: boolean;
  small?: boolean;
}) {
  return (
    <span
      className={`stamp ${small ? "small" : ""} ${animate ? "stamp-arrives" : ""}`}
      data-tone={toneOf(label)}
    >
      <span>{label}</span>
    </span>
  );
}
export function StateTag({ state }: { state: string }) {
  return (
    <span className="state-tag" data-tone={toneOf(state)}>
      <span className="state-dot" aria-hidden="true" />
      {state}
    </span>
  );
}
export function PleaCard({
  plea: p,
  detail = false,
}: {
  plea: Plea;
  detail?: boolean;
}) {
  const { data, now } = useApp();
  const c = data!.constants;
  const state = pleaState(p, now, c.PENDING_EXPIRY, c.EXECUTE_WINDOW);
  // The seal names the verdict: Approved stays on the seal through the sale window and after
  // it (Executed / Lapsed are shown as the state tag), Denied stays red, the rest follow the state.
  const verdict =
    p.status === 4
      ? "Executed"
      : approved(p)
        ? "Approved"
        : p.status === 3
          ? p.isAppeal
            ? "Upheld"
            : "Denied"
          : state;
  const prev = useRef(p.verdictAt),
    [arriving, setArriving] = useState(false);
  useEffect(() => {
    if (!prev.current && p.verdictAt) setArriving(true);
    prev.current = p.verdictAt;
  }, [p.verdictAt]);
  const winner = data!.nfts.find((n) => n.pleaId === p.id);
  const appeal = data!.pleas.find(
    (a) => a.originalId === p.id && a.status !== 6,
  );
  const parent = data!.pleas.find((a) => a.id === p.originalId);
  const outcome = (a: Plea) =>
    approved(a)
      ? "Overturned"
      : a.status === 3
        ? "Upheld"
        : pleaState(a, now, c.PENDING_EXPIRY, c.EXECUTE_WINDOW);
  return (
    <article
      className={`plea-card ${detail ? "plea-detail" : ""}`}
      aria-labelledby={`plea-${p.id}`}
    >
      <div className="card-top">
        <div>
          <a className="plea-id" href={`#/plea/${p.id}`} id={`plea-${p.id}`}>
            Plea {String(p.id).padStart(3, "0")}
            {p.isAppeal ? " · appeal" : ""}
          </a>
          <p className="card-by">
            By <Name address={p.seller} />
          </p>
        </div>
        <Stamp label={verdict} animate={arriving} />
      </div>
      <p className="plea-copy" dir="auto">
        “{p.text}”
      </p>
      <dl className="plea-facts">
        <div>
          <dt>Asking to sell</dt>
          <dd>{fmt(p.amount, 0)} PLEA</dd>
        </div>
        <div>
          <dt>Facts / need</dt>
          <dd>
            {p.factScore} / {p.need}
          </dd>
        </div>
        <div>
          <dt>Judges’ score</dt>
          <dd>
            {p.verdictAt
              ? `${p.score} / ${c.MAX_PLEA_SCORE}`
              : state === "No verdict" || state === "Expired"
                ? "No verdict"
                : "Awaiting verdict"}
          </dd>
        </div>
        <div>
          <dt>Season points</dt>
          <dd>
            {approved(p) ? `+${p.score}` : "—"}
            {p.recorded ? " · recorded" : ""}
          </dd>
        </div>
      </dl>
      <div className="card-status">
        <StateTag state={state} />
        {winner && (
          <a
            className="laureate-badge"
            href={`#/seasons/laureate/${winner.id}`}
          >
            Laureate · Season {String(winner.season + 1n)}
          </a>
        )}
      </div>
      {state === "Pending" && (
        <p className="small">
          Judging closes in {duration(p.submittedAt + c.PENDING_EXPIRY - now)}.
        </p>
      )}
      {state === "Approved" && (
        <p className="small">
          Execute within {duration(p.verdictAt + c.EXECUTE_WINDOW - now)}.
        </p>
      )}
      {state === "Lapsed" && (
        <p className="small">
          The approval lapsed. Cooldown ends {when(p.verdictAt + c.COOLDOWN)}.
        </p>
      )}
      {p.failed && (
        <p className="small failure-note">
          {failureText(p.failed)} {p.failed.agreed} of {p.failed.answered}{" "}
          answers agreed.{" "}
          <External href={txLink(p.failed.tx)}>Intake record</External>
        </p>
      )}
      {canExpire(p, now, c.PENDING_EXPIRY) && (
        <p className="small">
          The {Number(c.PENDING_EXPIRY) / 60}-minute window passed with the plea
          still pending. Anyone can clear it.
        </p>
      )}
      {state === "Expired" && !p.failed && (
        <p className="small">
          Cleared after the pending window without a verdict.
        </p>
      )}
      {p.isAppeal && parent && (
        <a className="appeal-pair" href={`#/plea/${parent.id}`}>
          Denied #{String(parent.id)} → <StateTag state={outcome(p)} /> #
          {String(p.id)}
        </a>
      )}
      {appeal && (
        <a className="appeal-pair" href={`#/plea/${appeal.id}`}>
          Denied #{String(p.id)} → <StateTag state={outcome(appeal)} /> #
          {String(appeal.id)}
        </a>
      )}
      <div className="card-bottom">
        <time dateTime={new Date(Number(p.submittedAt) * 1000).toISOString()}>
          {when(p.submittedAt)}
        </time>
        <External href={txLink(p.verdictTx || p.tx)}>
          {p.verdictTx ? "Verdict" : "Submission"}
        </External>
      </div>
    </article>
  );
}
export function PleaGrid({
  pleas,
  empty = "No pleas yet",
}: {
  pleas: Plea[];
  empty?: string;
}) {
  return pleas.length ? (
    <div className="plea-grid">
      {pleas.map((p) => (
        <PleaCard key={String(p.id)} plea={p} />
      ))}
    </div>
  ) : (
    <Empty title={empty} link="#/wall" label="View all pleas">
      The court’s public record appears here as pleas arrive.
    </Empty>
  );
}
export function NFTGallery({ nfts }: { nfts: Nft[] }) {
  return nfts.length ? (
    <div className="nft-grid">
      {nfts.map((n) => (
        <figure key={String(n.id)} id={`laureate-${n.id}`}>
          <a href={`#/plea/${n.pleaId}`}>
            <img
              src={n.image}
              alt={`${n.name}, Season ${n.season + 1n}, rank ${n.rank}, plea ${n.pleaId}. On-chain artwork.`}
              loading="eager"
              width="600"
              height="600"
            />
          </a>
          <figcaption>
            <Stamp label="Laureate" small />
            <span className="laureate-badge">Laureate #{String(n.id)}</span>
            <p>
              Season {String(n.season + 1n)} · rank {n.rank}
            </p>
            <Name address={n.owner} />
          </figcaption>
        </figure>
      ))}
    </div>
  ) : (
    <Empty title="The next Laureates are being written">
      The top five approved pleas of each closed season become on-chain
      artworks.
    </Empty>
  );
}
export function OracleDetails({ plea }: { plea: Plea }) {
  const [result, setResult] = useState<{
      reason: string;
      split: string;
      id?: string;
      notes: string[];
    }>(),
    [problem, setProblem] = useState(""),
    [attempt, setAttempt] = useState(0);
  const intakeUrl = `https://api.imd.fun/intake/11155111/${plea.tx}`;
  useEffect(() => {
    const abort = new AbortController();
    setResult(undefined);
    setProblem("");
    const get = async (url: string) => {
      const r = await fetch(url, { signal: abort.signal });
      if (!r.ok)
        throw Error(
          `Oracle details are unavailable (${r.status}). Open the source links or retry.`,
        );
      return r.json();
    };
    void (async () => {
      try {
        const id = await oracleIdOf(plea);
        if (abort.signal.aborted) return;
        if (!id) {
          setResult({
            reason: plea.failed
              ? failureText(plea.failed)
              : "The oracle has not published a completion yet.",
            split: plea.failed
              ? `${plea.failed.agreed} of ${plea.failed.answered} answers agreed (from the Gate’s PleaFailed record).`
              : "Judge split not available yet. Open the Intake record to check the request.",
            notes: [],
          });
          return;
        }
        if (!/^[a-zA-Z0-9-]+$/.test(id))
          throw Error(
            "The oracle returned an invalid request identifier. Open the Intake source to inspect it.",
          );
        const oracle = await get(`https://api.imd.fun/oracle/requests/${id}`);
        const counts: Record<string, number> = {};
        const notes: string[] = [];
        for (const member of oracle.members ?? []) {
          const value = member.ok
            ? String(member.answer?.answer ?? "No answer")
            : "Refused";
          counts[value] = (counts[value] ?? 0) + 1;
          if (member.reason) notes.push(String(member.reason));
          else if (member.answer?.notes)
            notes.push(String(member.answer.notes));
        }
        setResult({
          id,
          reason: String(
            oracle.failure || oracle.reason || oracle.error || oracle.status,
          ),
          split:
            Object.entries(counts)
              .sort((a, b) => Number(a[0]) - Number(b[0]))
              .map(
                ([score, count]) =>
                  `${count} judge${count === 1 ? "" : "s"}: ${/^\d+$/.test(score) ? `score ${score}` : score}`,
              )
              .join(" · ") || "No judge answers published yet.",
          notes: [...new Set(notes)],
        });
      } catch (e) {
        if (!abort.signal.aborted)
          setProblem(
            "Oracle details could not be loaded. Retry or open the Intake record below.",
          );
      }
    })();
    return () => abort.abort();
  }, [
    intakeUrl,
    plea.intakeId,
    plea.oracleId,
    plea.completed,
    plea.status,
    attempt,
  ]);
  return (
    <section className="oracle-details">
      <h2>The judges’ record</h2>
      <p className="small muted">
        Oracle details explain the panel’s decision. The Gate’s on-chain state
        above determines what you can do.
      </p>
      {plea.failed && (
        <p>
          No verdict: {failureText(plea.failed)} Split: {plea.failed.agreed} of{" "}
          {plea.failed.answered} answers agreed.
        </p>
      )}
      {!result && !problem && <p role="status">Loading the oracle record…</p>}
      {problem && (
        <Notice error>
          {problem}{" "}
          <button
            className="text-button"
            onClick={() => setAttempt((v) => v + 1)}
          >
            Retry oracle details
          </button>
        </Notice>
      )}
      {result && (
        <>
          <p>
            Request status: <strong>{result.reason}</strong>
          </p>
          <p>{result.split}</p>
          {result.notes.length > 0 && (
            <details>
              <summary>
                Read the judges’ reasons ({result.notes.length})
              </summary>
              <ol className="judges-notes">
                {result.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ol>
            </details>
          )}
        </>
      )}
      <div className="actions">
        <External href={intakeUrl}>Intake record</External>
        {result?.id && (
          <External href={`https://api.imd.fun/oracle/requests/${result.id}`}>
            Oracle request
          </External>
        )}
      </div>
    </section>
  );
}
