// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Fixture} from "./utils/Fixture.sol";
import {PleaHook} from "../src/PleaHook.sol";
import {BuyRouter} from "./utils/Mocks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";

contract HookTest is Fixture {
    function test_everyFeeIsPaidInTheSameSwap() public {
        buy(bob, 50e18); // IMD in the pool
        uint256 ownerBefore = imd.balanceOf(OWNER);
        uint256 prizeBefore = imd.balanceOf(address(seasons));
        uint256 claimsBefore = hook.retainClaims();
        uint256 supplyBefore = plea.totalSupply();
        uint256 amt = 100e18;
        uint256 fill = amt - amt * 150 / 10_150;
        buy(alice, 100e18);
        uint256 cashback = fill * 50 / 10_000;
        assertApproxEqAbs(imd.balanceOf(OWNER) - ownerBefore, cashback, 1);
        assertApproxEqAbs(imd.balanceOf(address(seasons)) - prizeBefore, fill * 25 / 10_000, 1);
        assertApproxEqAbs(hook.retainClaims() - claimsBefore, fill * 25 / 10_000, 2);
        assertApproxEqAbs(simd.byProject(alice, address(hook)), cashback, 1); // stacked as sIMD
        assertEq(imd.balanceOf(address(hook)), 0); // nothing parked
        assertLt(plea.totalSupply(), supplyBefore); // 0.25% burned
        (uint256 spent, uint256 held, uint256 t) = hook.basisOf(alice);
        assertEq(spent, 100e18);
        assertEq(held, plea.balanceOf(alice));
        assertEq(t, vm.getBlockTimestamp());
    }

    function test_firstBuyWithAnEmptyPoolSendsPayoutsToLiquidity() public {
        // Fresh fixture state: no IMD has ever entered the PoolManager.
        assertEq(imd.balanceOf(address(pm)), 0);
        vm.expectEmit(false, false, false, false, address(hook));
        emit PleaHook.PayoutsToPool(0);
        buy(alice, 10e18);
        assertGt(plea.balanceOf(alice), 0);
        assertGt(hook.retainClaims(), 0);
    }

    function test_aBuyMustAffordTheCredit() public {
        buy(bob, 50e18);
        bytes memory call = abi.encodeCall(BuyRouter.buyExactIn, (10e18, abi.encode(alice)));
        vm.prank(alice);
        (bool ok,) = address(router).call{gas: 400_000}(call);
        assertFalse(ok); // NotEnoughGas: the estimate can never pick a no-cashback path
        vm.prank(alice);
        (ok,) = address(router).call{gas: 2_000_000}(call);
        assertTrue(ok);
        assertGt(simd.byProject(alice, address(hook)), 0);
    }

    function test_plainImdOnlyWhenTheCreditReverts() public {
        buy(bob, 50e18);
        simd.setPaused(true);
        uint256 before = imd.balanceOf(alice);
        buy(alice, 10e18);
        assertEq(simd.balanceOf(alice), 0);
        uint256 amt = 10e18;
        uint256 fill = amt - amt * 150 / 10_150;
        assertApproxEqAbs(imd.balanceOf(alice), before - 10e18 + fill * 50 / 10_000, 1);
    }

    function test_sellsAndExactOutputOnlyThroughTheGateWhileAlive() public {
        buy(alice, 50e18);
        vm.prank(alice);
        vm.expectRevert();
        router.sellExactIn(1e18, abi.encode(alice));
        vm.prank(alice);
        vm.expectRevert();
        router.buyExactOut(1e18, abi.encode(alice));
        vm.prank(alice);
        vm.expectRevert();
        router.buyExactIn(1e18, ""); // no recipient
    }

    function test_freeTradingWhenTheCabalSleeps() public {
        buy(alice, 50e18);
        skip(DEADMAN);
        vm.startPrank(alice);
        plea.approve(address(router), type(uint256).max);
        uint256 out = router.sellExactIn(plea.balanceOf(alice) / 2, abi.encode(alice));
        vm.stopPrank();
        assertGt(out, 0);
    }

    function test_rebalanceRedeemsClaimsIntoTheWall() public {
        for (uint256 i; i < 5; ++i) {
            buy(alice, 400e18);
            buy(bob, 400e18);
        }
        assertGt(hook.retainClaims(), 1e18);
        uint256 claims = hook.retainClaims();
        vm.prank(keeper);
        hook.rebalance();
        assertEq(hook.retainClaims(), 0);
        (,, uint128 liq) = hook.wall();
        assertGt(liq, 0);
        assertGt(hook.wallImd(), claims / 2);
    }

    function test_avgBuyTimeIsBuyWeighted() public {
        buy(alice, 10e18);
        (,, uint256 t1) = hook.basisOf(alice);
        skip(10 days);
        // Keep the Cabal awake is irrelevant for buys; a second, equal-size buy halves the hold time.
        (, uint256 h1,) = hook.basisOf(alice);
        buy(alice, 10e18);
        (, uint256 h2, uint256 t2) = hook.basisOf(alice);
        uint256 expected = (t1 * h1 + vm.getBlockTimestamp() * (h2 - h1)) / h2;
        assertEq(t2, expected);
        assertGt(t2, t1);
    }

    function test_factScoreUsesCheckpointsNotSpot() public {
        buy(alice, 50e18);
        skip(1 hours);
        buy(bob, 10e18); // first trade of the hour sets the checkpoint
        uint256 latest = hook.latestPrice();
        buy(bob, 2_000e18); // a big pump in the same hour
        assertEq(hook.latestPrice(), latest);
        assertGt(hook.priceX96(), latest);
    }

    function test_capDecayIsSetSoTheFloorIsReachableIn25Days() public view {
        uint256 cap = hook.inventoryCap();
        assertEq(hook.capDecayPerDay(), (cap - hook.CAP_FLOOR()) / 25);
    }

    function test_capFollowsBuysAtMostOneDayOfDecayPerDay() public {
        buy(alice, 3_000e18); // takes far more than one day's allowance out of the market
        uint256 held = hook.pleaInMarket();
        uint256 cap0 = hook.inventoryCap();
        assertGt(cap0 - held, hook.capDecayPerDay()); // the cap cannot jump to the holdings at once
        skip(1 days);
        buy(bob, 1e18);
        uint256 cap1 = hook.inventoryCap();
        assertApproxEqAbs(cap0 - cap1, hook.capDecayPerDay(), hook.capDecayPerDay() / 1000);
        skip(30 days);
        buy(bob, 1e18);
        assertEq(hook.inventoryCap(), hook.pleaInMarket()); // caught up, never below the holdings
    }

    function test_aSellAboveTheCapIsTrimmedAndBurned() public {
        buy(alice, 3_000e18);
        skip(30 days);
        buy(bob, 1e18); // cap catches up with the market
        skip(DEADMAN); // free trading
        uint256 supplyBefore = plea.totalSupply();
        uint256 claimsBefore = hook.retainClaims();
        vm.startPrank(alice);
        plea.approve(address(router), type(uint256).max);
        uint256 sold = plea.balanceOf(alice) / 4;
        router.sellExactIn(sold, abi.encode(alice));
        vm.stopPrank();
        assertApproxEqRel(plea.totalSupply() + sold, supplyBefore, 0.01e18); // ~the sold PLEA burned
        assertGt(hook.retainClaims(), claimsBefore); // and IMD moved to the wall reserve
    }

    function _pleaPriceTick(int24 t) internal view returns (int256) {
        return hook.pleaIsZero() ? int256(t) : -int256(t);
    }

    function test_wallGuardLagsAPumpAndCapsTheWall() public {
        int24 g0 = hook.wallGuardTick();
        for (uint256 i; i < 40; ++i) {
            vm.roll(vm.getBlockNumber() + 1);
            skip(12);
            buy(bob, 300e18); // a pump held over many blocks drags refTick along
        }
        int24 spot = hook.currentTick();
        int24 g1 = hook.wallGuardTick();
        // The guard moved at most 400 ticks a day toward the higher PLEA price (8 minutes: ~2 ticks).
        assertLe(_pleaPriceTick(g1) - _pleaPriceTick(g0), 3);
        assertGt(_pleaPriceTick(spot) - _pleaPriceTick(g1), 1_000);
        vm.prank(keeper);
        hook.rebalance();
        (int24 lo, int24 hi,) = hook.wall();
        // The wall's edge nearest the price is no higher a PLEA price than the guard.
        if (hook.pleaIsZero()) assertLe(hi, g1);
        else assertGe(lo, g1);
    }

    function test_wallGuardDropsAtOnceAndRisesFourPercentADay() public {
        buy(alice, 3_000e18);
        // Hold the price for weeks: the guard climbs ~400 ticks a day until it reaches the price.
        for (uint256 i; i < 30; ++i) {
            skip(1 days);
            for (uint256 k; k < 3; ++k) {
                vm.roll(vm.getBlockNumber() + 1); // refTick follows ~200 ticks per traded block
                buy(bob, 1e18);
            }
        }
        int24 g0 = hook.wallGuardTick();
        assertApproxEqAbs(_pleaPriceTick(g0), _pleaPriceTick(hook.currentTick()), 20); // caught up to the last block close
        // The Cabal is long dead (no verdicts), so trading is free and we can push the price down.
        vm.startPrank(alice);
        plea.approve(address(router), type(uint256).max);
        router.sellExactIn(plea.balanceOf(alice) / 2, abi.encode(alice));
        vm.stopPrank();
        int24 g1 = hook.wallGuardTick();
        assertEq(_pleaPriceTick(g1), _pleaPriceTick(hook.pleaIsZero() ? hook.currentTick() : hook.currentTick() + 1));
        assertLe(_pleaPriceTick(g1), _pleaPriceTick(g0));
        // A day later, with the price held higher, the guard has risen by at most 400 ticks.
        for (uint256 i; i < 3; ++i) {
            vm.roll(vm.getBlockNumber() + 1);
            skip(8 hours);
            buy(bob, 1_000e18);
        }
        int24 g2 = hook.wallGuardTick();
        assertLe(_pleaPriceTick(g2) - _pleaPriceTick(g1), 401);
        assertGt(_pleaPriceTick(g2), _pleaPriceTick(g1));
    }
}
