import { App, Component, MarkdownRenderer, Notice } from "obsidian";
import { ReviewResponse, ReviewResponseValue, ReviewSession } from "./sr-bridge";
import { t } from "./i18n";

// ---------------------------------------------------------------------------
// Structural types for the Electron pieces this plugin touches via
// @electron/remote. Every member is optional and guarded before use, because
// the remote bridge differs across Obsidian/Electron versions.
// ---------------------------------------------------------------------------

interface Bounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

interface WebContentsLike {
    executeJavaScript?: (code: string, userGesture?: boolean) => Promise<unknown>;
}

interface BrowserWindowLike {
    isDestroyed?: () => boolean;
    destroy?: () => void;
    loadURL?: (url: string) => Promise<void>;
    showInactive?: () => void;
    setAlwaysOnTop?: (flag: boolean, level?: string) => void;
    moveTop?: () => void;
    setBounds?: (bounds: Bounds) => void;
    webContents?: WebContentsLike;
}

type BrowserWindowCtor = new (options: Record<string, unknown>) => BrowserWindowLike;

interface ElectronRemoteLike {
    BrowserWindow?: BrowserWindowCtor;
    screen?: {
        getPrimaryDisplay?: () => { workArea?: Bounds } | undefined;
    };
}

function getRemote(): ElectronRemoteLike | null {
    try {
        const requireFn = (window as Window & { require?: (module: string) => unknown }).require;
        if (typeof requireFn !== "function") return null;
        const remote = requireFn("@electron/remote");
        return remote ? (remote) : null;
    } catch {
        return null;
    }
}

const WIDTH = 400;
const HEIGHT_FRONT = 260;
const HEIGHT_REVEALED = 470;
const MARGIN = 16;
/** loadURL can hang if the window's renderer dies mid-load — time-box it. */
const LOAD_TIMEOUT_MS = 15_000;
/** How long ensureAlive() waits for the popup to answer a trivial script call. */
const ALIVE_TIMEOUT_MS = 5_000;
/** A review write that has not settled by then is reported and the popup closed. */
const RATE_TIMEOUT_MS = 90_000;
/** After this long on "Saving…", the popup unlocks its close button (escape hatch). */
const SAVING_STUCK_MS = 60_000;
/**
 * Heartbeat: the plugin pings the popup every 30 s; if pings stop for 5 minutes
 * the popup closes itself. Prevents a popup from outliving Obsidian (a hung or
 * quit main window whose onunload never ran left zombie popups behind).
 * The send interval lives in the (throttleable) main window, so the dead
 * threshold is generous.
 */
const HEARTBEAT_SEND_MS = 30_000;
const HEARTBEAT_DEAD_MS = 5 * 60_000;

const ACTION_TO_RESPONSE: Record<string, ReviewResponseValue> = {
    again: ReviewResponse.Again,
    hard: ReviewResponse.Hard,
    good: ReviewResponse.Good,
    easy: ReviewResponse.Easy,
};

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/**
 * Frameless always-on-top popup at the bottom-right of the primary display.
 *
 * Communication is a LONG POLL, not a timer: the plugin awaits
 * executeJavaScript("window.__nextEvent()"), whose promise resolves the moment
 * the popup emits an event. Timers in the (usually minimized) main Obsidian
 * window are heavily throttled by Chromium, so anything latency-sensitive must
 * either live in the visible popup window (auto-close countdown, click feedback)
 * or be event-driven like this (rating -> write). Remote event subscription is
 * still avoided (fragile across Electron versions).
 */
export class PopupController {
    private win: BrowserWindowLike | null = null;
    private session: ReviewSession | null = null;
    private revealed = false;
    private heartbeatTimer: number | null = null;
    /**
     * Bumped on every show()/finish(). Async continuations (event loop, load,
     * liveness probe) compare their captured value against the current one and
     * abort when superseded, so a hung await can never act on a newer popup.
     */
    private generation = 0;

    constructor(
        private app: App,
        private owner: Component,
    ) {}

    get isOpen(): boolean {
        try {
            return this.win !== null && this.win.isDestroyed?.() !== true;
        } catch {
            // A destroyed remote BrowserWindow throws "Object has been destroyed"
            // on ANY member access — treat that as closed.
            return false;
        }
    }

