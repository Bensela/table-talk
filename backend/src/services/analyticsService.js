import winston from 'winston';

// Logger configuration
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'table-talk-analytics' },
  transports: [
    // Write all logs with importance level of `error` or less to `error.log`
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    // Write all logs with importance level of `info` or less to `combined.log`
    new winston.transports.File({ filename: 'logs/analytics.log' }),
  ],
});

// If we're not in production then log to the `console` with the format:
// `${info.level}: ${info.message} JSON.stringify({ ...rest }) `
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple(),
  }));
}

// Analytics wrapper to ensure privacy
export const logEvent = (eventName, sessionData = {}) => {
  const { id, mode, currentQuestionIndex } = sessionData;
  
  // Explicitly construct payload to avoid leaking PII or raw request data
  const payload = {
    event: eventName,
    session_id: id, // Anonymous ID
    timestamp: new Date().toISOString(),
    // Contextual data allowed
    mode: mode || 'unknown',
    question_index: currentQuestionIndex,
  };

  logger.info('Analytics Event', payload);
};

export default logger;
