import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const modelDir = path.join(root, "model");

function parseJsonOutput(raw) {
  const text = String(raw || "").trim();
  if (!text) return { state: "FAILURE", message: "No output" };
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return { state: "FAILURE", message: text.slice(0, 2000) };
      }
    }
    return { state: "FAILURE", message: text.slice(0, 2000) };
  }
}

function runPython(scriptName, args = [], timeoutMs = 120000) {
  return new Promise((resolve) => {
    const scriptPath = path.join(modelDir, scriptName);
    const child = spawn(process.env.PYTHON || "python3", [scriptPath, ...args], { cwd: modelDir });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      resolve(payload);
    };

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish({ state: "FAILURE", message: `Local capability timed out after ${timeoutMs}ms`, script: scriptName, args });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const parsed = parseJsonOutput(stdout || stderr);
      if (parsed && typeof parsed === "object" && "state" in parsed) {
        finish({ ...parsed, script: scriptName, exitCode: code });
        return;
      }
      finish({ state: code === 0 ? "SUCCESS" : "FAILURE", message: stdout || stderr || `exit ${code}`, script: scriptName, exitCode: code });
    });
  });
}

export class LocalCapabilityRouter {
  constructor() {
    this.name = "forge-local";
  }

  classifyTask(task, prompt = "") {
    const source = `${task || ""} ${prompt || ""}`.toLowerCase();
    if (/json|schema|extract|structured|html|parse/.test(source)) return { script: "forgestructured.py", task: "json" };
    if (/code|fix|repair|patch|python|bug|implement/.test(source)) return { script: "forgecode.py", task: "code" };
    if (/reason|compare|analyze|plan|why|decision|strategy|tradeoff/.test(source)) return { script: "forgereason.py", task: "reasoning" };
    if (/chat|hello|explain|summarize|answer|question/.test(source)) return { script: "self_sufficient.py", task: "chat" };
    return { script: "self_sufficient.py", task: "chat" };
  }

  async routeTask(task, prompt = "", context = "") {
    const kind = this.classifyTask(task, prompt);

    if (kind.script === "forgecode.py") {
      return runPython("forgecode.py", ["--task", String(prompt || task || "write a local helper")], 120000);
    }

    if (kind.script === "forgereason.py") {
      return runPython("forgereason.py", ["--problem", String(prompt || task || "explain the tradeoff"), "--context", String(context || "")], 120000);
    }

    if (kind.script === "forgestructured.py") {
      const payload = String(prompt || task || "{\"name\":\"demo\"}");
      return runPython("forgestructured.py", ["--text", payload], 120000);
    }

    return runPython("self_sufficient.py", ["chat", "--prompt", String(prompt || task || "hello"), "--context", String(context || ""), "--max-tokens", "128"], 120000);
  }

  async generate(task, prompt = "", context = "") {
    return this.routeTask(task, prompt, context);
  }
}

export default LocalCapabilityRouter;
