const winston = require('winston');
const path = require('path');
const os = require('os');

class Logger {
  constructor() {
    const logDir = path.join(os.homedir(), '.Vysper', 'logs');
    const logFormat = winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} ${level.toUpperCase()} ${message}`;
    });

    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        logFormat
      ),
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(winston.format.colorize(), logFormat)
        })
      ]
    });
  }

  createServiceLogger(serviceName) {
    return {
      debug: (msg, meta = {}) => this.logger.debug(`[${serviceName}] ${msg}`, meta),
      info: (msg, meta = {}) => this.logger.info(`[${serviceName}] ${msg}`, meta),
      warn: (msg, meta = {}) => this.logger.warn(`[${serviceName}] ${msg}`, meta),
      error: (msg, meta = {}) => this.logger.error(`[${serviceName}] ${msg}`, meta),
      logPerformance: (operation, startTime, meta = {}) => {
        const duration = Date.now() - startTime;
        this.logger.info(`[${serviceName}] ${operation} completed in ${duration}ms`, meta);
      }
    };
  }
}

module.exports = new Logger(); 