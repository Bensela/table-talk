const joinAttempts = new Map();

const joinRateLimiter = (req, res, next) => {
  const clientIp = req.ip || req.connection.remoteAddress;
  const attempts = joinAttempts.get(clientIp) || { count: 0, resetAt: Date.now() + 60000 };
  
  if (Date.now() > attempts.resetAt) {
    attempts.count = 0;
    attempts.resetAt = Date.now() + 60000;
  }
  
  if (attempts.count >= 5) {
    return res.status(429).json({ 
      error: 'Too many join attempts. Please wait 1 minute.' 
    });
  }
  
  attempts.count++;
  joinAttempts.set(clientIp, attempts);
  next();
};

module.exports = { joinRateLimiter };
