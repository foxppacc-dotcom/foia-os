/**
 * Input validation middleware for FOIA OS.
 * Usage: router.post('/cases', requireAuth, validateBody({ title: 'required|string|min:1|max:200' }), handler);
 */
const VALIDATORS = {
  required: (v) => v !== undefined && v !== null && v !== '',
  string: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number' || (!isNaN(v) && v !== ''),
  integer: (v) => Number.isInteger(Number(v)),
  email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
  boolean: (v) => typeof v === 'boolean' || v === 'true' || v === 'false',
  array: (v) => Array.isArray(v),
};

/**
 * Middleware factory: validates request body against a schema.
 * @param {Object} rules - { fieldName: 'required|string|min:3|max:200', ... }
 */
function validateBody(rules) {
  return (req, res, next) => {
    const errors = [];
    for (const [field, ruleStr] of Object.entries(rules)) {
      const value = req.body[field];
      const parts = ruleStr.split('|');
      for (const part of parts) {
        if (part === 'required' && !VALIDATORS.required(value)) {
          errors.push({ field, message: `${field} is required` });
          break;
        }
        if (value === undefined || value === null || value === '') continue;
        if (part.startsWith('min:')) {
          const min = parseInt(part.slice(4));
          if (typeof value === 'string' && value.length < min) errors.push({ field, message: `${field} min ${min} chars` });
          if (typeof value === 'number' && value < min) errors.push({ field, message: `${field} min ${min}` });
        }
        if (part.startsWith('max:')) {
          const max = parseInt(part.slice(4));
          if (typeof value === 'string' && value.length > max) errors.push({ field, message: `${field} max ${max} chars` });
          if (typeof value === 'number' && value > max) errors.push({ field, message: `${field} max ${max}` });
        }
        if (VALIDATORS[part]) {
          if (!VALIDATORS[part](value)) errors.push({ field, message: `${field} must be ${part}` });
        }
        if (part.startsWith('in:')) {
          const options = part.slice(3).split(',');
          if (!options.includes(String(value))) errors.push({ field, message: `${field} must be one of: ${options.join(', ')}` });
        }
      }
    }
    if (errors.length > 0) {
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }
    next();
  };
}

/**
 * Middleware factory: validates URL params.
 */
function validateParams(rules) {
  return (req, res, next) => {
    const errors = [];
    for (const [field, ruleStr] of Object.entries(rules)) {
      const value = req.params[field];
      if (ruleStr === 'integer' && (!value || isNaN(parseInt(value)))) {
        errors.push({ field, message: `${field} must be a valid integer` });
      }
    }
    if (errors.length > 0) return res.status(400).json({ error: 'Invalid parameters', details: errors });
    next();
  };
}

module.exports = { validateBody, validateParams };