    async show(
        session: ReviewSession,
        autoCloseSeconds: number,
        showDeckName: boolean,
    ): Promise<boolean> {
        if (this.isOpen) return false;
        const remote = getRemote();
        const BrowserWindowClass = remote?.BrowserWindow;
        if (typeof BrowserWindowClass !== "function" || !remote?.screen) {
            console.error("[sr-popup-review] @electron/remote is not available");
            return false;
        }
        const gen = ++this.generation;
        this.session = session;
        this.revealed = false;

        const html = await this.buildHtml(session, showDeckName, autoCloseSeconds);
        if (gen !== this.generation) return false;
        let win: BrowserWindowLike;
        try {
            win = new BrowserWindowClass({
                width: WIDTH,
                height: HEIGHT_FRONT,
                frame: false,
                alwaysOnTop: true,
                skipTaskbar: true,
                resizable: false,
                show: false,
                focusable: true,
                roundedCorners: true,
                webPreferences: { nodeIntegration: false, contextIsolation: true },
            });
        } catch (e) {
            console.error("[sr-popup-review] failed to create popup window", e);
            return false;
        }
        this.win = win;
        this.place(remote, HEIGHT_FRONT);
        const url = "data:text/html;charset=utf-8," + encodeURIComponent(html);
        const loadPromise =
            typeof win.loadURL === "function"
                ? win.loadURL(url).then(
                      () => true,
                      (e: unknown) => {
                          console.error("[sr-popup-review] failed to load popup content", e);
                          return false;
                      },
                  )
                : Promise.resolve(false);
        const loaded = await Promise.race([
            loadPromise,
            new Promise<boolean>((resolve) =>
                window.setTimeout(() => resolve(false), LOAD_TIMEOUT_MS),
            ),
        ]);
        if (gen !== this.generation) return false;
        if (!loaded || !this.isOpen) {
            console.error("[sr-popup-review] popup content did not load in time");
            this.finish();
            return false;
        }
        try {
            win.showInactive?.();
        } catch (e) {
            console.error("[sr-popup-review] failed to show popup", e);
            this.finish();
            return false;
        }
        try {
            // The default always-on-top band loses to overlay apps and borderless
            // fullscreen windows; raise to the highest band and push to its top.
            // (Exclusive-fullscreen games still cover it — an OS-level limitation.)
            win.setAlwaysOnTop?.(true, "screen-saver");
            win.moveTop?.();
        } catch {
            /* cosmetic */
        }
        if (this.heartbeatTimer !== null) {
            // Defensive: never leak a previous session's interval.
            window.clearInterval(this.heartbeatTimer);
        }
        this.heartbeatTimer = window.setInterval(() => this.heartbeatTick(gen), HEARTBEAT_SEND_MS);
        void this.eventLoop(gen);
        return true;
    }

    /**
     * Heartbeat + reaper. Besides feeding the popup's self-destruct timer, this
     * detects a window that died without the event loop noticing (on some
     * Electron versions a pending executeJavaScript promise never settles when
     * the window closes itself) and buries the session. Without this, the dead
     * window blocked every future popup and its leaked timer threw
     * "Object has been destroyed" on every beat — observed in the wild as
     * hundreds of accumulated console errors.
     */
    private heartbeatTick(gen: number): void {
        if (gen !== this.generation) return;
        if (!this.isOpen) {
            console.warn("[sr-popup-review] popup window vanished; cleaning up its session");
            this.finish();
            return;
        }
        this.execInPopup("window.__heartbeat && window.__heartbeat()").catch(() => {
            /* transient; the reaper or event loop will clean up */
        });
    }

    close(): void {
        this.finish();
    }

    /**
     * True if the popup window answers a trivial script call within a few
     * seconds. A window whose renderer died (system sleep, the OS reclaiming
     * the process) still reports isDestroyed() === false but never responds —
     * destroy it so it cannot block future popups forever.
     */
    async ensureAlive(): Promise<boolean> {
        if (!this.isOpen) return false;
        const gen = this.generation;
        let alive = false;
        try {
            alive = await Promise.race([
                this.execInPopup("1").then(() => true),
                new Promise<boolean>((resolve) =>
                    window.setTimeout(() => resolve(false), ALIVE_TIMEOUT_MS),
                ),
            ]);
        } catch {
            alive = false;
        }
        if (alive) return true;
        if (gen === this.generation && this.isOpen) {
            console.warn("[sr-popup-review] popup window is unresponsive; destroying it");
            this.finish();
        }
        return false;
    }

