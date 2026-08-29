import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const sourceRoot = resolve("contract/src/managed/veilrisk");
const destinationRoot = resolve("public/contract/veilrisk");
const runtimeRoot = resolve("work/contract/veilrisk");

await rm(destinationRoot, { force: true, recursive: true });
await rm(runtimeRoot, { force: true, recursive: true });
await mkdir(destinationRoot, { recursive: true });
await mkdir(runtimeRoot, { recursive: true });
await Promise.all([
  cp(resolve(sourceRoot, "keys"), resolve(destinationRoot, "keys"), {
    force: true,
    recursive: true,
  }),
  cp(resolve(sourceRoot, "zkir"), resolve(destinationRoot, "zkir"), {
    force: true,
    recursive: true,
  }),
  cp(resolve(sourceRoot, "contract"), resolve(runtimeRoot, "contract"), {
    force: true,
    recursive: true,
  }),
]);
