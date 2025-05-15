import { Luz } from "./Luz";
import fs from "fs";

const name = "main.luz";
let expr = fs.readFileSync(`./src/${name}`, "utf8");
const luz = new Luz({
  expr,
});

console.time("Runtime");
console.log(`┌${"─".repeat(name.length + 2)}┐`);
console.log(`│ ${name} │`);
console.log(
  `└${"─".repeat(name.length + 2)}┴${"─".repeat(50 - name.length - 4)}\n`
);

const code = luz.run();

console.log(`\n\n${"─".repeat(50)}\n\n`);
console.log("Exit with Code:", code, "\n");
console.timeEnd("Runtime");
console.log("\n\n");

luz.getVars.length !== 0 && console.table(luz.getVarsDebug);




process.exitCode = code; // Override exit code





