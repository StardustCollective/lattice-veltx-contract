import fs from 'fs';
import path from 'path';

import hre from 'hardhat';

export const generateSolidityStdInputForContract = async (
  contractName: string,
) => {
  const contractArtifact = await hre.artifacts.readArtifact(contractName);

  if (!contractArtifact.buildInfoId) {
    throw new Error('Build info ID not found');
  }

  const buildPath = await hre.artifacts.getBuildInfoPath(
    contractArtifact.buildInfoId,
  );

  if (!buildPath) {
    throw new Error('Build path not found');
  }

  const buildInfo: { input: Record<string, unknown> } = JSON.parse(
    await fs.promises.readFile(buildPath, 'utf8'),
  );

  const foldername = path.join(import.meta.dirname, '..', 'stdins');
  await fs.promises.mkdir(foldername, { recursive: true });

  const filename = path.join(foldername, `${contractName}.stdin.json`);

  await fs.promises.writeFile(
    filename,
    JSON.stringify(buildInfo?.input, null, 4),
  );

  console.log(`Generated Solidity Std Input in file ${filename}`);
};
