import fs from "node:fs";
import assert from "node:assert/strict";

const app = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const server = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");

const rendererMap = app.match(/const renderer = \(\{([\s\S]*?)\}\)\[id\];/)?.[1] || "";
assert(rendererMap, "renderLive renderer map missing");

const liveMatch = app.match(/const LIVE = new Set\(\[([^\]]+)\]\)/);
assert(liveMatch, "LIVE workspace registry missing");
const liveIds = [...liveMatch[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
assert(liveIds.length >= 25, "expected broad live workspace coverage");

for (const id of liveIds) {
  assert(rendererMap.includes(id + ": render") || rendererMap.includes(id + ":render"),
    "LIVE workspace has no renderer mapping: " + id);
}

const topControls = ["collapseBtn", "mobileNavBtn", "newChatBtn", "searchBtn", "avatarBtn", "facetClose", "paletteInput", "paletteList", "nav", "main"];
for (const id of topControls) {
  assert(html.includes('id="' + id + '"'), "index missing control #" + id);
  assert(app.includes("#" + id), "app has no binding/reference for #" + id);
}

for (const fn of ["renderChat", "renderConversations", "renderTasks", "renderProjects", "renderAgents", "renderMemory",
  "renderKnowledge", "renderFiles", "renderTools", "renderPermissions", "renderApprovals", "renderSecurity",
  "renderEvidence", "renderGuardian", "renderAudit", "renderCredentials", "renderDevices", "renderStatus",
  "renderSettings", "renderPuter", "renderAutomations", "renderNotifications"]) {
  assert(app.includes("function " + fn + "(") || app.includes("async function " + fn + "("),
    "renderer function missing: " + fn);
}

assert(app.includes("puter.auth.signIn"), "Puter sign-in is not wired");
assert(app.includes("puter.auth.signOut"), "Puter sign-out is not wired");
assert(app.includes("puter.auth.getUser"), "Puter account inspection is not wired");
assert(server.includes("https://api.puter.com"), "Puter API origin missing from server/CSP");
assert(server.includes("'/onechat': '/index.html'"), "/onechat must resolve to the authoritative functional UI");

assert(app.includes("unhandledrejection"), "async UI failures must be surfaced");
assert(app.includes("invalid-json-response"), "API client must surface malformed responses");

console.log("UI control-surface contract passed:", liveIds.length, "live workspaces verified");
