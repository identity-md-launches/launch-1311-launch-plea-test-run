# PLEA Sepolia test run 2 adaptation

## Scope and launch compatibility

The supplied `launch.json` is retained unchanged. The factory deploys, in order and in one zero-value transaction, `PLEA`, `CabalGate`, `Seasons`, `Laureates`, `PleaDistributor`, and `PleaLaunch`. Their constructors are nonpayable and take respectively 1, 7, 3, 1, 2, and 10 static arguments. There are no externally linked libraries. Constructors access only earlier application contracts: `Seasons` reads the gate's season length, and `PleaLaunch` reads PLEA's owner and registers the system. No live oracle, token, Stacker, or PoolManager is needed for the six-contract deployment rehearsal.

Ownership resolves to the supplied owner, `0x4b91078b2374c956a65f7af0999cae0a935e6821`, rather than the factory or transaction origin. All manifest arguments, fees, prize shares, timings, panel size 30, quorum minimum 17, 18,000-second seasons, 118,800-second dead-man, `START = 1792162800`, and credit gas 1,300,000 are retained. Build configuration and vendored dependencies are unchanged, including `[lint] lint_on_build = false`.

The four requested changes were already present in the imported source and are retained:

- `src/PLEA.sol` and `src/Seasons.sol`: the one-time mint splits the fixed billion-token supply 88% / 2% / 10% among hook, Seasons, and distributor. Seasons allocates 5,000,000 PLEA to each of seasons 0–3 using the existing top-ten shares and 60-point threshold, burns unpaid shares, and burns all remaining PLEA on the final `flushToWall`. There is no bonus withdrawal or approval function. `test/SeasonFunds.t.sol` covers allocation, eligibility, failed transfers, burns, the four-season limit, and early death.
- `src/PleaHook.sol`: the daily cap allowance is fixed at seed to `(seeded inventory - 900,000e18) / 25`, with elapsed-time accounting and a remainder. The cap follows inventory down; it is not an unconditional time-based burn. `test/Hook.t.sol`, `test/AuditRevision.t.sol`, and the trading invariants cover the rate and accounting in both currency orientations.
- `src/PleaHook.sol`: the wall placement guard immediately follows lower PLEA prices and moves toward higher prices at up to 400 ticks per day, with idle time capped at one day. The wall uses the safer of spot, reference tick, and guard. `test/Hook.t.sol` and `test/Orientation.t.sol` exercise pumps, falls, and wall placement in both orientations.
- `src/CabalGate.sol` and `src/interfaces/IPleaParts.sol`: requests use Intake v2 `requestWithFailure`; the full `onPleaFailure` function and `PleaFailed` event remain. Only the configured Intake may clear a request the gate created that is still pending. Failure does not transfer or burn tokens, refund a fee, issue a verdict, or extend the Cabal's life. `expire` remains the fallback. `test/Gate.t.sol` and `test/AuditRevision.t.sol` cover failures, authorization, request ownership, replay, appeals, expiry, events, and the callback gas stipend.

The manifest retains Intake v2 `0xa43e6f75ee006411f79ac1c84120606c2330de82` and imd/acc launch #1294 Stacker `0x0457276d7b036818b3eddc1a4a3fceda61e9314d`.

## Changes in this pass

- `src/CabalGate.sol`: fixed a reproduced signed-quorum validation defect. The imported callback accepted a signed result when `agreed >= 17` even if `agreed < a.quorum`. The pinned oracle definition requires the actual signed quorum to be reached as well as the consumer's minimum. Added only `a.agreed < a.quorum` to the existing rejection condition; all configured numbers, request bodies, and failure behavior remain unchanged.
- `test/GateAdversarial.t.sol`: added `testFuzz_signedQuorumMustBeReached`, covering signed quorums 18–30 with agreement one below quorum (still at least 17), for both approvals and denials. Before the fix it failed with “next call did not revert as expected” (fuzz seed `0xeb78312f2a8e53b001528a833a208d8e6d2760c8187f7bb32f3819291df48e2e`, counterexample arguments `[5781, false]`). It checks that rejection preserves pending state, replay state, and the Cabal clock, then that exactly meeting the signed quorum succeeds within the 200,000-gas callback stipend.
- `README.md`: corrected the imported deployment-gas understatement and identified the local rehearsal's measurement limits. Clarified the accepted owner allowlist exemption and the requirement to deploy all six contracts atomically. These are documentation corrections for the reproduced imported findings.
- `src/PLEA.sol`: corrected `setLauncher`'s NatSpec to disclose its same-deployment-block fallback. Its executable code, registration checks, and owner powers are unchanged.
- `ADAPTATION.md`: added the requested change rationale, disposition of each supplied audit finding, retained launch exceptions, and verification record.

Comparing the artifacts built immediately before and after the quorum fix confirms that both creation and runtime bytecode are identical for `PLEA`, `Seasons`, `Laureates`, `PleaDistributor`, `PleaLaunch`, and `PleaHook`. Only `CabalGate` changes (runtime grows from 20,028 to 20,075 bytes, still below 24,576).

## Imported audit findings

The central behavior of all four reports reproduces as described below. Three describe explicitly retained launch behavior rather than unauthorized access in the required atomic deployment. The fourth report's literal hook mask does not reproduce: the code requires `0x28CC`, not the reported `0x2ACC`.

