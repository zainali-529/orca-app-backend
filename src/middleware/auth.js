const { verifyAccessToken } = require('../utils/jwt');
const User = require('../models/User');
const { sendError } = require('../utils/response');

/**
 * Protect middleware — verifies JWT access token
 * Attach user to req.user for use in controllers
 */
const protect = async (req, res, next) => {
  try {
    // 1. Get token from Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return sendError(res, 401, 'Access token is missing or invalid');
    }

    const token = authHeader.split(' ')[1];

    // 2. Verify token
    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return sendError(res, 401, 'Access token has expired. Please refresh.');
      }
      return sendError(res, 401, 'Invalid access token');
    }

    // 3. Check user still exists and is active
    const user = await User.findById(decoded.sub);

    if (!user) {
      return sendError(res, 401, 'User belonging to this token no longer exists');
    }

    if (!user.isActive) {
      return sendError(res, 403, 'Your account has been deactivated. Contact support.');
    }

    // 4. Attach user to request
    req.user = user;
    next();
  } catch (error) {
    return sendError(res, 500, 'Authentication error');
  }
};

module.exports = { protect };
