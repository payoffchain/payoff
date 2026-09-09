import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
dotenv.config();

const RPC_URL = process.env.RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
const CHAIN_ID = Number(process.env.CHAIN_ID || 4663);
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || "";
const BLOCKSCOUT_URL = process.env.BLOCKSCOUT_URL || "https://robinhoodchain.blockscout.com";

// FORK=1 runs the hardhat network as a fork of Robinhood Chain so the fork tests can
// exercise the vault against the real Morpho Blue and Uniswap V3 deployments.
const forking = process.env.FORK ? { url: RPC_URL, ...(process.env.FORK_BLOCK ? { blockNumber: Number(process.env.FORK_BLOCK) } : {}) } : undefined;

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true },
  },
  networks: {
    // chains: a forked custom chain needs a hardfork history or `hardhat node` refuses calls at the fork block.
    hardhat: forking ? { forking, chainId: CHAIN_ID, chains: { [CHAIN_ID]: { hardforkHistory: { cancun: 0 } } } } : {},
    // A local hardhat node (npx hardhat node --port 8546), typically a fork of Robinhood Chain, for seeding the UI.
    localhost: { url: process.env.LOCAL_RPC_URL || "http://127.0.0.1:8546", chainId: CHAIN_ID },
    robinhood: {
      url: RPC_URL,
      chainId: CHAIN_ID,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
    },
  },
  etherscan: {
    apiKey: { robinhood: "blockscout" },
    customChains: [
      { network: "robinhood", chainId: CHAIN_ID, urls: { apiURL: `${BLOCKSCOUT_URL}/api`, browserURL: BLOCKSCOUT_URL } },
    ],
  },
  sourcify: { enabled: false },
  mocha: { timeout: 600_000 },
};

export default config;
