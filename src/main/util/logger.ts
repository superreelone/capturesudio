type Level = 'debug' | 'info' | 'warn' | 'error';

function emit(level: Level, scope: string, msg: string, meta?: Record<string, unknown>): void {
  const line = {
    ts: new Date().toISOString(),
    level,
    scope,
    msg,
    ...(meta ? { meta } : {})
  };
  const out = JSON.stringify(line);
  if (level === 'error') console.error(out);
  else if (level === 'warn') console.warn(out);
  else console.log(out);
}

export function createLogger(scope: string) {
  return {
    debug: (msg: string, meta?: Record<string, unknown>) => emit('debug', scope, msg, meta),
    info: (msg: string, meta?: Record<string, unknown>) => emit('info', scope, msg, meta),
    warn: (msg: string, meta?: Record<string, unknown>) => emit('warn', scope, msg, meta),
    error: (msg: string, meta?: Record<string, unknown>) => emit('error', scope, msg, meta)
  };
}
