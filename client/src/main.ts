import { HuopaNetClient } from "./core.ts";

const app = new HuopaNetClient();
const r = await app.fetch("hnwp://example.com/", "http://localhost:3000/");
console.log(await r.text());