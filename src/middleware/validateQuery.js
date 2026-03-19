const { sendError } = require('../utils/response');

/**
 * Zod validation middleware for query string parameters.
 * Works identically to validate.js but reads from req.query instead of req.body.
 */
const validateQuery = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.query);

  if (!result.success) {
    const errors = result.error.errors.reduce((acc, err) => {
      const field = err.path.join('.');
      acc[field] = err.message;
      return acc;
    }, {});
    return sendError(res, 422, 'Invalid query parameters', errors);
  }

  // Replace req.query with parsed + defaulted values
  req.query = result.data;
  next();
};

module.exports = validateQuery;