1. **Gas documentation — `9ebcf1ccd8ebfd76bc87ad4540cbef0f664b0e27dec12ac3bb1c0bab095ca400`.** Before any executable-source change, `forge test --match-path test/LaunchManifest.t.sol -vv` reported 17,190,214 gas and a margin of −412,998 against 16,777,216, exactly reproducing the report. The README's “about 21k” statement was incorrect and is corrected. The manifest test still reports the margin without asserting the mainnet cap, per the Sepolia brief. Its measured region includes copying the test's stored creation codes into the factory call and excludes transaction intrinsic/calldata gas, so it is not an on-chain receipt or a guarantee of a final transaction's gas. The deployment service must simulate its actual transaction on the target chain. No transaction was broadcast to test public-node admission.
2. **Permanent allowlist — `3094c361c858945196064f06de7544b8497ec5827d0a8d4ab37aa98b8f4a314c`.** `TokenTest.test_walletsCannotSendWhileTheCabalWatches` and `test_distributorAndAllowlistMaySend` exercise an ordinary holder's transfer restriction, an unauthorized allowlist call, and the owner's successful exemption followed by a transfer. An exempt sender can bypass this hook through another venue; direct transfers to this PoolManager or gate still have their separate checks. This owner power is explicitly accepted, so it remains and the README now discloses it.
3. **Deployment-block registration window — `9a2184dc0a6a9b041ff7e3306be42b1268be3c5abdb3f644440e7d20404cb748`.** `RehearsalManifestTest.test_separateTransactionsLeaveTheAcceptedDeploymentBlockWindow` registers an attacker between deployment calls and makes the legitimate `PleaLaunch` constructor revert `AlreadySet`. The later-block rejection and legitimate rehearsal fallback also pass. The brief explicitly requires accepting either the transient deployment flag or deployment block, so both checks remain. `AtomicManifestTest` rehearses the required uninterrupted six-contract factory call. `script/Deploy.s.sol` is only a local simulation helper; its individual broadcast transactions are unsuitable for this public launch.
4. **Explicit launch exceptions — `e3aaf7b610329f3e6b83590bd5f04043145379d905f9478918d02b2c309c53b1`.** `PostLaunchHookTest.test_committedHookDeploysLaterAndMintsOnlyTheFixedSplit` confirms zero supply after the six-contract transaction and exactly the fixed split after permissionless CREATE2 deployment of the committed hook code. The imported `PleaLaunch.FLAGS` expression evaluates to `0x28CC`, matching `PleaHook.getHookPermissions`; the audit's `0x2ACC` adds a before-remove-liquidity bit that this hook does not enable and would be rejected. The existing salt miner correctly uses `FLAGS`, so no code change is needed. A second hook deployment is rejected; `TokenTest.test_launcherAndInitAreOneShot` covers duplicate initialization. These steps and the Cabal's temporary transfer restrictions are requested behavior. The distributor's owner-set, one-time Merkle root also remains; claims cannot proceed until the owner sets it, and there is no sweep. The manifest runtime scanner checks all six deployed applications for the forbidden escape opcodes.

`PleaHook` is still absent from the six-entry manifest. Its salt is mined off chain against `PleaLaunch.hookInitCodeHash`; `deployHook` and `seed` remain the explicit post-launch steps. The owner may seed before `START`, and anyone may seed at or after it. The application's fixed oracle configuration and existing ECDSA-first/ERC-1271 signature compatibility are retained rather than adding new administrative powers from the generic examples.

## Verification

The pinned launch probe, security reference, and oracle consumer reference were read. Review and execution used Foundry 1.8.3, Solidity 0.8.26, and the project's unmodified configuration and dependencies.

| Check | Result |
| --- | --- |
| Imported baseline `forge test` | 255 passed, 0 failed, 1 optional fork suite skipped |
| New signed-quorum regression against imported code | Failed as expected before the fix; counterexample recorded above |
| Fixed signed-quorum regression | Passed all 256 fuzz runs, including quorum equality and the 200,000-gas delivery limit |
| Final `forge build` | Passed |
| Final `forge test -vv` | 256 passed, 0 failed, 1 skipped across 29 suites; includes fuzzing and stateful invariants |
| `forge test --isolate --match-path 'test/Launch*.t.sol' -vv` | All 10 tests passed |
| Supplied `Contracts.protected.t.sol`, copied unchanged into scratch for execution | Passed with the manifest bytecode/arguments, supplied owner, Sepolia chain ID, and a local test factory; all six constructors and runtime checks passed |
| Bytecode comparison | Only CabalGate creation/runtime bytecode changed; the other five launch contracts and PleaHook are identical |

The final default-profile manifest rehearsal reports **17,204,975 gas**, with a **−427,759** margin to 16,777,216. Transaction isolation reports the same figure. The increase from the imported measurement is 14,761 gas. The full failure function and its event were retained; no attempt was made to meet a mainnet gas ceiling by removing requested behavior.

Verification was local. The optional `ForkTestnetTest` suite skipped because `SEPOLIA_RPC_URL` was unset; live external-service behavior and public-node transaction admission were not rechecked. No Slither or Mythril run, key access, or on-chain broadcast was performed. Salt mining, hook deployment, seeding, and the owner's Merkle-root setting remain the existing deployment handoff's post-launch actions.
