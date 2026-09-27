import assert from "node:assert/strict";
import fs from "node:fs";

const html=fs.readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
const app=fs.readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
const css=fs.readFileSync(new URL("../public/styles.css",import.meta.url),"utf8");

assert.equal((html.match(/id="composer"/g)||[]).length,1);
assert.equal((html.match(/id="chatIn"/g)||[]).length,1);
assert.ok(html.includes('id="filePicker"'));
assert.ok(html.includes('id="attachmentTray"'));
assert.ok(html.includes('id="attachBtn"'));
assert.ok(!/<textarea[^>]+id="chatIn"[^>]+required/i.test(html));

assert.ok(app.includes('UPLOAD_CHUNK_BYTES=1_500_000'));
assert.ok(app.includes('post("/api/media/upload"'));
assert.ok(app.includes('post("/api/onechat"'));
assert.ok(app.includes('/api/onechat/history'));
assert.ok(app.includes('/api/media/content?id='));
assert.ok(app.includes('data-turn-action'));
assert.ok(app.includes('/api/onechat/retry'));
assert.ok(app.includes('/api/onechat/branch'));
assert.ok(app.includes('/api/onechat/turn-export'));
assert.ok(app.includes('/api/onechat/start'));
assert.ok(app.includes('/api/onechat/events'));
assert.ok(app.includes('/api/onechat/stop'));
assert.ok(app.includes('/api/onechat/resume'));
assert.ok(app.includes('ACTIVE_TURN_KEY'));
assert.ok(app.includes('recoverActiveTurn'));
assert.ok(html.includes('id="stopBtn"'));
assert.ok(app.includes('mediaId:item.mediaId'));
assert.ok(app.includes('attachments:uploaded'));
assert.ok(app.includes('pendingAttachments.length>=MAX_ATTACHMENTS'));
assert.ok(app.includes('item.mediaId'));
assert.ok(css.includes(".attachment-tray"));
assert.ok(css.includes(".upload-bar"));

console.log("onechat attachment UI: ok");
