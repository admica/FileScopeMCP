import * as fs from 'fs';
import * as path from 'path';

let logToFile = false;
let logFilePath = path.join(process.cwd(), 'mcp-debug.log');
let daemonMode = false;
const LOG_MAX_SIZE = 10 * 1024 * 1024; // 10 MB

export function enableFileLogging(enable: boolean, filePath?: string) {
  logToFile = enable;
  if (filePath) {
    logFilePath = filePath;
  }
}

/**
 * Enable daemon-mode file logging. In daemon mode, console.error output is
 * suppressed — all log output goes to the file only. Automatic size rotation
 * truncates the file when it exceeds 10 MB.
 */
export function enableDaemonFileLogging(logPath: string): void {
  logToFile = true;
  daemonMode = true;
  logFilePath = logPath;
}

// ─── Internal shared write helper ─────────────────────────────────────────────

function _write(prefix: string, message: string, args: any[], toConsole: boolean, toDisk: boolean): void {
  const timestamp = new Date().toISOString();
  let formatted = prefix
    ? `[${timestamp}] ${prefix} ${message}`
    : `[${timestamp}] ${message}`;

  if (args && args.length > 0) {
    args.forEach(arg => {
      formatted += ' ' + (typeof arg === 'object' ? JSON.stringify(arg) : arg);
    });
  }

  if (toConsole) {
    console.error(formatted);
  }

  if (toDisk && logToFile) {
    try {
      // Size-check-then-truncate: if file > 10MB, reset before writing
      if (fs.existsSync(logFilePath)) {
        const stat = fs.statSync(logFilePath);
        if (stat.size > LOG_MAX_SIZE) {
          fs.writeFileSync(logFilePath, '', 'utf8');
        }
      }
      fs.appendFileSync(logFilePath, formatted + '\n', 'utf8');
    } catch {
      // Logging failures should never crash the process
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function log(message: string, ...args: any[]): void {
  _write('', message, args, !daemonMode, logToFile);
}

/** Always written to console AND disk regardless of daemon mode. */
export function error(message: string, ...args: any[]): void {
  _write('[ERROR]', message, args, true, true);
}

/** Same suppression rules as log(): suppressed in daemon mode. */
export function warn(message: string, ...args: any[]): void {
  _write('[WARN]', message, args, !daemonMode, logToFile);
}

/** Same suppression rules as log(): suppressed in daemon mode. */
export function info(message: string, ...args: any[]): void {
  _write('[INFO]', message, args, !daemonMode, logToFile);
}

/** Suppressed entirely in daemon mode — pure noise in production logs. */
export function debug(message: string, ...args: any[]): void {
  if (daemonMode) return;
  _write('[DEBUG]', message, args, true, logToFile);
}
