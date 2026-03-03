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

export function log(message: string, ...args: any[]) {
  const timestamp = new Date().toISOString();
  let formattedMessage = `[${timestamp}] ${message}`;

  // Handle additional arguments
  if (args && args.length > 0) {
    args.forEach(arg => {
      if (typeof arg === 'object') {
        formattedMessage += ' ' + JSON.stringify(arg);
      } else {
        formattedMessage += ' ' + arg;
      }
    });
  }

  // Log to console only when not in daemon mode
  if (!daemonMode) {
    console.error(formattedMessage);
  }

  // Log to file if enabled
  if (logToFile) {
    try {
      // Size-check-then-truncate: if file > 10MB, reset before writing
      if (fs.existsSync(logFilePath)) {
        const stat = fs.statSync(logFilePath);
        if (stat.size > LOG_MAX_SIZE) {
          fs.writeFileSync(logFilePath, '', 'utf8');
        }
      }
      fs.appendFileSync(logFilePath, formattedMessage + '\n', 'utf8');
    } catch {
      // Logging failures should never crash the process
    }
  }
}
