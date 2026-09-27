import { readFile } from "node:fs/promises";
import { compile } from "../src/index.mjs";
import { replay, simulate } from "../src/simulator.mjs";

const help = `Usage:
  node bin/engine.mjs simulate DEFINITION.json [--seed UINT32] [--max-steps N]
  node bin/engine.mjs replay TRACE.json
JSON is written to stdout. Exit: 0 finished, 1 deadlock/error/limit, 2 invalid input.
All fixtures are synthetic; no complete game rules are implemented yet.`;

try {
  const [mode, path, ...args] = process.argv.slice(2);
  if (mode === "--help") console.log(help);
  else {
    if (!["simulate", "replay"].includes(mode) || !path) throw new Error(help);
    const options = {};
    for (let i = 0; i < args.length; i += 2) {
      const key = { "--seed": "seed", "--max-steps": "maxSteps" }[args[i]];
      if (mode !== "simulate" || !key || Object.hasOwn(options, key) || !/^\d+$/.test(args[i + 1] ?? "")) throw new Error("invalid CLI options");
      options[key] = Number(args[i + 1]);
    }
    const input = JSON.parse(await readFile(path, "utf8"));
    const output = mode === "simulate" ? simulate(compile(input), options) : replay(input);
    console.log(JSON.stringify(output, null, 2));
    process.exitCode = output.result.kind === "finished" ? 0 : 1;
  }
} catch (error) {
  console.error(JSON.stringify({ error: error.name, message: error.message }));
  process.exitCode = 2;
}
