import { WebSocketServer } from 'ws';
import { encode, decode } from "@msgpack/msgpack";
import { MessageEvent } from 'ws';
import { Buffer } from "node:buffer";
import { HuopaNetPacket, VERSION, HuopaNetUrlObject } from "./core.ts";

interface DNSStoreItem extends HuopaNetUrlObject {
    auth: string;
}

let DNSStore: Record<string, DNSStoreItem> = { "example.com": { auth: "a", "domain":"localhost", "port":8000, path: [], protocol: "http" }};

try {
    const t = await Deno.readFile("dnsstore");
    if (t)
        DNSStore = decode(t) as Record<string, DNSStoreItem>;
        
} catch {
    Deno.writeFile("dnsstore", encode(DNSStore));
}

interface HuopaNetDNSResolveRequest extends HuopaNetPacket, HuopaNetUrlObject {
    version: number;
    secure: boolean;
};

interface HuopaNetDNSRegisterRequest extends HuopaNetPacket {
    version: number;
    secure: boolean;
    hnwp: HuopaNetUrlObject;
    http: HuopaNetUrlObject;
    key: string;
};

interface HuopaNetDNSResolveResponse extends HuopaNetPacket {                   
    ok: boolean
    error?: string
    code?: number,
    body: string | HuopaNetUrlObject;
}

export class HuopaNetDNSServer {
    private wss: WebSocketServer;

    constructor(port: number) {
        this.wss = new WebSocketServer({
            port,
            perMessageDeflate: {
                zlibDeflateOptions: {
                chunkSize: 1024,
                memLevel: 7,
                level: 3
                },
                zlibInflateOptions: {
                chunkSize: 10 * 1024
                },
                clientNoContextTakeover: true,
                serverNoContextTakeover: true,
                serverMaxWindowBits: 10,

                concurrencyLimit: 10,
                threshold: 1024
            }
        });

        this.wss.on("connection", (s: WebSocket) => {
            console.log("Client connected");
            s.onmessage = async (r: MessageEvent) => {
                let bytes: Uint8Array;
        
                if (r.data instanceof ArrayBuffer) {
                    bytes = new Uint8Array(r.data);
                } else if (r.data instanceof Blob) {
                    bytes = new Uint8Array(await r.data.arrayBuffer());
                } else if (typeof r.data === "string") {
                    throw new Error();
                } else {
                    bytes = new Uint8Array(r.data as Buffer);
                }
        
                const d = decode(bytes);
                if (typeof d !== "object" || d === null) {
                    return s.send(encode(encode({
                        cmd: "dns_error",
                        ok: false,
                        error: "BAD_REQUEST",
                        code: 0,
                        body: `Invalid format`
                    })));
                }
                const p = d as HuopaNetPacket;
                switch (p.cmd) {
                    case "dns_resolve": {
                        const o = p as HuopaNetDNSResolveRequest;
                        if (o.version < VERSION)
                            return s.send(encode({
                                cmd: "dns_resolve",
                                ok: false,
                                error: "UNSUPPORTED_VERSION",
                                code: 1,
                                body: `Unsupported version ${o.version}`
                            }));
                        
                        if (o.protocol === "hnwp" && o.domain) {
                            const url: string = `${o.subdomain ? `${o.subdomain}.` : ""}${o.domain}`;
                            const da = DNSStore[url];
                            
                            if (da) {
                                const { auth: _, ...re } = da;
                                const res: HuopaNetUrlObject = re;
                                return s.send(encode({
                                    cmd: "dns_resolve",
                                    body: res,
                                    ok: true
                                }));
                            } else 
                                return s.send(encode({
                                    cmd: "dns_resolve",
                                    ok: false,
                                    error: "NXDOMAIN",
                                    code: 3,
                                    body: "No mapping found for this name"
                                }));
                        } else {
                            if (o.domain)
                                return s.send(encode({
                                    cmd: "dns_resolve",
                                    ok: false,
                                    error: "BAD_REQUEST",
                                    code: 0,
                                    body: "DNS only supports HuopaNet protocol"
                                }));
                            else
                                return s.send(encode({
                                    cmd: "dns_resolve",
                                    ok: false,
                                    error: "BAD_REQUEST",
                                    code: 0,
                                    body: "Expected parameter domain"
                                }));
                        }
                    }

                    case "dns_register": {
                        const o = p as HuopaNetDNSRegisterRequest;
                        if (o.version < VERSION)
                            return s.send(encode({
                                cmd: "dns_register",
                                ok: false,
                                error: "UNSUPPORTED_VERSION",
                                code: 1,
                                body: `Unsupported version ${o.version}`
                            }));
                        

                        break;
                    }
                    
                    default: {
                        return s.send(encode({
                            cmd: "dns_error",
                            ok: false,
                            error: "INVALID_COMMAND",
                            code: 1,
                            body: `Invalid command ${p.cmd}`
                        }));
                    };
                };
            };
        });
    };
};

const _app = new HuopaNetDNSServer(3000);