import WebSocket, { WebSocketServer } from 'ws';
import { encode, decode } from "@msgpack/msgpack";
import { MessageEvent } from 'ws';
import { Buffer } from "node:buffer";

export const VERSION = 1;

export interface HuopaNetPacket {
  cmd: string;
  // deno-lint-ignore no-explicit-any
  [k: string]: any;
}

export interface HuopaNetResponse extends HuopaNetPacket {
  version: number;
  secure: boolean;
  code: number;
  ok: boolean;
  metadata: object;
  // deno-lint-ignore no-explicit-any
  body?: any;
}

export interface HuopaNetRequest extends HuopaNetPacket, HuopaNetUrlObject {
  version: number;
  secure: boolean;
  metadata: object;
  // deno-lint-ignore no-explicit-any
  body?: any;
}

export interface HuopaNetUrlObject {
  domain: string;
  subdomain?: string | null;
  path: Array<string>;
  protocol: string;
  port?: number;
}

export class HuopaNetResponseFunctions {
  private ws: WebSocket;
  constructor(ws: WebSocket) {
    this.ws = ws;
  }

  send(str: string) {
    this.ws.send(encode({
      cmd: "response",
      version: VERSION,
      secure: false,
      code: 200,
      metadata: {},
      ok: true,
      body: str
    }))
  }

  sendStatus(str: string, status: number, ok: boolean = true) {
    this.ws.send(encode({
      cmd: "response",
      version: VERSION,
      secure: false,
      code: status,
      metadata: {},
      ok,
      body: str
    }))
  }

  status(status: number, ok: boolean) {
    this.ws.send(encode({
      cmd: "response",
      version: VERSION,
      secure: false,
      code: status,
      metadata: {},
      ok,
      body: ""
    }))
  }

  json(d: object) {
    this.ws.send(encode({
      cmd: "response",
      version: VERSION,
      secure: false,
      code: 200,
      metadata: {
        "content-type":"application/json"
      },
      ok: true,
      body: d
    }))
  }

  jsonStatus(d: object, status: number, ok: boolean = true) {
    this.ws.send(encode({
      cmd: "response",
      version: VERSION,
      secure: false,
      code: status,
      metadata: {
        "content-type":"application/json"
      },
      ok,
      body: d
    }))
  }

}

export class HuopaNetServer {

  private error(err?: string, code = 400): HuopaNetResponse {
    return {
      cmd: "response",
      version: VERSION,
      secure: false,
      code,
      metadata: {},
      ok: false,
      body: err
    };
  };

  url: HuopaNetUrlObject;

  private wss: WebSocketServer;
  constructor(url: HuopaNetUrlObject, port: number = 8080) {
    this.url = url;
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

    this.wss.on("error", (err: Error) => {
      console.error("WebSocket failed to bind:", err);
    });

    this.wss.on("connection", (s: WebSocket) => {
      console.log("Client connected");
      this.onConnection(s);
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
          return s.send(encode(this.error("Invalid packet object sent")));;
        }
        const p = d as HuopaNetPacket;
        switch (p.cmd) {
          case "request": {
            const o = p as HuopaNetRequest;
            if (o.version < VERSION)
              return s.send(encode(this.error("Outdated client version")));;
            
            const res = new HuopaNetResponseFunctions(s);
            this.get(o, res);
            break;
          }
          case "response": { // the server shouldn't get this
            return;
          }
          default: {
            return s.send(encode(this.error("Got unknown packet")));;
          }
        }
      };
    });
  }

  onConnection = (_s: WebSocket) => {};

  get = (_req: HuopaNetRequest, _res: HuopaNetResponseFunctions) => {}
}