import type { MirrorSink, MirrorState } from "./popup";

// ---------------------------------------------------------------------------
// Structural types for the Node built-ins this module touches. They are
// obtained through window.require at run time (never bundled), every member
// is optional and guarded before use, and a missing piece degrades to
// "unavailable" instead of a crash (same policy as the @electron/remote
// bridge in popup.ts).
// ---------------------------------------------------------------------------

interface SocketLike {
    destroy?: () => void;
    once?: (event: "close", listener: () => void) => void;
}

interface IncomingMessageLike {
    method?: string;
    url?: string;
    headers?: Record<string, string | string[] | undefined>;
}

interface ServerResponseLike {
    headersSent?: boolean;
    writeHead?: (status: number, headers?: Record<string, string>) => void;
    write?: (chunk: string) => boolean;
    end?: (chunk?: string) => void;
    destroy?: () => void;
    on?: (event: "close", listener: () => void) => void;
}

interface ServerLike {
    listen?: (port: number, host: string, callback: () => void) => void;
    close?: (callback?: () => void) => void;
    on?: ((event: "error", listener: (e: unknown) => void) => void) &
        ((event: "connection", listener: (socket: SocketLike) => void) => void);
    removeListener?: (event: "error", listener: (e: unknown) => void) => void;
}

interface HttpLike {
    createServer?: (handler: (req: IncomingMessageLike, res: ServerResponseLike) => void) => ServerLike;
}

interface ReadStreamLike {
    on?: ((event: "open", listener: () => void) => void) & ((event: "error", listener: (e: unknown) => void) => void);
    pipe?: (destination: ServerResponseLike) => void;
    destroy?: () => void;
}

interface FsLike {
    createReadStream?: (path: string) => ReadStreamLike;
}

interface PathLike {
    resolve?: (...segments: string[]) => string;
    relative?: (from: string, to: string) => string;
    isAbsolute?: (p: string) => boolean;
    extname?: (p: string) => string;
}

function nodeRequire<T>(module: string): T | null {
    try {
        const requireFn = (window as Window & { require?: (module: string) => unknown }).require;
        if (typeof requireFn !== "function") return null;
        const mod = requireFn(module);
        return mod ? (mod as T) : null;
    } catch {
        return null;
    }
}

export type MirrorStartResult = "ok" | "inUse" | "unavailable" | "error";

export const DEFAULT_MIRROR_PORT = 27280;
export const MIRROR_PORT_MIN = 1024;
export const MIRROR_PORT_MAX = 65535;

export function isValidMirrorPort(port: unknown): port is number {
    return (
        typeof port === "number" &&
        Number.isInteger(port) &&
        port >= MIRROR_PORT_MIN &&
        port <= MIRROR_PORT_MAX
    );
}

const HOST = "127.0.0.1";
const PING_MS = 15_000;
/** stop() is synchronous; a following start() waits at most this long for the old socket to close. */
const CLOSE_WAIT_MS = 2_000;

const IMAGE_TYPES: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".bmp": "image/bmp",
    ".avif": "image/avif",
};

/**
 * The viewer page. It renders the popup's own HTML/CSS in a script-less
 * iframe and then replays the popup's DOM snapshots into it, so there is no
 * second UI to keep in sync: whatever the popup shows, this page shows.
 */
