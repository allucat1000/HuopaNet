import { HuopaNetClient } from "./core.ts";

const app = new HuopaNetClient();
const r = await app.fetch("hnwp://example.com/", "https://huopanet.allucat1000.deno.net/");
console.log(r.ok);
console.log(await r.text());