const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const notifyTrigger = require('./notification.trigger.service');  // ← ADD THIS
const {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  getRefreshTokenExpiry,
} = require('../utils/jwt');

/**
 * Register a new user
 */
const registerUser = async ({ firstName, lastName, email, phone, password }) => {
  // Check if email already exists
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    const err = new Error('An account with this email already exists');
    err.statusCode = 409;
    throw err;
  }

  // Create user (password hashed in model pre-save hook)
  const user = await User.create({ firstName, lastName, email, phone, password });
  notifyTrigger.onUserRegistered(user);  // ← ADD THIS (fire & forget)
  return user;
};

/**
 * Login user — returns accessToken + refreshToken
 */
const loginUser = async ({ email, password, userAgent, ipAddress }) => {
  // Find user with password field (select: false by default)
  const user = await User.findOne({ email }).select('+password');

  if (!user) {
    const err = new Error('Invalid email or password');
    err.statusCode = 401;
    throw err;
  }

  if (!user.isActive) {
    const err = new Error('Your account has been deactivated. Contact support.');
    err.statusCode = 403;
    throw err;
  }

  // Verify password
  const isPasswordCorrect = await user.comparePassword(password);
  if (!isPasswordCorrect) {
    const err = new Error('Invalid email or password');
    err.statusCode = 401;
    throw err;
  }

  // Generate tokens
  const accessToken = generateAccessToken(user._id);
  const refreshToken = generateRefreshToken(user._id);

  // Save refresh token to DB
  await RefreshToken.create({
    token: refreshToken,
    user: user._id,
    expiresAt: getRefreshTokenExpiry(),
    userAgent: userAgent || null,
    ipAddress: ipAddress || null,
  });

  // Update last login
  user.lastLoginAt = new Date();
  await user.save({ validateBeforeSave: false });

  return { user, accessToken, refreshToken };
};

/**
 * Refresh access token using a valid refresh token
 */
const refreshAccessToken = async (token) => {
  // 1. Verify JWT signature
  let decoded;
  try {
    decoded = verifyRefreshToken(token);
  } catch {
    const err = new Error('Invalid or expired refresh token. Please log in again.');
    err.statusCode = 401;
    throw err;
  }

  // 2. Check token exists in DB and is not revoked
  const storedToken = await RefreshToken.findOne({ token, isRevoked: false });
  if (!storedToken) {
    const err = new Error('Refresh token not found or already revoked. Please log in again.');
    err.statusCode = 401;
    throw err;
  }

  // 3. Check user still exists
  const user = await User.findById(decoded.sub);
  if (!user || !user.isActive) {
    const err = new Error('User not found. Please log in again.');
    err.statusCode = 401;
    throw err;
  }

  // 4. Rotate: revoke old token, issue new pair
  storedToken.isRevoked = true;
  await storedToken.save();

  const newAccessToken = generateAccessToken(user._id);
  const newRefreshToken = generateRefreshToken(user._id);

  await RefreshToken.create({
    token: newRefreshToken,
    user: user._id,
    expiresAt: getRefreshTokenExpiry(),
    userAgent: storedToken.userAgent,
    ipAddress: storedToken.ipAddress,
  });

  return { user, accessToken: newAccessToken, refreshToken: newRefreshToken };
};

/**
 * Logout — revoke the refresh token
 */
const logoutUser = async (refreshToken) => {
  if (!refreshToken) return;

  await RefreshToken.findOneAndUpdate(
    { token: refreshToken },
    { isRevoked: true }
  );
};

/**
 * Logout from all devices — revoke all user's refresh tokens
 */
const logoutAllDevices = async (userId) => {
  await RefreshToken.updateMany(
    { user: userId, isRevoked: false },
    { isRevoked: true }
  );
};

module.exports = {
  registerUser,
  loginUser,
  refreshAccessToken,
  logoutUser,
  logoutAllDevices,
};
