import { encodeIU, decodeIU } from "./iubin.js";
export {createTransferEnvelope,verifyTransferEnvelope} from "./contracts.js";
export function exportKnowledgeRecord(record){const binary=encodeIU(record);return {format:"IUB1",encoding:"base64",bytes:binary.length,data:binary.toString("base64")};}
export function importKnowledgeRecord(payload){if(payload?.format!=="IUB1"||payload?.encoding!=="base64")throw new Error("Unsupported knowledge transport format");return decodeIU(Buffer.from(String(payload.data||""),"base64"));}
