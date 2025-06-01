import { stdout } from "process";
import { Luz } from "./src/Luz";
import fs from "fs";

let debugFlag = true;

const name = "main.luz";
let expr = fs.readFileSync(`./${name}`, "utf8");

const luz = new Luz({
  expr,
  logFn: stdout.write.bind(process.stdout),
});

if (debugFlag) {
  console.time("Runtime");
  console.log(`┌${"─".repeat(name.length + 2)}┐`);
  console.log(`│ ${name} │`);
  console.log(
    `└${"─".repeat(name.length + 2)}┴${"─".repeat(50 - name.length - 4)}\n`
  );
}

const code = luz.run();

if (debugFlag) {
  console.log(`\n\n${"─".repeat(50)}\n\n`);
  console.timeEnd("Runtime");
  console.log("Exit with Code:", code);

  luz.getVars.length !== 0 && console.table(luz.getVarsDebug);
}

process.exitCode = code; // Override exit code!
