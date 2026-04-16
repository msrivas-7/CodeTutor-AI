import { parseCsv, summarize } from "./csv.js";

const raw = `name,score
alice,92
bob,78
carol,85
dave,64
eve,90`;

const rows = parseCsv(raw);
const stats = summarize(rows.map((r) => Number(r.score)));

console.log(`rows   : ${rows.length}`);
console.log(`mean   : ${stats.mean.toFixed(2)}`);
console.log(`min    : ${stats.min}`);
console.log(`max    : ${stats.max}`);
