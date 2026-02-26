import { encode, decode } from "@msgpack/msgpack";
import { Buffer } from "node:buffer";
import { HuopaNetPacket, VERSION, HuopaNetUrlObject } from "./core.ts";

interface DNSStoreItem extends HuopaNetUrlObject {
    auth: string;
    ip: string;
}

interface IPStoreItem {
    ip: string;
    lastRegister: number;
}

const kv = await Deno.openKv();

let DNSStore: Record<string, DNSStoreItem> = {};
let registrationIps: Array<IPStoreItem> = [];

try {
    const t = await kv.get<Uint8Array>(["dnsstore"]);
    const ips = await kv.get<Uint8Array>(["registrationips"])
    if (t?.value)
        DNSStore = decode(t.value) as Record<string, DNSStoreItem>;
    if (ips?.value)
        registrationIps = decode(ips.value) as Array<IPStoreItem>;
        
} catch {
    await kv.set(["dnsstore"], encode(DNSStore));
    await kv.set(["registrationips"], encode(registrationIps));
}

interface HuopaNetDNSResolveRequest extends HuopaNetPacket, HuopaNetUrlObject {
    version: number;
    secure: boolean;
};

export interface HuopaNetDNSRegisterRequest extends HuopaNetPacket {
    version: number;
    secure: boolean;
    hnwp: HuopaNetUrlObject;
    http: HuopaNetUrlObject;
    key: string;
};

export class HuopaNetDNSServer {

    constructor(port: number = 3000) {
        Deno.serve({ port }, (req, info) => {
            if (req.headers.get("upgrade") !== "websocket") {
                return new Response("Not a websocket upgrade", { status: 426 });
            }

            const ip = info.remoteAddr.hostname;

            const { socket: s, response } = Deno.upgradeWebSocket(req);

            s.onopen = () => {
                console.log("Client connected");
            };

            s.onmessage = async(r: MessageEvent)=> {
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
                    return s.send(encode({
                        cmd: "dns_error",
                        ok: false,
                        error: "BAD_REQUEST",
                        code: 0,
                        body: `Invalid format`
                    }));
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
                                const { auth: _, ip: __, ...re } = da;
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
                        
                        if (!o || !o.key || !o.cmd || !o.secure || !o.version || !o.http || !o.hnwp || !o.http.domain || !o.http.path || !o.hnwp.domain || !o.hnwp.path)
                            return s.send(encode({
                                cmd: "dns_error",
                                ok: false,
                                error: "BAD_REQUEST",
                                code: 0,
                                body: `Invalid format`
                            }));
                        
                        if (o.key.length < 32)
                            return s.send(encode({
                                cmd: "dns_error",
                                ok: false,
                                error: "BAD_REQUEST",
                                code: 0,
                                body: `Expected 32 or more characters for the DNS registration auth key`
                            }));
                            
                        const url: string = `${o.hnwp.subdomain ? `${o.hnwp.subdomain}.` : ""}${o.hnwp.domain}`;
                        const domain: string = o.hnwp.domain;
                        const da = DNSStore[url];
                        if (da) {
                            if (da.auth !== o.key) 
                                return s.send(encode({
                                    cmd: "dns_register",
                                    ok: false,
                                    error: "DOMAIN_ALREADY_REGISTERED",
                                    code: 2,
                                    body: `Domain ${url} already registered under different key`
                                }));
                        }

                        const last = registrationIps.find(r => r.ip == ip);
                        if (last?.lastRegister && last.lastRegister > Date.now() - 86400000) {
                            return s.send(encode({
                                cmd: "dns_register",
                                ok: false,
                                error: "RATE_LIMIT",
                                code: 5,
                                body: `You have already registered a domain in the previous 24 hours, please wait ${Math.round(((Date.now() - 86400000) - last.lastRegister) / 360000)} more hours`
                            }));
                        }

                        if (o.hnwp.subdomain) {
                            const mainDomainData = DNSStore[domain];
                            if (mainDomainData.auth !== o.key)
                                return s.send(encode({
                                    cmd: "dns_register",
                                    ok: false,
                                    error: "NOT_IMPLEMENTED",
                                    code: 4,
                                    body: `Too lazy to implement this yet, please don't register subdomains with a different key than the main domain's key`
                                }));
                        }

                        DNSStore[url] = { ...o.http, auth: o.key, ip };

                        console.log(`[${ip}] Registered domain ${url}, HTTP domain ${JSON.stringify(o.http)}`);

                        return s.send(encode({
                            cmd: "dns_register",
                            ok: true,
                            body: `Registered domain sucesssfully`
                        }));
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

            return response;
        });
    };
};

const _app = new HuopaNetDNSServer(3000);