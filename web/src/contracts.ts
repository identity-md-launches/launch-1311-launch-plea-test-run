import {
  createPublicClient,
  http,
  fallback,
  parseAbi,
  type Address,
  type Abi,
} from "viem";
import { sepolia } from "viem/chains";
import deployment from "./deployment.json";
import plea from "./abi/PLEA.json";
import gate from "./abi/CabalGate.json";
import seasons from "./abi/Seasons.json";
import laureates from "./abi/Laureates.json";
import launch from "./abi/PleaLaunch.json";
import distributor from "./abi/PleaDistributor.json";
import hook from "./abi/PleaHook.json";
import intake from "./abi/IIntake.json";
import intakeEvents from "./abi/IntakeEvents.json";
import testImd from "./abi/TestIMD.json";
export { deployment, sepolia };
// The six launch contracts come from the verified deployment manifest. The rest are the
// task-supplied auxiliary addresses for PLEA test run 2 (launch #1311): the hook that
// PleaLaunch.hook() returns, the Sepolia PoolSwapTest router, Intake v2, the oracle fee
// token, tIMD, sIMD (24 decimals) and the imd/acc launch #1294 Stacker.
export const addresses = {
  ...Object.fromEntries(deployment.contracts.map((c) => [c.name, c.address])),
  PleaHook: "0x2d5A03d5bAb98a4a435edad11813373963bcA8cC",
  PoolSwapTest: "0x9b6b46e2c869aa39918db7f52f5557fe577b6eee",
  Intake: "0xa43e6f75ee006411f79ac1c84120606c2330de82",
  OracleIMD: "0x44a1cd38474fb1748400e7deb5f8d786cce3f89a",
  TestIMD: "0x2b69099e59b05901faa1dd164fabf098bf831e82",
  TestSIMD: "0xf9e2eec3b610ec6781f7438ac5fb4bc049d81cc1",
  Stacker: "0x0457276d7b036818b3eddc1a4a3fceda61e9314d",
  PoolManager: deployment.network.uniswapV4.poolManager,
} as Record<string, Address>;
export const tokenAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function decimals() view returns (uint8)",
  "function faucet()",
  "function mint(address,uint256)",
  "error ERC20InsufficientBalance(address,uint256,uint256)",
  "error ERC20InsufficientAllowance(address,uint256,uint256)",
]);
export const routerAbi = parseAbi([
  "function swap((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,(bool zeroForOne,int256 amountSpecified,uint160 sqrtPriceLimitX96) params,(bool takeClaims,bool settleUsingBurn) testSettings,bytes hookData) payable returns (int256 delta)",
  "error NoSwapOccurred()",
  "error WrappedError(address target,bytes4 selector,bytes reason,bytes details)",
  "error Error(string reason)",
]);
// imd/acc Stacker (launch #1294): no stackedBy getter; cashback is the sum of Stacked events.
export const stackerAbi = parseAbi([
  "event Stacked(address indexed project,address indexed trader,uint256 imd,uint256 shares)",
  "function credit(address to,uint256 amount)",
]);
export const abis: Record<string, Abi> = {
  PLEA: plea as Abi,
  CabalGate: gate as Abi,
  Seasons: seasons as Abi,
  Laureates: laureates as Abi,
  PleaLaunch: launch as Abi,
  PleaDistributor: distributor as Abi,
  PleaHook: hook as Abi,
  Intake: [...intake, ...intakeEvents] as Abi,
  OracleIMD: tokenAbi,
  TestIMD: testImd as Abi,
  TestSIMD: tokenAbi,
  PoolSwapTest: routerAbi,
  Stacker: stackerAbi,
};
export const client = createPublicClient({
  chain: sepolia,
  batch: { multicall: { batchSize: 8192, wait: 20 } },
  transport: fallback(
    deployment.network.rpcUrls.map((url) =>
      http(url, {
        timeout: 10000,
        retryCount: 1,
        batch: { wait: 15, batchSize: 50 },
      }),
    ),
    { rank: false, retryCount: 1 },
  ),
});
export const launchBlock = BigInt(
  Math.min(...deployment.contracts.map((c) => c.blockNumber)),
);
export const explorer = deployment.network.explorer;
export const txLink = (hash: string) => `${explorer}/tx/${hash}`;
export const addressLink = (address: string) =>
  `${explorer}/address/${address}`;
export const read = async <T = bigint>(
  contract: string,
  fn: string,
  args: readonly unknown[] = [],
): Promise<T> =>
  client.readContract({
    address: addresses[contract],
    abi: abis[contract],
    functionName: fn,
    args,
  }) as Promise<T>;
export const contractCall = (
  contract: string,
  fn: string,
  args: readonly unknown[] = [],
) => ({
  address: addresses[contract],
  abi: abis[contract],
  functionName: fn,
  args,
});
