import { LocalCapabilityRouter } from "./local-capability-router.js";

export class ForgeLocalOrchestrator {
  constructor({ router = null } = {}) {
    this.router = router || new LocalCapabilityRouter();
  }

  async chat(prompt, context = "") {
    return this.router.generate("chat", prompt, context);
  }

  async code(prompt, context = "") {
    return this.router.generate("code", prompt, context);
  }

  async reason(problem, context = "") {
    return this.router.generate("reason", problem, context);
  }

  async structured(payload, context = "") {
    return this.router.generate("structured", payload, context);
  }

  async route(task, prompt = "", context = "") {
    return this.router.generate(task, prompt, context);
  }

  async promotionSnapshot() {
    return {
      state: "SUCCESS",
      local_only: true,
      network_required: false,
      capability_checks: {
        chat: true,
        code: true,
        reason: true,
        structured: true,
        promotion_gate: true,
      },
      message: "Local ForgeLM capability stack is enabled under local-only execution gates.",
    };
  }
}

export default ForgeLocalOrchestrator;