const VIEWER_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Popup Review</title>
<style>
html, body { margin: 0; padding: 0; background: transparent; overflow: hidden; }
iframe { border: 0; display: block; background: transparent; transform-origin: 0 0; }
</style>
</head>
<body>
<script>
(function () {
    var frame = null;
    var loaded = false;
    var pendingState = null;
    var fitHeight = 0;
    var lastState = null;

    // Fill the page (e.g. an OBS browser source) by width or height, whichever
    // runs out first, anchored top-left. The answer-side height is part of the
    // fit so the card does not shrink when the answer opens.
    function fit() {
        if (!frame || !lastState) return;
        var h = Math.max(lastState.h, fitHeight);
        var scale = Math.min(window.innerWidth / lastState.w, window.innerHeight / h);
        if (!isFinite(scale) || scale <= 0) scale = 1;
        frame.style.transform = "scale(" + scale + ")";
    }
    window.addEventListener("resize", fit);

    // Card images point at Obsidian's app:// scheme, which a browser cannot
    // load: route them through this server (vault files only).
    function rewrite(html) {
        return html.replace(/src=("|')(app:\\/\\/[^"']*)\\1/g, function (_m, q, url) {
            return "src=" + q + "/resource?u=" + encodeURIComponent(url.replace(/&amp;/g, "&")) + q;
        });
    }
    function removeFrame() {
        if (frame) frame.remove();
        frame = null;
        loaded = false;
        pendingState = null;
        lastState = null;
    }
    function applyState(s) {
        var doc = frame && frame.contentDocument;
        if (!doc || !doc.body) return;
        doc.body.innerHTML = rewrite(s.body);
        doc.body.className = s.bodyClass;
        frame.style.width = s.w + "px";
        frame.style.height = s.h + "px";
        lastState = s;
        fit();
        var content = doc.querySelector(".content");
        if (content) content.scrollTop = s.scroll;
    }

    var source = new EventSource("/events");
    // The server replays the current popup on every (re)connect, so start
    // from a clean slate; a dropped connection (Obsidian closed, feature
    // turned off) must not leave a stale card on screen.
    source.onerror = removeFrame;
    // "open" is also EventSource's built-in connection event (no data).
    source.addEventListener("open", function (e) {
        if (typeof e.data !== "string") { removeFrame(); return; }
        var msg = JSON.parse(e.data);
        removeFrame();
        fitHeight = typeof msg.fitHeight === "number" ? msg.fitHeight : 0;
        var f = document.createElement("iframe");
        // No allow-scripts: the popup's own script must not run here.
        f.setAttribute("sandbox", "allow-same-origin");
        f.addEventListener("load", function () {
            if (frame !== f) return;
            loaded = true;
            if (pendingState) { applyState(pendingState); pendingState = null; }
        });
        f.srcdoc = rewrite(msg.html);
        frame = f;
        document.body.appendChild(f);
    });
    source.addEventListener("state", function (e) {
        if (!frame) return;
        var s = JSON.parse(e.data);
        if (loaded) applyState(s);
        else pendingState = s;
    });
    source.addEventListener("close", removeFrame);
})();
</` + `script>
</body>
</html>`;

/**
 * Local-only HTTP server that mirrors the review popup to a web page
 * (OBS browser source, screen sharing, another browser window).
 *
 * Listens on 127.0.0.1 only. Routes: the viewer page (/), a Server-Sent
 * Events stream of the popup's HTML and DOM snapshots (/events), and card
 * images restricted to files inside the vault (/resource).
 */
export class MirrorServer implements MirrorSink {
    private server: ServerLike | null = null;
    private port = 0;
    private readonly sockets = new Set<SocketLike>();
    private readonly clients = new Set<ServerResponseLike>();
    private pingTimer: number | null = null;
    /** Settles once the previously stopped server has released its port. */
    private closing: Promise<void> = Promise.resolve();
    /** The popup currently on screen; null when there is none. */
    private currentHtml: string | null = null;
    private currentFitHeight = 0;
    private currentState: MirrorState | null = null;

    constructor(
        private diag: (message: string) => void,
        /** Absolute path of the vault folder; null when unknown (images are then not served). */
        private getVaultBasePath: () => string | null,
        /** Whether the plugin wants popups mirrored right now (setting on and server running). */
        private enabled: () => boolean,
    ) {}

    isEnabled(): boolean {
        return this.enabled();
    }

    get isRunning(): boolean {
        return this.server !== null;
    }

    async start(port: number): Promise<MirrorStartResult> {
        this.stop();
        await Promise.race([
            this.closing,
            new Promise<void>((resolve) => window.setTimeout(resolve, CLOSE_WAIT_MS)),
        ]);
        const http = nodeRequire<HttpLike>("http");
        if (typeof http?.createServer !== "function") {
            this.diag("local page: http module unavailable");
            return "unavailable";
        }
        let server: ServerLike;
        try {
            server = http.createServer((req, res) => this.handle(req, res));
        } catch (e) {
            this.diag(`ERROR: local page: could not create server: ${String(e)}`);
            return "error";
        }
        if (typeof server.listen !== "function" || typeof server.on !== "function") {
            this.diag("local page: http server API unavailable");
            return "unavailable";
        }
        const result = await new Promise<MirrorStartResult>((resolve) => {
            const onError = (e: unknown): void => {
                const code = (e as { code?: unknown } | null)?.code;
                if (code === "EADDRINUSE") {
                    // Expected: another app (or another vault) owns the port.
                    this.diag(`local page: port ${port} is already in use`);
                    resolve("inUse");
                } else {
                    this.diag(`ERROR: local page: could not listen on port ${port}: ${String(e)}`);
                    resolve("error");
                }
            };
            try {
                server.on?.("error", onError);
                server.on?.("connection", (socket) => {
                    this.sockets.add(socket);
                    socket.once?.("close", () => this.sockets.delete(socket));
                });
                server.listen?.(port, HOST, () => {
                    server.removeListener?.("error", onError);
                    server.on?.("error", (err) => this.diag(`local page: server error: ${String(err)}`));
                    resolve("ok");
                });
            } catch (e) {
                // e.g. a hand-edited, out-of-range port throws synchronously.
                this.diag(`ERROR: local page: could not listen on port ${port}: ${String(e)}`);
                resolve("error");
            }
        });
        if (result !== "ok") {
            try {
                server.close?.();
            } catch {
                /* never listened */
            }
            return result;
        }
        this.server = server;
        this.port = port;
        this.diag(`local page: listening on http://${HOST}:${port}/`);
        return "ok";
    }

    /** Synchronous so it can run from the main window's beforeunload hook. */
    stop(): void {
        if (this.pingTimer !== null) {
            window.clearInterval(this.pingTimer);
            this.pingTimer = null;
        }
        for (const client of this.clients) {
            try {
                client.end?.();
            } catch {
                /* already gone */
            }
        }
        this.clients.clear();
        const server = this.server;
        this.server = null;
        if (!server) return;
        this.closing = new Promise<void>((resolve) => {
            try {
                server.close?.(() => resolve());
            } catch {
                resolve();
            }
        });
        // Idle keep-alive sockets would otherwise hold the close open.
        for (const socket of this.sockets) {
            try {
                socket.destroy?.();
            } catch {
                /* already gone */
            }
        }
        this.sockets.clear();
        this.diag("local page: stopped");
    }

    open(html: string, fitHeight: number): void {
        this.currentHtml = html;
        this.currentFitHeight = fitHeight;
        this.currentState = null;
        this.broadcast("open", JSON.stringify({ html, fitHeight }));
    }

    state(s: MirrorState): void {
        if (this.currentHtml === null) return;
        this.currentState = s;
        this.broadcast("state", JSON.stringify(s));
    }

    close(): void {
        if (this.currentHtml === null) return;
        this.currentHtml = null;
        this.currentState = null;
        this.broadcast("close", "{}");
    }

    private broadcast(event: string, data: string): void {
        for (const client of this.clients) this.send(client, event, data);
    }

    private send(client: ServerResponseLike, event: string, data: string): void {
        try {
            // JSON.stringify never emits raw newlines, so one data line suffices.
            client.write?.(`event: ${event}\ndata: ${data}\n\n`);
        } catch {
            this.clients.delete(client);
        }
    }

    /**
     * Rejects requests whose Host header is not this loopback address, so a
     * web page using DNS rebinding cannot read the card through the browser.
     */
    private isAllowedHost(req: IncomingMessageLike): boolean {
        const host = req.headers?.host;
        if (typeof host !== "string") return false;
        return host === `${HOST}:${this.port}` || host === `localhost:${this.port}`;
    }

    private handle(req: IncomingMessageLike, res: ServerResponseLike): void {
        try {
            if (!this.isAllowedHost(req)) {
                this.respond(res, 403);
                return;
            }
            if (req.method !== "GET") {
                this.respond(res, 404);
                return;
            }
            const url = new URL(req.url ?? "/", `http://${HOST}`);
            switch (url.pathname) {
                case "/":
                    res.writeHead?.(200, {
                        "Content-Type": "text/html; charset=utf-8",
                        "Cache-Control": "no-store",
                    });
                    res.end?.(VIEWER_HTML);
                    return;
                case "/events":
                    this.handleEvents(res);
                    return;
                case "/resource":
                    this.handleResource(url.searchParams.get("u"), res);
                    return;
                default:
                    this.respond(res, 404);
            }
        } catch (e) {
            this.diag(`local page: request failed: ${String(e)}`);
            try {
                if (res.headersSent) res.destroy?.();
                else this.respond(res, 500);
            } catch {
                /* connection gone */
            }
        }
    }

    private respond(res: ServerResponseLike, status: number): void {
        res.writeHead?.(status, { "Content-Type": "text/plain; charset=utf-8" });
        res.end?.(String(status));
    }

    private handleEvents(res: ServerResponseLike): void {
        res.writeHead?.(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        });
        this.clients.add(res);
        res.on?.("close", () => {
            this.clients.delete(res);
            if (this.clients.size === 0 && this.pingTimer !== null) {
                window.clearInterval(this.pingTimer);
                this.pingTimer = null;
            }
        });
        if (this.pingTimer === null) {
            this.pingTimer = window.setInterval(() => {
                for (const client of this.clients) {
                    try {
                        client.write?.(": ping\n\n");
                    } catch {
                        this.clients.delete(client);
                    }
                }
            }, PING_MS);
        }
        // A newly connected viewer starts from the popup currently on screen.
        if (this.currentHtml !== null) {
            this.send(
                res,
                "open",
                JSON.stringify({ html: this.currentHtml, fitHeight: this.currentFitHeight }),
            );
            if (this.currentState) this.send(res, "state", JSON.stringify(this.currentState));
        }
    }

    /** Serves an image referenced by an app:// URL, only from inside the vault. */
    private handleResource(appUrl: string | null, res: ServerResponseLike): void {
        const fs = nodeRequire<FsLike>("fs");
        const path = nodeRequire<PathLike>("path");
        const base = this.getVaultBasePath();
        if (
            appUrl === null ||
            base === null ||
            typeof fs?.createReadStream !== "function" ||
            typeof path?.resolve !== "function" ||
            typeof path.relative !== "function" ||
            typeof path.isAbsolute !== "function" ||
            typeof path.extname !== "function"
        ) {
            this.respond(res, 404);
            return;
        }
        let parsed: URL;
        try {
            parsed = new URL(appUrl);
        } catch {
            this.respond(res, 404);
            return;
        }
        if (parsed.protocol !== "app:") {
            this.respond(res, 404);
            return;
        }
        let filePath = decodeURIComponent(parsed.pathname);
        // "/C:/Users/..." -> "C:/Users/..." (Windows drive paths).
        if (/^\/[A-Za-z]:/.test(filePath)) filePath = filePath.slice(1);
        const resolved = path.resolve(filePath);
        const rel = path.relative(path.resolve(base), resolved);
        if (rel === "" || rel.split(/[\\/]/)[0] === ".." || path.isAbsolute(rel)) {
            this.respond(res, 403);
            return;
        }
        const type = IMAGE_TYPES[path.extname(resolved).toLowerCase()];
        if (!type) {
            this.respond(res, 404);
            return;
        }
        const stream = fs.createReadStream(resolved);
        stream.on?.("open", () => {
            res.writeHead?.(200, { "Content-Type": type, "Cache-Control": "no-store" });
            stream.pipe?.(res);
        });
        stream.on?.("error", () => {
            if (res.headersSent) res.destroy?.();
            else this.respond(res, 404);
        });
        res.on?.("close", () => stream.destroy?.());
    }
}
