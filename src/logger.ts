export type LogLevel = "debug" | "info" | "warn" | "error";

const levelPriority: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = "info";

export const setLogLevel = (level: LogLevel): void => {
  currentLevel = level;
};

const shouldLog = (level: LogLevel): boolean =>
  levelPriority[level] >= levelPriority[currentLevel];

const formatTimestamp = (): string => new Date().toISOString();

const formatMessage = (level: LogLevel, msg: string, fields?: Record<string, unknown>): string => {
  const base = `${formatTimestamp()} [${level.toUpperCase()}] ${msg}`;
  if (fields && Object.keys(fields).length > 0) {
    return `${base} ${JSON.stringify(fields)}`;
  }
  return base;
};

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>): void => {
    if (shouldLog("debug")) console.debug(formatMessage("debug", msg, fields));
  },
  info: (msg: string, fields?: Record<string, unknown>): void => {
    if (shouldLog("info")) console.log(formatMessage("info", msg, fields));
  },
  warn: (msg: string, fields?: Record<string, unknown>): void => {
    if (shouldLog("warn")) console.warn(formatMessage("warn", msg, fields));
  },
  error: (msg: string, fields?: Record<string, unknown>): void => {
    if (shouldLog("error")) console.error(formatMessage("error", msg, fields));
  },
};

export interface RequestLog {
  method: string;
  path: string;
  status: number;
  durationMs: number;
}

export const logRequest = (req: RequestLog): void => {
  const level: LogLevel = req.status >= 500 ? "error" : req.status >= 400 ? "warn" : "info";
  log[level](`${req.method} ${req.path} ${req.status}`, {
    duration: `${req.durationMs}ms`,
  });
};
