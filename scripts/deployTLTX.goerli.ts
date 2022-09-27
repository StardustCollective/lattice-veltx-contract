import hre, { ethers } from "hardhat";

async function main() {
  if (hre.network.name !== "goerli") {
    throw new Error("Deploy must be done on the goerli network");
  }

  console.log(`Signer Attached: ${(await ethers.getSigners())[0].address}`);

  const ltxTokenDevFactory = await ethers.getContractFactory(
    "TestLatticeToken"
  );
  const ltxTokenDev = await ltxTokenDevFactory.deploy();

  await ltxTokenDev.deployed();
  console.log(`Contract deployed at address: ${ltxTokenDev.address}`);

  const trx = await ltxTokenDev.mint(
    (
      await ethers.getSigners()
    )[0].address,
    ethers.BigNumber.from("10000000").mul(
      ethers.BigNumber.from(10).pow(await ltxTokenDev.decimals())
    )
  );

  console.log(`Mint transaction hash: ${trx.hash}`);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
