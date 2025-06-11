import wrapAnsi from "wrap-ansi";
import { ExitCode, Luz } from "./Luz";
import fs from "fs";
import { TEXTS } from "..";
import chalk from "chalk";

import { Console } from "console";

export const errConsole = new Console(process.stderr);

export const VALID_FILE_PATH: RegExp =
  /^.?(?:[\/\\])?(?:[\w\s\.]+[\\\/])*[\w\s\.]+\.[\w]+$/;

export function runFile(path: string, debug = false) {
  if (path === ".") path = "main.luz";

  if (!VALID_FILE_PATH.test(path)) {
    console.error(`error: the filepath '${path}' is invalid`);
    process.exit(ExitCode.InvalidFilePath);
  }

  if (!fs.existsSync(path)) {
    const filename = getFilenameFromPath(path);
    console.error(`error: the file '${filename}' doesn't exist`);
    process.exit(ExitCode.FileNotFound);
  }

  validatePath(path);

  let expr = fs.readFileSync(path, "utf8");


  const luz = new Luz({
    expr,
    logFn: process.stdout.write.bind(process.stdout),
    errFn: writeStderrCol,
  });

  const start = performance.now();

  const code = luz.run();

  const duration = performance.now() - start;

  if (debug) {
    const varsDebug = luz.getVarsDebug;
    errConsole.log("\n");
    errConsole.log(chalk.yellow.bold("Debug information:\n"));

    errConsole.log(chalk.bold("Variables:"));
    if (varsDebug.length > 0) errConsole.table(luz.getVarsDebug);
    else errConsole.log(chalk.red("No variables left"));
    errConsole.log(
      chalk.bold("Runtime:"),
      chalk.cyan(`${duration.toFixed(3)}ms`)
    );
    errConsole.log(
      chalk.bold("Exit with code:"),
      `${code === 0 ? chalk.green(code) : chalk.red(code)}`
    );
    errConsole.log();
  }

  process.exit(code);
}
export const errorColor = (str: string) => chalk.red(str);

export const writeStderrCol = (msg: string) => process.stderr.write(errorColor(msg))


export function getSystemLang() {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    const lang = locale.split("-")[0]!.toLowerCase();

    return lang !== "es" ? "en" : "es";
  } catch (e) {
    return "en";
  }
}

export function validatePath(path: string) {
  if (path === ".") return;

  if (!path.endsWith(".luz")) {
    const filename = getFilenameFromPath(path);

    console.error(
      `error: the file '${filename}' doesn't have the correct extension (.luz)`
    );

    process.exit(ExitCode.InvalidFilePath);
  }
}

export function getFilenameFromPath(path: string): string | undefined {
  return path.split(/\\|\//g).pop();
}

export function handleRawCliArgs(args: Array<string>): void {
  const [, , arg0, arg1, arg2, arg3] = args;

  const isDebugOpt = (flag: string) => /^(?:-d|--debug)$/.test(flag);

  if ((arg0 && VALID_FILE_PATH.test(arg0)) || arg0 === ".") {
    let isDebug = false;

    if (arg1 && isDebugOpt(arg1)) isDebug = true;

    runFile(arg0, isDebug);
  } else if (arg0 && isDebugOpt(arg0) && arg1 && VALID_FILE_PATH.test(arg1))
    runFile(arg1, true);
  

  const isBelen = (arg?: string) => /^bel(?:e|é)n$/i.test(arg ?? "");
  const isRamirez = (arg?: string) => /^ram(i|í)rez$/i.test(arg ?? "");
  const isApaza = (arg?: string) => /^apaza$/i.test(arg ?? "");

  if (
    (isBelen(arg0) && isRamirez(arg1) && isApaza(arg2) && !arg3) ||
    (isRamirez(arg0) && isApaza(arg1) && !arg2)
  ) {
    console.log(
      wrapAnsi(
        `
        ${TEXTS["belén"]}
        
        `,
        Math.floor(process.stdout.columns * 0.85)
      )
    );
    process.exit(ExitCode.Success);
  }
}
