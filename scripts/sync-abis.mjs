// Copy the ABIs the web app and agent need from hardhat artifacts into lib/abis.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
const targets = [
  ["PayoffVault", "artifacts/contracts/PayoffVault.sol/PayoffVault.json"],
  ["PayoffVaultFactory", "artifacts/contracts/PayoffVaultFactory.sol/PayoffVaultFactory.json"],
];
const check = process.argv.includes("--check");
mkdirSync("lib/abis", { recursive: true });
let dirty = false;
for (const [name, path] of targets) {
  if (!existsSync(path)) { console.error(`missing artifact ${path}; run hardhat compile`); process.exit(1); }
  const abi = JSON.stringify(JSON.parse(readFileSync(path, "utf8")).abi, null, 2) + "\n";
  const out = `lib/abis/${name}.json`;
  if (check) {
    if (!existsSync(out) || readFileSync(out, "utf8") !== abi) { console.error(`${out} is stale`); dirty = true; }
  } else {
    writeFileSync(out, abi);
    console.log(`wrote ${out}`);
  }
}
if (dirty) process.exit(1);
