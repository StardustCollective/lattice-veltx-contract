import * as dotenv from "dotenv";

import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

dotenv.config();

const accounts = process.env.LATTICE_EXCHANGE_ACCOUNT_PK
  ? [process.env.LATTICE_EXCHANGE_ACCOUNT_PK]
  : [];

const config: HardhatUserConfig = {
  solidity: "0.8.9",
  networks: {
    mainnet: {
      url: `https://mainnet.infura.io/v3/${process.env.INFURA_PROJECT_ID}`,
      accounts,
    },
    ropsten: {
      url: `https://ropsten.infura.io/v3/${process.env.INFURA_PROJECT_ID}`,
      accounts,
    },
    goerli: {
      url: `https://goerli.infura.io/v3/${process.env.INFURA_PROJECT_ID}`,
      accounts,
    },
  },
};

export default config;
