import hardhatToolboxMochaEthersPlugin from '@nomicfoundation/hardhat-toolbox-mocha-ethers';
import { configVariable, defineConfig } from 'hardhat/config';

export default defineConfig({
  plugins: [hardhatToolboxMochaEthersPlugin],
  solidity: {
    profiles: {
      default: {
        version: '0.8.28',
      },
      production: {
        version: '0.8.28',
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    },
  },
  networks: {
    hardhat: {
      type: 'edr-simulated',
      chainType: 'l1',
      accounts: {
        mnemonic: 'test test test test test test test test test test test junk',
        initialIndex: 0,
        count: 100,
      },
    },
    'eth-mainnet': {
      type: 'http',
      url: configVariable('ETH_MAINNET_RPC_URL'),
      accounts: [configVariable('DEPLOYER_ACCOUNT_PK')],
    },
    'eth-sepolia': {
      type: 'http',
      url: configVariable('ETH_SEPOLIA_RPC_URL'),
      accounts: [configVariable('DEPLOYER_ACCOUNT_PK')],
    },
    'base-mainnet': {
      type: 'http',
      url: configVariable('BASE_MAINNET_RPC_URL'),
      accounts: [configVariable('DEPLOYER_ACCOUNT_PK')],
    },
    'base-sepolia': {
      type: 'http',
      url: configVariable('BASE_SEPOLIA_RPC_URL'),
      accounts: [configVariable('DEPLOYER_ACCOUNT_PK')],
    },
  },
});
