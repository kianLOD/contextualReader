type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const PREFIX = '[ContextualReader]';

function emit(level: LogLevel, scope: string, message: string, data?: unknown) {
  const line = `${PREFIX} ${scope}: ${message}`;
  if (data !== undefined) {
    console[level](line, data);
  } else {
    console[level](line);
  }
}

export const log = {
  debug: (scope: string, message: string, data?: unknown) =>
    emit('debug', scope, message, data),
  info: (scope: string, message: string, data?: unknown) =>
    emit('info', scope, message, data),
  warn: (scope: string, message: string, data?: unknown) =>
    emit('warn', scope, message, data),
  error: (scope: string, message: string, data?: unknown) =>
    emit('error', scope, message, data),
};
