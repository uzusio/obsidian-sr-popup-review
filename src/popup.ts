import { App, Component, MarkdownRenderer, Notice } from "obsidian";
import { ReviewResponse, ReviewResponseValue, ReviewSession } from "./sr-bridge";
import { t } from "./i18n";

/* eslint-disable @typescript-eslint/no-explicit-any */

const WIDTH = 400;
const HEIGHT_FRONT = 260;
const HEIGHT_REVEALED = 470;
const MARGIN = 16;
/** loadURL can hang if the window's renderer dies mid-load — time-box it. */
const LOAD_TIMEOUT_MS = 15_000;
/** How long ensureAlive() waits for the popup to answer a trivial script call. */
const ALIVE_TIMEOUT_MS = 5_000;

const ACTION_TO_RESPONSE: Record<string, ReviewResponseValue> = {
    again: ReviewResponse.Again,
    hard: ReviewResponse.Hard,
    good: ReviewResponse.Good,
    easy: ReviewResponse.Easy,
};

function getRemote(): any | null {
    try {
        return (window as any).require?.("@electron/remote") ?? null;
    } catch {
        return null;
    }
}

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
    private win: any = null;
    private session: ReviewSession | null = null;
    private revealed = false;
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
        return this.win !== null && this.win.isDestroyed?.() !== true;
    }

    async show(
        session: ReviewSession,
        autoCloseSeconds: number,
        showDeckName: boolean,
    ): Promise<boolean> {
        if (this.isOpen) return false;
        const remote = getRemote();
        if (!remote?.BrowserWindow || !remote?.screen) {
            console.error("[sr-popup-review] @electron/remote is not available");
            return false;
        }
        const gen = ++this.generation;
        this.session = session;
        this.revealed = false;

        const html = await this.buildHtml(session, showDeckName, autoCloseSeconds);
        if (gen !== this.generation) return false;
        let win: any;
        try {
            win = new remote.BrowserWindow({
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
        const loaded = await Promise.race([
            win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html)).then(
                () => true,
                (e: unknown) => {
                    console.error("[sr-popup-review] failed to load popup content", e);
                    return false;
                },
            ),
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
            win.showInactive();
        } catch (e) {
            console.error("[sr-popup-review] failed to show popup", e);
            this.finish();
            return false;
        }
        void this.eventLoop(gen);
        return true;
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
                this.win.webContents.executeJavaScript("1", true).then(() => true),
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

    close(): void {
        this.finish();
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
                event = await this.win.webContents.executeJavaScript("window.__nextEvent()", true);
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
            const started = Date.now();
            try {
                await session.rate(response);
                console.debug(
                    `[sr-popup-review] review (${String(event)}) written in ${Date.now() - started} ms`,
                );
            } catch (e) {
                console.error("[sr-popup-review] failed to save review", e);
                new Notice(t("ratingFailed"));
                break;
            }
            if (gen !== this.generation) return;
            try {
                await this.win?.webContents?.executeJavaScript(
                    "window.__showDone && window.__showDone()",
                    true,
                );
            } catch {
                /* window may already be gone; the review is saved either way */
            }
            // The popup shows the done flash and closes itself; the next
            // __nextEvent() call rejects at that point and ends the loop.
        }
        if (gen === this.generation) this.finish();
    }

    private place(remote: any, height: number): void {
        try {
            const workArea = remote.screen.getPrimaryDisplay().workArea;
            this.win?.setBounds({
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
        const win = this.win;
        this.win = null;
        this.session = null;
        try {
            if (win && win.isDestroyed?.() !== true) win.destroy();
        } catch {
            /* already gone */
        }
    }

    private async renderMarkdown(markdown: string): Promise<string> {
        const el = document.createElement("div");
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
        const dark = document.body.classList.contains("theme-dark");
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
    function choose(action) {
        if (chosen || !revealed) return;
        chosen = true;
        if (autoCloseTimer) clearTimeout(autoCloseTimer);
        Object.keys(byAction).forEach(function (k) { byAction[k].disabled = true; });
        if (byAction[action]) byAction[action].classList.add("chosen");
        saving.hidden = false;
        emit(action);
    }

    revealBtn.addEventListener("click", reveal);
    document.getElementById("closeBtn").addEventListener("click", function () {
        if (!chosen) emit("close");
    });
    Array.prototype.forEach.call(ratings.querySelectorAll(".action"), function (b) {
        byAction[b.getAttribute("data-action")] = b;
        b.addEventListener("click", function () { choose(b.getAttribute("data-action")); });
    });
    window.__showDone = function () {
        document.getElementById("done").hidden = false;
        setTimeout(function () { window.close(); }, 700);
    };
    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") { if (!chosen) emit("close"); return; }
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
