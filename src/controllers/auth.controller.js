const authService = require('../services/auth.service');
const { sendSuccess, sendError } = require('../utils/response');

/**
 * POST /api/auth/register
 */
const register = async (req, res) => {
  try {
    const { firstName, lastName, email, phone, password } = req.body;

    const user = await authService.registerUser({ firstName, lastName, email, phone, password });

    return sendSuccess(res, 201, 'Account created successfully', {
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    return sendError(res, error.statusCode || 500, error.message);
  }
};

/**
 * POST /api/auth/login
 */
const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const userAgent = req.headers['user-agent'];
    const ipAddress = req.ip;

    const { user, accessToken, refreshToken } = await authService.loginUser({
      email,
      password,
      userAgent,
      ipAddress,
    });

    return sendSuccess(res, 200, 'Login successful', {
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        isVerified: user.isVerified,
        lastLoginAt: user.lastLoginAt,
      },
      accessToken,
      refreshToken,
    });
  } catch (error) {
    return sendError(res, error.statusCode || 500, error.message);
  }
};

/**
 * POST /api/auth/refresh
 * Body: { refreshToken }
 */
const refresh = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return sendError(res, 400, 'Refresh token is required');
    }

    const { user, accessToken, refreshToken: newRefreshToken } =
      await authService.refreshAccessToken(refreshToken);

    return sendSuccess(res, 200, 'Token refreshed', {
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
      },
      accessToken,
      refreshToken: newRefreshToken,
    });
  } catch (error) {
    return sendError(res, error.statusCode || 500, error.message);
  }
};

/**
 * POST /api/auth/logout
 * Body: { refreshToken }
 */
const logout = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    await authService.logoutUser(refreshToken);
    return sendSuccess(res, 200, 'Logged out successfully');
  } catch (error) {
    return sendError(res, 500, 'Logout failed');
  }
};

/**
 * POST /api/auth/logout-all
 * Protected route — revokes all devices
 */
const logoutAll = async (req, res) => {
  try {
    await authService.logoutAllDevices(req.user._id);
    return sendSuccess(res, 200, 'Logged out from all devices successfully');
  } catch (error) {
    return sendError(res, 500, 'Logout failed');
  }
};

/**
 * GET /api/auth/me
 * Protected — returns current logged-in user
 */
const getMe = async (req, res) => {
  return sendSuccess(res, 200, 'User fetched', {
    user: {
      id: req.user._id,
      firstName: req.user.firstName,
      lastName: req.user.lastName,
      email: req.user.email,
      phone: req.user.phone,
      isVerified: req.user.isVerified,
      lastLoginAt: req.user.lastLoginAt,
      createdAt: req.user.createdAt,
    },
  });
};

module.exports = { register, login, refresh, logout, logoutAll, getMe };
