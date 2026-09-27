export const TRUTH_STATES = Object.freeze([
  "SUCCESS", "FAILURE", "PARTIAL", "UNKNOWN", "UNAVAILABLE",
  "BLOCKED", "DENIED", "CANCELLED", "TIMEOUT", "ERROR", "ESCALATED"
]);

export function truthResult(state, message, evidence = []) {
  if (!TRUTH_STATES.includes(state)) throw new Error(`Invalid truth state: ${state}`);
  return { state, message, evidence, at: new Date().toISOString() };
}
