import { Command } from "commander";
import { ExitCode, Luz } from "./src/Luz";
import fs from "fs";

const program = new Command();

const VALID_FILE_PATH: RegExp = /^.?(?:[\/\\])?(?:\w+[\\\/])*\w+\.\w+$/g;
const VERSION = "0.4.1";

function runFile(path: string) {
  if (!fs.existsSync(path)) {
    console.error(`The file '${path}' doesn't exist in the current directory`);
    process.exit(ExitCode.FileNotFound);
  }

  let expr = fs.readFileSync(path, "utf8");

  const luz = new Luz({
    expr,
    logFn: process.stdout.write.bind(process.stdout),
  });
  const code = luz.run();

  process.exit(code);
}

program
  .name("Luz")
  .description("CLI of the Luz programming language")
  .version(`Luz ${VERSION}`, "--version, -v", "output the current version");

// program
//   .argument("[path]", "Path to Luz source file")
//   .action((path: string | undefined) => {
//     // console.log(path);

//     if (!path) {
//       program.help();
//       return;
//     }

//     runFile(path);
//   });

program
  .command("run <path>")
  .description("run a Luz source file (with the .luz extension)")
  .action((path: string) => {
    if (!VALID_FILE_PATH.test(path)) {
      console.error(`The file path '${path}' is invalid`);
      process.exit(ExitCode.InvalidFilePath);
    } else if (!path.endsWith(".luz")) {
      const file = path.split(/\\|\//g).pop();

      console.error(
        `The file '${file}' doesn't have the correct extension (.luz)`
      );
      process.exit(ExitCode.InvalidFilePath);
    }

    runFile(path);
  });

program.parse();
