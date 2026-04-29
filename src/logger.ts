import pino, { type Logger, type LoggerOptions } from "pino";

const REDACT_PATHS = [
  "authorization",
  "headers.authorization",
  "*.authorization",
  "*.headers.authorization",
  "apiKey",
  "*.apiKey",
  "token",
  "*.token",
  "cloneUrl",
  "*.cloneUrl",
  "password",
  "*.password"
];

export function loggerOptions(name: string): LoggerOptions {
  return {
    name,
    level: process.env.LOG_LEVEL ?? "info",
    redact: {
      paths: REDACT_PATHS,
      censor: "[redacted]"
    },
    transport: shouldPrettyPrint()
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname"
          }
        }
      : undefined
  };
}

export function createLogger(name: string): Logger {
  return pino(loggerOptions(name));
}

function shouldPrettyPrint(): boolean {
  const value = process.env.LOG_PRETTY?.toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  return process.env.NODE_ENV !== "production";
}
