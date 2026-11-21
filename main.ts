// main.ts
import { setFlagsFromString } from "node:v8";
import { readFileSync, writeFileSync } from "node:fs";

// Turn off V8 incremental marking for lower CPU overhead (as allowed in brief)
setFlagsFromString("--no-incremental-marking");

const { run } = await import("./solve.js");

const cases = JSON.parse(readFileSync("/input/cases.json", "utf8"));
const answers = new Array(cases.length);

for (let i = 0; i < cases.length; i++) {
  answers[i] = run(cases[i].input);
}

writeFileSync("/output/answers.json", JSON.stringify(answers));