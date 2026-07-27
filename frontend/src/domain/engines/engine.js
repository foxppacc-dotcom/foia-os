// FOIA OS v2 — Base Engine Interface
// Every engine extends this for consistency
// Pure business logic only — No React, No Express, No SQL, No HTTP

export class DomainEngine {
  constructor(name) {
    this.name = name;
    this._validators = [];
  }

  // Register a validation rule
  addValidator(fn) {
    this._validators.push(fn);
  }

  // Run all validators — returns { valid: boolean, errors: string[] }
  validate(context) {
    const errors = [];
    for (const fn of this._validators) {
      const result = fn(context);
      if (result !== true) errors.push(result);
    }
    return { valid: errors.length === 0, errors };
  }

  // Log an activity — engines call this, ActivityEngine handles storage
  log(activityEngine, action) {
    if (activityEngine) activityEngine.record(action);
  }
}

// Utility: check if a transition is valid in a linear lifecycle
export function validateLinearTransition(current, target, stages, allowedBackward = false) {
  const currentIdx = stages.indexOf(current);
  const targetIdx = stages.indexOf(target);
  if (currentIdx === -1) return { valid: false, reason: `Unknown current stage: ${current}` };
  if (targetIdx === -1) return { valid: false, reason: `Unknown target stage: ${target}` };
  if (targetIdx < currentIdx && !allowedBackward) {
    return { valid: false, reason: 'Backward transition not allowed' };
  }
  return { valid: true };
}

// Utility: derive legacy status from investigation stage
export function deriveLegacyStatus(stage) {
  const MAP = {
    planning: 'open', research: 'open',
    requests: 'in_progress', waiting: 'in_progress',
    collection: 'in_progress', verification: 'in_progress',
    ready: 'in_progress', archived: 'closed',
  };
  return MAP[stage] || 'open';
}
