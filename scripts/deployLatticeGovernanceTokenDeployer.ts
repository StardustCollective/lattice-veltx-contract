import * as readline from 'readline';

import hre from 'hardhat';

import { generateSolidityStdInputForContract } from '../utils/index.ts';

async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

async function main() {
  const { ethers, networkName } = await hre.network.connect();
  const [signer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(signer.address);

  const veLTXDeployerFactory = await ethers.getContractFactory(
    'LatticeGovernanceTokenDeployer',
  );

  await generateSolidityStdInputForContract('LatticeGovernanceTokenDeployer');

  // Estimate gas
  const deployTx = await veLTXDeployerFactory.getDeployTransaction();
  const estimatedGas = await ethers.provider.estimateGas(deployTx);
  const { gasPrice } = await ethers.provider.getFeeData();
  const estimatedCost = estimatedGas * (gasPrice ?? 0n);

  console.log('\n=== DEPLOYMENT DETAILS ===');
  console.log(`Network: ${networkName}`);
  console.log(`Chain ID: ${(await ethers.provider.getNetwork()).chainId}`);
  console.log(`Deployer: ${signer.address}`);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH`);
  console.log(`Contract: LatticeGovernanceTokenDeployer`);
  console.log('');
  console.log('Gas Estimation:');
  console.log(`  Gas Units: ${estimatedGas.toString()}`);
  console.log(
    `  Gas Price: ${ethers.formatUnits(gasPrice ?? 0n, 'gwei')} gwei`,
  );
  console.log(`  Estimated Cost: ${ethers.formatEther(estimatedCost)} ETH`);
  console.log('==========================\n');

  const proceed = await confirm('Deploy contract? (y/n): ');

  if (!proceed) {
    console.log('Deployment cancelled.');
    return;
  }

  console.log('\nDeploying contract...');

  const latticeAirdropsDistributor = await veLTXDeployerFactory.deploy();
  const deployTransaction = latticeAirdropsDistributor.deploymentTransaction();

  if (!deployTransaction) {
    throw new Error('Deployment transaction not found');
  }

  const receipt = await deployTransaction.wait();

  if (!receipt) {
    throw new Error('Deployment transaction receipt not found');
  }

  const actualGasUsed = receipt.gasUsed;
  const actualCost = actualGasUsed * (receipt.gasUsed ?? 0n);

  console.log('\n=== DEPLOYMENT SUCCESS ===');
  console.log(`Contract: ${await latticeAirdropsDistributor.getAddress()}`);
  console.log(`Owner: ${signer.address}`);
  console.log(`Network: ${networkName}`);
  console.log('');
  console.log('Gas Usage:');
  console.log(`  Gas Used: ${actualGasUsed.toString()}`);
  console.log(
    `  Gas Price: ${ethers.formatUnits(receipt.gasUsed ?? 0n, 'gwei')} gwei`,
  );
  console.log(`  Total Cost: ${ethers.formatEther(actualCost)} ETH`);
  console.log(`  Tx Hash: ${receipt.hash}`);
  console.log('==========================\n');
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
