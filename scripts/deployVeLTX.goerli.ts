import hre, { ethers } from "hardhat";
import dayjs from "../utils/dayjs";

const LOCKUP_POINTS = [
  [dayjs.duration({ months: 6 }), 0.1],
  [dayjs.duration({ months: 12 }), 0.25],
  [dayjs.duration({ months: 24 }), 0.65],
  [dayjs.duration({ months: 36 }), 1],
] as const;

const ltxTokenDevAddress = "0x74299a718b2c44483a27325d7725f0b2646de3b1";

async function main() {
  if (hre.network.name !== "goerli") {
    throw new Error("Deploy must be done on the goerli network");
  }

  const ltxTokenDevFactory = await ethers.getContractFactory("ERC20");
  const ltxTokenDev = ltxTokenDevFactory.attach(ltxTokenDevAddress);

  console.log(`Signer Attached: ${(await ethers.getSigners())[0].address}`);
  console.log(
    `LTT Token Attached: ${
      ltxTokenDev.address
    } - Deicmals: ${await ltxTokenDev.decimals()}`
  );

  const veltxTokenDevFactory = await ethers.getContractFactory(
    "LatticeGovernanceTokenDev"
  );
  const veltxTokenDev = await veltxTokenDevFactory.deploy(ltxTokenDevAddress);

  await veltxTokenDev.deployed();
  console.log(`Contract deployed at address: ${veltxTokenDev.address}`);

  const exponentDiff =
    (await veltxTokenDev.decimals()) - (await ltxTokenDev.decimals());

  for (const [lockupTime, tokenPercentageReleased] of LOCKUP_POINTS) {
    await veltxTokenDev["setLockupPoint(uint256,uint256)"](
      lockupTime.as("seconds"),
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
