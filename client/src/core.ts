import { encode, decode } from "@msgpack/msgpack";

const VERSION = 1;

export interface HuopaNetUrlObject {
  domain: string;
  subdomain?: string | null;
  path: Array<string>;
  protocol: string;
  port?: number;
}

type FunctionResult<T> = { ok: true; value: T } | { ok: false; error: string; code?: number };

export interface HuopaNetPacket {
  cmd: string;
  [k: string]: any;
}

interface HuopaNetDNSResolveRequest extends HuopaNetPacket, HuopaNetUrlObject {
    version: number;
    secure: boolean;
};

export interface HuopaNetResponse extends HuopaNetPacket {
  version: number;
  secure: boolean;
  code: number;
  ok: boolean;
  metadata: object;
  body?: any;
}

export interface HuopaNetRequest extends HuopaNetPacket, HuopaNetUrlObject {
  version: number;
  secure: boolean;
  metadata: object;
  body?: any;
}

interface HuopaNetDNSResolveResponse extends HuopaNetPacket {                   
    ok: boolean
    error?: string
    code?: number,
    body: string | HuopaNetUrlObject;
}

function trimArr(arr: Array<string>) {
  let start = 0;
  let end = arr.length - 1;

  while (start <= end && arr[start] === "") start++;
  while (end >= start && arr[end] === "") end--;

  return arr.slice(start, end + 1);
}

export class HuopaNetResponseFunctions {
    private obj;
    constructor(obj: HuopaNetResponse) {
        this.obj = obj;
        this.ok = this.obj.ok;
        this.status = this.obj.code;
        this.version = this.obj.version;
        this.secure = this.obj.secure;
        this.headers = this.obj.metadata;
    }

    headers: object;

    secure: boolean;

    version: number;

    status: number;

    ok: boolean;

    async text(): Promise<string> {
        const body = this.obj.body;

        if (typeof body === "string") {
            return body;
        }

        if (typeof Blob !== "undefined" && body instanceof Blob) {
            return await body.text();
        }

        if (body instanceof ArrayBuffer) {
            return new TextDecoder("utf-8").decode(body);
        }

        if (ArrayBuffer.isView(body)) {
            return new TextDecoder("utf-8").decode(body.buffer);
        }

        if (typeof body === "object") {
            try {
                return JSON.stringify(body);
            } catch {
                return String(body);
            }
        }

        return String(body);
    }

    json(): object {
        return JSON.parse(this.obj.body);
    }
}

export class HuopaNetClient {
    parseUrl(url: string): HuopaNetUrlObject | null {
        let u;
        try {
            u = new URL(url);
        } catch {
            return null;
        }
        const a = u.host.split(".");
        const domain = a.slice(a.length - 2).join(".");
        return {
            domain,
            path: trimArr(u.pathname.split("/")),
            protocol: u.protocol.split(":")[0],
            subdomain: a.length === 3 ? a[0] : null
        }
    }

    async resolveURLRaw(url: HuopaNetUrlObject, dns: string): Promise<FunctionResult<string>> {
        return await new Promise((resolve) => {
            const ws = new WebSocket(dns);
            ws.onopen = () => {
                const obj: HuopaNetDNSResolveRequest = {
                    version: VERSION,
                    secure: false,
                    cmd: "dns_resolve",
                    ...url
                };
                ws.send(encode(obj));
            }
            ws.onmessage = async(raw) => {
                try {
                    const buffer = await (raw.data as Blob).arrayBuffer();
                    const bytes = new Uint8Array(buffer);
                    const data = decode(bytes) as HuopaNetPacket;
                    switch (data.cmd) {
                        case "dns_resolve": {
                            const o = data as HuopaNetDNSResolveResponse;
                            if (o.ok && typeof o.body !== "string") {
                                const url = `${o.body.protocol}://${o.body.domain}${o.body.port ? `:${o.body.port}` : ""}/${o.body.path.join("/")}`;
                                resolve({ ok: true, value: url });
                            } else {
                                resolve({
                                    ok: false,
                                    error: o.error ?? "DNS resolve failed",
                                    code: o.code
                                });
                            }
                            ws.close();
                            break;
                        }

                        case "dns_error": {
                            resolve({ ok: false, error: "DNS server returned error" });
                            ws.close();
                            break;
                        }

                        default: {
                            resolve({
                                ok: false,
                                error: "Invalid CMD: " + data.cmd
                            });
                            ws.close();
                        }
                    }
                } catch {
                    resolve({ ok: false, error: "Malformed DNS response" });
                }
            };
        });
    }
    
    async resolveURL(url: string, dns: string) {
        const o = this.parseUrl(url); 
        if (o)
            return await this.resolveURLRaw(o, dns);
        else
            throw new Error("Unable to parse invalid URL");
    }

    async fetchRaw(url: HuopaNetUrlObject, resolved: string): Promise<FunctionResult<HuopaNetResponse>> {
        return new Promise((resolve) => {
            const ws = new WebSocket(resolved);

            ws.onerror = () => {
            resolve({ ok: false, error: "WebSocket connection failed" });
            };

            ws.onopen = () => {
            const obj: HuopaNetRequest = {
                version: VERSION,
                secure: false,
                metadata: {},
                ...url,
                cmd: "request"
            };
            ws.send(encode(obj));
            };

            ws.onmessage = async (raw) => {
            try {
                const buffer = await (raw.data as Blob).arrayBuffer();
                const bytes = new Uint8Array(buffer);
                const data = decode(bytes) as HuopaNetPacket;

                if (data.cmd === "response") {
                resolve({ ok: true, value: data as HuopaNetResponse });
                } else {
                resolve({
                    ok: false,
                    error: "Invalid CMD: " + data.cmd
                });
                }
                ws.close();
            } catch {
                resolve({ ok: false, error: "Malformed response" });
            }
            };
        });
    }
    async fetch(url: string, dns: string): Promise<HuopaNetResponseFunctions> {
        const o = this.parseUrl(url); 
        if (o) {
            const d = await this.resolveURLRaw(o, dns);
            if (d.ok) {
                const r = await this.fetchRaw(o, d.value);
                if (!r.ok) 
                    return new HuopaNetResponseFunctions({ version: VERSION, secure: false, ok: false, code: 400, cmd: "response", body: r.error, metadata: {} });

                const res = new HuopaNetResponseFunctions(r.value);
                return res;
            } else
                return new HuopaNetResponseFunctions({ version: VERSION, secure: false, ok: false, code: 400, cmd: "response", body: d.error, metadata: {} });
        } else
            throw new Error("Unable to parse invalid URL");
    }
}