import { HuopaNetServer, HuopaNetRequest, HuopaNetResponseFunctions } from "./core.ts";

const auth = Deno.env.get("DNS_AUTH_KEY");

const app = new HuopaNetServer({ domain: "example.com", path: [], protocol: "hnwp"}, 8000);

if (auth)
    app.registerDNS({
        hnwp: { domain: "example.com", path: [], protocol: "hnwp"},
        http: { domain: "localhost", port: 8000, path: [], protocol: "http" },
        key: auth,

    }, "https://huopanet.allucat1000.deno.net/");

app.get = (req: HuopaNetRequest, res: HuopaNetResponseFunctions) => {
    if (req.path.length === 0 && !req.subdomain) {
        res.send(`<root backgroundColor="#222222" color="#fff">
    <metadata>
        <title>Hello, World!</title>
    </metadata>
    <text size="32" margin="32" id="greeting">Hello!</text>
    <cont marginLeft="32" id="cont">
        <noscript><text color="rgb(255, 66, 66)">Your HuopaNet browser does not seem to support the capability of using script tags to execute Lua code.</text></noscript>
        <text>This is an example HuopaNet webpage <text color="#f00">red inline text :scary:</text></text>
        <link color="#0af" src="hnwp://example.com/hi">This is a link</link>
        <link color="rgb(119, 0, 255)" src="hnwp://test.example.com/">Nonexistent link address</link>
        <text marginTop="32" size="12" color="#888">smaller gray text with a margin</text>
    </cont>
    <script src="hnwp://example.com/main.lua"></script>
</root>`);
    } else if (req.path.length === 1 && req.path[0] === "main.lua") {
        res.send(`local cont = document:getElementById("cont")
local el = document:createElement("text")

cont:prependChild(el);

local s = "Hello! This text is shown using Lua code! You can put Lua code inside a script tag and the code'll get executed!"
local i = 1

function loop()
    if i > #s then
        return
    end

    el.textContent = string.sub(s, 1, i)
    i = i + 1

    sleep(50):await()
    loop()
end

local r = fetch("hnwp://example.com/hi"):await()
print(r.text():await())

loop()`);
    } else {
        console.log("404!", req.path);
        res.sendStatus('<text size="32">404!</text>', 404);
    }
}