    /** Runs a script in the popup window; rejects if the window is unavailable.
     * Never throws synchronously: member access on a destroyed remote window
     * throws "Object has been destroyed", which must not escape into timers. */
    private execInPopup(code: string): Promise<unknown> {
        try {
            const webContents = this.win?.webContents;
            if (!webContents || typeof webContents.executeJavaScript !== "function") {
                return Promise.reject(new Error("popup webContents unavailable"));
            }
            return webContents.executeJavaScript(code, true);
        } catch (e) {
            return Promise.reject(e instanceof Error ? e : new Error(String(e)));
        }
    }

    /**
     * Long-poll loop: each iteration blocks until the popup emits an event
     * ("revealed", a rating action, or "close"). The executeJavaScript promise
     * rejects when the window is closed/destroyed, which also ends the loop.
     * `gen` guards every continuation: if this popup was superseded while an
     * await was pending, the stale loop exits without touching the new popup.
     */
    private async eventLoop(gen: number): Promise<void> {
        while (gen === this.generation && this.isOpen) {
            let event: unknown;
            try {
                event = await this.execInPopup("window.__nextEvent()");
            } catch {
                break; // window closed or content gone
            }
            if (gen !== this.generation) return;
            if (!this.isOpen) break;
            if (event === "revealed") {
                this.revealed = true;
                const remote = getRemote();
                if (remote) this.place(remote, HEIGHT_REVEALED);
                continue;
            }
            if (event === "close") break;
            const response = ACTION_TO_RESPONSE[String(event)];
            const session = this.session;
            if (response === undefined || !session) break;
            console.debug(`[sr-popup-review] rating received (${String(event)}); writing...`);
            const started = Date.now();
            const ratePromise = session.rate(response).then(
                () => "ok" as const,
                (e: unknown) => {
                    console.error("[sr-popup-review] failed to save review", e);
                    return "error" as const;
                },
            );
            const result = await Promise.race([
                ratePromise,
                new Promise<"timeout">((resolve) =>
                    window.setTimeout(() => resolve("timeout"), RATE_TIMEOUT_MS),
                ),
            ]);
            if (result === "error") {
                new Notice(t("ratingFailed"));
                break;
            }
            if (result === "timeout") {
                console.error(
                    `[sr-popup-review] review write did not settle within ${RATE_TIMEOUT_MS / 1000}s; closing the popup — check the card's schedule comment`,
                );
                new Notice(t("ratingTimeout"));
                break;
            }
            console.debug(
                `[sr-popup-review] review (${String(event)}) written in ${Date.now() - started} ms`,
            );
            if (gen !== this.generation) return;
            try {
                await this.execInPopup("window.__showDone && window.__showDone()");
            } catch {
                /* window may already be gone; the review is saved either way */
            }
            // The popup shows the done flash and closes itself; the next
            // __nextEvent() call rejects at that point and ends the loop.
        }
        if (gen === this.generation) this.finish();
    }

    private place(remote: ElectronRemoteLike, height: number): void {
        try {
            const workArea = remote.screen?.getPrimaryDisplay?.()?.workArea;
            if (!workArea) return;
            this.win?.setBounds?.({
                x: Math.round(workArea.x + workArea.width - WIDTH - MARGIN),
                y: Math.round(workArea.y + workArea.height - height - MARGIN),
                width: WIDTH,
                height,
            });
        } catch (e) {
            console.error("[sr-popup-review] failed to position popup", e);
        }
    }

