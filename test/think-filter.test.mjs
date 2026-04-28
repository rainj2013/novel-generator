import assert from "node:assert/strict";
import { filterThinkTagsForTest } from "../src/novel-core.js";

const result = filterThinkTagsForTest([
  "正文一<th",
  "ink>这里是",
  "思考过程</thi",
  "nk>正文二",
  "<think>未闭合思考"
]);

assert.equal(result, "正文一正文二");
console.log("ok - filters split think tags from streamed output");
