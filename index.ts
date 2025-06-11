import { Command } from "commander";
import fs from "fs";
import {
  errorColor,
  getSystemLang,
  handleRawCliArgs,
  runFile,
} from "./src/util";
import texts from "./src/texts.json";
import chalk from "chalk";

export type TextLang = keyof typeof texts;

export const VERSION = "0.4.1";
export const LANG = getSystemLang() as TextLang;
export const TEXTS = texts[LANG];

handleRawCliArgs(process.argv);

export const program = new Command();

program
  .name("luz")
  .description(TEXTS.description.luz.replace(/(Luz)/i, chalk.magenta("$1")))
  .version(
    `${chalk.magenta("Luz")} ${VERSION}`,
    "--version, -v",
    TEXTS.description.version
  )
  .helpOption("--help, -h", TEXTS.description.help)
  .helpCommand("help [command]", TEXTS.description.help)
  .configureOutput({
    outputError: (str, write) => write(errorColor(str)),
  })
  .configureHelp({
    styleTitle(title: string) {
      title = title.substring(0, title.length - 1).toLowerCase();

      if (title === "usage") return chalk.bold(`${TEXTS.title.usage}:`);
      if (title === "options")
        return chalk.bold(`${TEXTS.title.options}:`);
      if (title === "commands")
        return chalk.bold(`${TEXTS.title.commands}:`);

      return title;
    },
    styleArgumentText: (str) => chalk.cyanBright(str),

    styleOptionText: (str) => chalk.dim(str),
    styleCommandText: (str) => chalk.magenta(str),
    styleSubcommandText: (str) => chalk.blue(str),
  })
  .allowUnknownOption(false)
  .allowExcessArguments(false);

program
  .command("run <filepath>")
  .alias("r")
  .option("--debug, -d", TEXTS.description.debug)
  .description(TEXTS.description.run)
  .action((path: string, ops: Record<string, boolean>) => {
    const isDebug = "debug" in ops;

    if (!path.endsWith(".luz") && fs.existsSync(`${path}.luz`))
      path = `${path}.luz`;

    runFile(path, isDebug);
  });

program.parse();