    private finish(): void {
        this.generation++; // invalidate any in-flight event loop / load / probe
        if (this.heartbeatTimer !== null) {
            window.clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        const win = this.win;
        this.win = null;
        this.session = null;
        try {
            if (win && win.isDestroyed?.() !== true) win.destroy?.();
        } catch {
            /* already gone */
        }
    }

    private async renderMarkdown(markdown: string): Promise<string> {
        const el = createDiv();
        try {
            await MarkdownRenderer.render(this.app, markdown, el, "", this.owner);
            return el.innerHTML;
        } catch (e) {
            console.error("[sr-popup-review] markdown render failed, using plain text", e);
            return '<pre style="white-space:pre-wrap">' + escapeHtml(markdown) + "</pre>";
        }
    }

    private async buildHtml(
        session: ReviewSession,
        showDeckName: boolean,
        autoCloseSeconds: number,
    ): Promise<string> {
        const frontHtml = await this.renderMarkdown(session.front);
        const backHtml = await this.renderMarkdown(session.back);
        const dark = activeDocument.body.classList.contains("theme-dark");
        const headerParts: string[] = [];
        if (showDeckName && session.deckName) headerParts.push(escapeHtml(session.deckName));
        headerParts.push(
            escapeHtml(session.isNewCard ? t("newCard") : t("due", { n: session.dueCount })),
        );
        const labels = session.buttonLabels;
        const autoCloseMs = Math.max(0, Math.round(autoCloseSeconds * 1000));

        return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
:root {
    --bg: #ffffff; --fg: #1f2328; --muted: #6a737d; --border: #d0d7de;
    --btn-bg: #f6f8fa; --btn-border: #d0d7de;
    --again: #d1242f; --hard: #bc4c00; --good: #1a7f37; --easy: #0969da;
}
body.dark {
    --bg: #1e1e1e; --fg: #dadada; --muted: #9e9e9e; --border: #3f3f3f;
    --btn-bg: #2a2a2a; --btn-border: #4a4a4a;
    --again: #f47067; --hard: #e0823d; --good: #57ab5a; --easy: #539bf5;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
[hidden] { display: none !important; }
html, body { height: 100%; }
body {
    background: var(--bg); color: var(--fg);
    font-family: -apple-system, "Segoe UI", "Yu Gothic UI", "Meiryo", "Malgun Gothic", sans-serif;
    font-size: 14px; line-height: 1.6;
    display: flex; flex-direction: column;
    border: 1px solid var(--border); overflow: hidden;
}
.header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 8px 12px; font-size: 12px; color: var(--muted);
    -webkit-app-region: drag; flex: none; user-select: none;
}
.closebtn {
    -webkit-app-region: no-drag;
    background: none; border: none; color: var(--muted);
    font-size: 14px; cursor: pointer; padding: 2px 6px;
}
.closebtn:hover { color: var(--fg); }
.content { flex: 1; overflow-y: auto; padding: 2px 16px 10px; }
.content img { max-width: 100%; }
.content hr { border: none; border-top: 1px solid var(--border); margin: 10px 0; }
.q { font-size: 15px; }
.footer { flex: none; padding: 10px 12px 12px; }
button.action {
    font-family: inherit; font-size: 13px; cursor: pointer;
    background: var(--btn-bg); color: var(--fg);
    border: 1px solid var(--btn-border); border-radius: 6px; padding: 8px 0;
}
button.action:hover:enabled { border-color: var(--fg); }
button.action:disabled { opacity: 0.45; cursor: default; }
button.action.chosen { opacity: 1; border-color: currentColor; box-shadow: 0 0 0 1px currentColor inset; }
#revealBtn { width: 100%; }
#ratings { display: flex; gap: 6px; }
#ratings .action { flex: 1; font-weight: 600; }
#ratings .again { color: var(--again); }
#ratings .hard { color: var(--hard); }
#ratings .good { color: var(--good); }
#ratings .easy { color: var(--easy); }
#saving { margin-top: 8px; font-size: 12px; color: var(--muted); text-align: center; }
.done {
    position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
    background: var(--bg); font-size: 16px;
}
</style>
</head>
<body class="${dark ? "dark" : ""}">
<div class="header">
    <span>${headerParts.join(" · ")}</span>
    <button class="closebtn" id="closeBtn" title="Esc">✕</button>
</div>
<div class="content">
    <div class="q">${frontHtml}</div>
    <div id="answer" hidden><hr>${backHtml}</div>
</div>
<div class="footer">
    <button class="action" id="revealBtn">▼ ${escapeHtml(t("showAnswer"))}</button>
    <div id="ratings" hidden>
        <button class="action again" data-action="again">${escapeHtml(labels.again)}</button>
        <button class="action hard" data-action="hard">${escapeHtml(labels.hard)}</button>
        <button class="action good" data-action="good">${escapeHtml(labels.good)}</button>
        <button class="action easy" data-action="easy">${escapeHtml(labels.easy)}</button>
    </div>
    <div id="saving" hidden>${escapeHtml(t("saving"))}</div>
</div>
<div id="done" class="done" hidden>✓ ${escapeHtml(t("saved"))}</div>
<script>
(function () {
    // Event queue + long-poll endpoint for the plugin side.
    var events = [];
    var waiters = [];
    function emit(e) {
        if (waiters.length) waiters.shift()(e);
        else events.push(e);
    }
    window.__nextEvent = function () {
        if (events.length) return Promise.resolve(events.shift());
        return new Promise(function (resolve) { waiters.push(resolve); });
    };

    // Self-destruct when the plugin's heartbeat stops (Obsidian quit or hung):
    // a popup must never outlive its owner.
    var lastHeartbeat = Date.now();
    window.__heartbeat = function () { lastHeartbeat = Date.now(); };
    setInterval(function () {
        if (Date.now() - lastHeartbeat > ${HEARTBEAT_DEAD_MS}) window.close();
    }, 30000);

    var revealBtn = document.getElementById("revealBtn");
    var ratings = document.getElementById("ratings");
    var answer = document.getElementById("answer");
    var saving = document.getElementById("saving");

    // Auto-close lives here (this window is visible, so its timers are not
    // throttled, unlike the minimized main Obsidian window).
    var autoCloseMs = ${autoCloseMs};
    var autoCloseTimer = null;
    function armAutoClose() {
        if (!autoCloseMs) return;
        if (autoCloseTimer) clearTimeout(autoCloseTimer);
        autoCloseTimer = setTimeout(function () { emit("close"); }, autoCloseMs);
    }
    armAutoClose();

    var revealed = false;
    function reveal() {
        if (revealed) return;
        revealed = true;
        revealBtn.hidden = true;
        answer.hidden = false;
        ratings.hidden = false;
        armAutoClose();
        emit("revealed");
    }

    var byAction = {};
    var chosen = false;
    var savingStuck = false;
    var savingTimer = null;
    function choose(action) {
        if (chosen || !revealed) return;
        chosen = true;
        if (autoCloseTimer) clearTimeout(autoCloseTimer);
        Object.keys(byAction).forEach(function (k) { byAction[k].disabled = true; });
        if (byAction[action]) byAction[action].classList.add("chosen");
        saving.hidden = false;
        // Escape hatch: if the plugin never answers (hung write, blocked main
        // window), unlock closing so the popup cannot become a stuck ornament.
        savingTimer = setTimeout(function () {
            savingStuck = true;
            saving.textContent = ${JSON.stringify(t("savingStuck"))};
        }, ${SAVING_STUCK_MS});
        emit(action);
    }
    function requestClose() {
        if (savingStuck) { window.close(); return; }
        if (!chosen) emit("close");
    }

    revealBtn.addEventListener("click", reveal);
    document.getElementById("closeBtn").addEventListener("click", requestClose);
    Array.prototype.forEach.call(ratings.querySelectorAll(".action"), function (b) {
        byAction[b.getAttribute("data-action")] = b;
        b.addEventListener("click", function () { choose(b.getAttribute("data-action")); });
    });
    window.__showDone = function () {
        if (savingTimer) clearTimeout(savingTimer);
        document.getElementById("done").hidden = false;
        setTimeout(function () { window.close(); }, 700);
    };
    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") { requestClose(); return; }
        if (!revealed && (e.key === " " || e.key === "Enter")) {
            e.preventDefault();
            reveal();
            return;
        }
        var map = { "1": "again", "2": "hard", "3": "good", "4": "easy" };
        if (map[e.key]) choose(map[e.key]);
    });
})();
</` + `script>
</body>
</html>`;
    }
}
