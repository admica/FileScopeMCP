import * as fs from 'fs';
import * as path from 'path';

let logToFile = false;
let logFilePath = path.join(process.cwd(), 'mcp-debug.log');

export function enableFileLogging(enable: boolean, filePath?: string) {
  logToFile = enable;
  if (filePath) {
    logFilePath = filePath;
  }
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

  // Log to console
  console.error(formattedMessage);

  // Log to file if enabled
  if (logToFile) {
    fs.appendFileSync(logFilePath, formattedMessage + '\n', 'utf8');
  }
} 