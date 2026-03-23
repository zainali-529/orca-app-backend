const { verifyAccessToken } = require('../utils/jwt');
const User = require('../models/User');
const { sendError } = require('../utils/response');

/**
 * isAdmin middleware
 *
 * Must be used AFTER protect middleware.
 * Checks that req.user.role === 'admin'.
 *
 * Usage:
 *   router.use(protect, isAdmin);
 *   // OR per-route:
 *   router.get('/stats', protect, isAdmin, controller);
 */
const isAdmin = (req, res, next) => {
  if (!req.user) {
    return sendError(res, 401, 'Authentication required');
  }
  if (req.user.role !== 'admin') {
    return sendError(res, 403, 'Admin access required');
  }
  next();
};

/**
 * Combined: protect + isAdmin in one middleware
 * Convenience shorthand for admin-only routes.
 */
const adminGuard = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return sendError(res, 401, 'Access token is missing or invalid');
    }

    const token = authHeader.split(' ')[1];
    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return sendError(res, 401, 'Access token has expired. Please refresh.');
      }
      return sendError(res, 401, 'Invalid access token');
    }

    const user = await User.findById(decoded.sub);
    if (!user)          return sendError(res, 401, 'User no longer exists');
    if (!user.isActive) return sendError(res, 403, 'Account deactivated');
    if (user.role !== 'admin') return sendError(res, 403, 'Admin access required');

    req.user = user;
    next();
  } catch (error) {
    return sendError(res, 500, 'Authentication error');
  }
};

module.exports = { isAdmin, adminGuard };