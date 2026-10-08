type LogLevel = "info" | "warn" | "error";

export type LogContext = Record<string, unknown>;

function emit(level: LogLevel, message: string, context: LogContext): void {
  const base = { timestamp: new Date().toISOString(), level, message };
  let line: string;
  try {
    line = JSON.stringify({ ...context, ...base });
  } catch {
    line = JSON.stringify({ ...base, note: "unserializable-context" });
  }
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info: (message: string, context: LogContext = {}): void => emit("info", message, context),
  warn: (message: string, context: LogContext = {}): void => emit("warn", message, context),
  error: (message: string, context: LogContext = {}): void => emit("error", message, context),
};
