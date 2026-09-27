import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(__dirname);

export class LocalBenchmarkRunner {
  constructor({ python = process.env.PYTHON || "python3" } = {}) {
    this.python = python;
  }

  run() {
    return new Promise((resolve, reject) => {
      const script = path.join(root, "model", "eval", "run_all.py");
      const child = spawn(this.python, [script], { cwd: root });
      let stdout = "";
      let stderr = "";

      child.stdout.on("data", chunk => { stdout += String(chunk); });
      child.stderr.on("data", chunk => { stderr += String(chunk); });

      child.on("close", code => {
        if (code !== 0) {
          reject({ state: "FAILURE", exitCode: code, stdout, stderr });
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject({ state: "FAILURE", exitCode: code, stdout, stderr, message: "invalid JSON output" });
        }
      });
    });
  }
}

export default LocalBenchmarkRunner;
