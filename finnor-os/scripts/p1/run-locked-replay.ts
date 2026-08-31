import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function run(args: string[], label: string): void {
  const result = spawnSync("npm", args, {
    cwd: root,
    env: { ...process.env, NODE_ENV: "test", TZ: "UTC" },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status}`);
}

run(["run", "test:p0:replay"], "certified P0 replay corpus");
run(["run", "test:locked", "--workspace", "@finnor/operational-ir"], "P1 Operational IR extension corpus");

console.log("P0+P1 locked replay PASS: 55 category cases, 109 unique deterministic selectors");
