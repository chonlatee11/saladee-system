// Structured JSON logging to stdout (D-15). Captured by systemd journald in prod.
// NEVER pass secret values (tokens, passwords, raw slips) into `fields`.
type Level = "info" | "warn" | "error";

type Fields = Record<string, unknown>;

function emit(level: Level, msg: string, fields?: Fields): void {
  const line = JSON.stringify({ level, ts: new Date().toISOString(), msg, ...fields });
  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const log = {
  info: (msg: string, fields?: Fields) => emit("info", msg, fields),
  warn: (msg: string, fields?: Fields) => emit("warn", msg, fields),
  error: (msg: string, fields?: Fields) => emit("error", msg, fields),
};
