import hre, { ethers } from "hardhat";

const SECONDS_IN_DAY = 60 * 60 * 24;

const LOCKUP_POINTS = [
  [(364 / 2) * SECONDS_IN_DAY, 0.1 * 10 ** 10],
  [365 * SECONDS_IN_DAY, 0.25 * 10 ** 10],
  [365 * 2 * SECONDS_IN_DAY, 0.65 * 10 ** 10],
  [365 * 3 * SECONDS_IN_DAY, 1 * 10 ** 10],
] as const;

const ltxTokenAddress = "0xa393473d64d2F9F026B60b6Df7859A689715d092";

async function main() {
  if (hre.network.name !== "mainnet") {
    throw new Error("Deploy must be done on the mainnet network");
  }

  const ltxTokenFactory = await ethers.getContractFactory("ERC20");
  const ltxTokenDev = ltxTokenFactory.attach(ltxTokenAddress);

  console.log(`Signer Attached: ${(await ethers.getSigners())[0].address}`);
  console.log(
    `LTX Token Attached: ${
      ltxTokenDev.address
    } - Deicmals: ${await ltxTokenDev.decimals()}`
  );

  const veltxTokenFactory = await ethers.getContractFactory(
    "LatticeGovernanceToken"
  );
  const veltxTokenDev = await veltxTokenFactory.deploy(ltxTokenAddress);

  await veltxTokenDev.deployed();
  console.log(`Contract deployed at address: ${veltxTokenDev.address}`);

  const exponentDiff =
    (await veltxTokenDev.decimals()) - (await ltxTokenDev.decimals());

  for (const [lockupTime, tokenPercentageReleased] of LOCKUP_POINTS) {
    await veltxTokenDev["setLockupPoint(uint256,uint256)"](
      lockupTime,
      tokenPercentageReleased * 10 ** exponentDiff
    );
  }
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
