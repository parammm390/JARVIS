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

run(["run", "test:p1:locked"], "certified P0 plus P1 replay corpora");
run(["run", "test:p2:locked"], "P2 Operational Effect extension corpus");

console.log("P0+P1+P2 locked replay PASS: 80 category cases, 150 unique deterministic selectors");
