import picocolors from "picocolors";

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SILENT = 4,
}

const LOG_LABELS: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: "DEBUG",
  [LogLevel.INFO]: "INFO",
  [LogLevel.WARN]: "WARN",
  [LogLevel.ERROR]: "ERROR",
  [LogLevel.SILENT]: "SILENT",
};

const LOG_COLORS: Record<LogLevel, (s: string) => string> = {
  [LogLevel.DEBUG]: picocolors.dim,
  [LogLevel.INFO]: picocolors.cyan,
  [LogLevel.WARN]: picocolors.yellow,
  [LogLevel.ERROR]: picocolors.red,
  [LogLevel.SILENT]: (s: string) => s,
};

export class Logger {
  private level: LogLevel;

  constructor(level: LogLevel = LogLevel.INFO) {
    this.level = level;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  private log(level: LogLevel, message: string, ...args: unknown[]): void {
    if (level < this.level) return;

    const timestamp = new Date().toISOString().slice(11, 19);
    const label = LOG_LABELS[level].padEnd(5);
    const color = LOG_COLORS[level];
    const prefix = color(`${timestamp} [${label}]`);

    if (args.length > 0) {
      console.log(`${prefix} ${message}`, ...args);
    } else {
      console.log(`${prefix} ${message}`);
    }
  }

  debug(message: string, ...args: unknown[]): void {
    this.log(LogLevel.DEBUG, message, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    this.log(LogLevel.INFO, message, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.log(LogLevel.WARN, message, ...args);
  }

  error(message: string, ...args: unknown[]): void {
    this.log(LogLevel.ERROR, message, ...args);
  }

  /** Print a header for a pipeline step */
  step(stepName: string): void {
    this.info(picocolors.bold(picocolors.underline(`\n▸ ${stepName}`)));
  }

  /** Print a success message */
  success(message: string): void {
    console.log(`${picocolors.green("✔")} ${message}`);
  }

  /** Print a failure message */
  fail(message: string): void {
    console.log(`${picocolors.red("✘")} ${message}`);
  }
}

export const logger = new Logger();
