const { sendError } = require('../utils/response');

/**
 * Zod validation middleware factory
 * Usage: router.post('/register', validate(registerSchema), controller)
 */
const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);

  if (!result.success) {
    // Format Zod errors into a clean object
    const errors = result.error.errors.reduce((acc, err) => {
      const field = err.path.join('.');
      acc[field] = err.message;
      return acc;
    }, {});

    return sendError(res, 422, 'Validation failed', errors);
  }

  // Replace req.body with the validated + sanitized data
  req.body = result.data;
  next();
};

module.exports = validate;
