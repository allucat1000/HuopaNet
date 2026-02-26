# Encoding protocol

HuopaNet uses [MsgPack](<https://msgpack.org/>) for communication packets, as it cleanly supports binary, opposed to vanilla JSON.

# Basic request to resolved HTTP server URL

Client connects to server WebSocket and sends request packet (encoded with MsgPack), example below:
```json
{
    "cmd":"request",
    "version":1,
    "secure":false,
    "subdomain":"example",
    "path":["greeting"],
    "request":"get",
    "query":{"name":"User"}
}
```
Server responds with result packet, example:
```json
{
    "cmd":"response",
    "version":1,
    "secure":false,
    "metadata":{
        "content-type":"text/plain"
    },
    "body":"Hello User!"
}
```

# Resolving HTTP server URL through DNS server

Client sends a DNS resolve HTTP request to chosen DNS server, packet:
```json
{
    "version": 1,
    "secure": false,
    "cmd":"dns_resolve",
    "protocol":"hnwp",
    "domain":"example.org",
    "subdomain":"hello",
    "path":["hello.xml"]
}
```

DNS server responds with resolved URL:
```json
{
    "cmd":"dns_resolve",
    "ok": true,
    "body": {
        "subdomain":null,
        "domain":"localhost",
        "port":8080,
        "path":[],
        "protocol":"http",
    }
}
```

# Registering HuopaNet server to DNS server

Webserver sends registration packet to DNS server containing both domains and safety key, packet:
```json
{
    "cmd":"dns_register",
    "hnwp": {
        "domain":"example.org",
        "protocol":"hnwp",
        "subdomain":null
    },
    "http": {
        "protocol":"http",
        "domain":"localhost",
        "port":8080,
        "subdomain":null,
        "path":[]
    },
    "key":"a1b2c3d4e5f6g7h8a1b2c3d4e5f6g7h8"
}
```

DNS server registers domain using the given key (32 characters long). In order to register subdomain, main domain must be registered first.
When registering a subdomain, you may use the same authentication key as the main domain or use an alternative authentication key and have the subdomain registration be permitted / unpermitted by the main domain.

If a subdomain does not share the same key as the main domain, a packet will be sent over to the main domain from the DNS server asking whether to allow the registration of the subdomain, as shown below:
```json
{
    "cmd":"dns_subdomain_register",
    "http": {
        "protocol":"http",
        "domain":"localhost",
        "port":8000,
        "subdomain":null,
        "path":["server"]
    },
    "hnwp": {
        "domain":"example.org",
        "protocol":"hnwp",
        "subdomain":"hi"
    },
    "key":"8h7g6f5e4d3c2b1a8h7g6f5e4d3c2b1a"
}
```

The main domain server may either accept:
```json
{
    "cmd":"dns_allow_subdomain_register",
    "main": {
        "domain":"example.org",
        "protocol":"hnwp",
        "subdomain":null,
        "key":"a1b2c3d4e5f6g7h8a1b2c3d4e5f6g7h8"
    },-
    "sub": {
        "domain":"example.org",
        "protocol":"hnwp",
        "subdomain":"hi"
    }
}
```
Or deny:
```json
{
    "cmd":"dns_deny_subdomain_register",
    "main": {
        "domain":"example.org",
        "protocol":"hnwp",
        "subdomain":null,
        "key":"a1b2c3d4e5f6g7h8a1b2c3d4e5f6g7h8"
    },
    "sub": {
        "domain":"example.org",
        "protocol":"hnwp",
        "subdomain":"hi"
    }
}
```