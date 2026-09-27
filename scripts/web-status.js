import path from "node:path";import {fileURLToPath} from "node:url";import {WebCorpus} from "../src/web-corpus.js";
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));const fake={list:()=>[],add:()=>({id:null})};console.log(JSON.stringify(new WebCorpus({root,store:fake,audit:null}).status(),null,2));
