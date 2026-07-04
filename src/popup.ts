import { App, Component, MarkdownRenderer, Notice } from "obsidian";
import { ReviewResponse, ReviewResponseValue, ReviewSession } from "./sr-bridge";
import { t } from "./i18n";

/* eslint-disable @typescript-eslint/no-explicit-any */

const WIDTH = 400;
const HEIGHT_FRONT = 260;
const HEIGHT_REVEALED = 470;
const MARGIN = 16;
const POLL_MS = 250;
const DONE_MS = 700;

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
 * The popup is a plain BrowserWindow without Node access. Communication back to
 * the plugin deliberately avoids remote event subscription (fragile across
 * Electron versions): the plugin polls `window.__srAction` / `window.__srRevealed`
 * via executeJavaScript every 250 ms instead.
 */
export class PopupController {
    private win: any = null;
    private session: ReviewSession | null = null;
    private pollTimer: number | null = null;
    private autoCloseTimer: number | null = null;
    private autoCloseSeconds = 0;
    private revealed = false;
    private actionHandled = false;
    private polling = false;

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
        this.session = session;
        this.autoCloseSeconds = autoCloseSeconds;
        this.revealed = false;
        this.actionHandled = false;

        const html = await this.buildHtml(session, showDeckName);
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
        try {
            await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
        } catch (e) {
            console.error("[sr-popup-review] failed to load popup content", e);
            this.finish();
            return false;
        }
        if (!this.isOpen) return false;
        try {
            win.showInactive();
        } catch (e) {
            console.error("[sr-popup-review] failed to show popup", e);
            this.finish();
            return false;
        }
        this.pollTimer = window.setInterval(() => void this.poll(), POLL_MS);
        this.resetAutoClose();
        return true;
    }

    close(): void {
        this.finish();
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

    private resetAutoClose(): void {
        if (this.autoCloseTimer !== null) {
            window.clearTimeout(this.autoCloseTimer);
            this.autoCloseTimer = null;
        }
        if (this.autoCloseSeconds > 0) {
            this.autoCloseTimer = window.setTimeout(
                () => this.finish(),
                this.autoCloseSeconds * 1000,
            );
        }
    }

    private async poll(): Promise<void> {
        if (this.polling || this.actionHandled) return;
        this.polling = true;
        try {
            await this.pollOnce();
        } finally {
            this.polling = false;
        }
    }

    private async pollOnce(): Promise<void> {
        if (!this.isOpen) {
            this.finish();
            return;
        }
        let state: { a: string | null; r: boolean };
        try {
            state = await this.win.webContents.executeJavaScript(
                "({ a: window.__srAction || null, r: window.__srRevealed === true })",
                true,
            );
        } catch {
            // Window closed (Alt+F4 etc.) or content gone.
            this.finish();
            return;
        }
        if (this.actionHandled || !this.isOpen) return;
        if (state.r && !this.revealed) {
            this.revealed = true;
            const remote = getRemote();
            if (remote) this.place(remote, HEIGHT_REVEALED);
            this.resetAutoClose();
        }
        if (!state.a) return;
        if (state.a === "close") {
            this.finish();
            return;
        }
        const response = ACTION_TO_RESPONSE[state.a];
        if (response === undefined || !this.session) {
            this.finish();
            return;
        }
        this.actionHandled = true;
        try {
            await this.session.rate(response);
        } catch (e) {
            console.error("[sr-popup-review] failed to save review", e);
            new Notice(t("ratingFailed"));
            this.finish();
            return;
        }
        try {
            await this.win?.webContents?.executeJavaScript(
                "window.__showDone && window.__showDone()",
                true,
            );
        } catch {
            /* window may already be gone; the review is saved either way */
        }
        window.setTimeout(() => this.finish(), DONE_MS);
    }

    private finish(): void {
        if (this.pollTimer !== null) {
            window.clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
        if (this.autoCloseTimer !== null) {
            window.clearTimeout(this.autoCloseTimer);
            this.autoCloseTimer = null;
        }
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

    private async buildHtml(session: ReviewSession, showDeckName: boolean): Promise<string> {
        const frontHtml = await this.renderMarkdown(session.front);
        const backHtml = await this.renderMarkdown(session.back);
        const dark = document.body.classList.contains("theme-dark");
        const headerParts: string[] = [];
        if (showDeckName && session.deckName) headerParts.push(escapeHtml(session.deckName));
        headerParts.push(
            escapeHtml(session.isNewCard ? t("newCard") : t("due", { n: session.dueCount })),
        );
        const labels = session.buttonLabels;

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
button.action:hover { border-color: var(--fg); }
#revealBtn { width: 100%; }
#ratings { display: flex; gap: 6px; }
#ratings .action { flex: 1; font-weight: 600; }
#ratings .again { color: var(--again); }
#ratings .hard { color: var(--hard); }
#ratings .good { color: var(--good); }
#ratings .easy { color: var(--easy); }
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
</div>
<div id="done" class="done" hidden>✓ ${escapeHtml(t("saved"))}</div>
<script>
(function () {
    var revealBtn = document.getElementById("revealBtn");
    var ratings = document.getElementById("ratings");
    var answer = document.getElementById("answer");
    function reveal() {
        if (window.__srRevealed) return;
        window.__srRevealed = true;
        revealBtn.hidden = true;
        answer.hidden = false;
        ratings.hidden = false;
    }
    revealBtn.addEventListener("click", reveal);
    document.getElementById("closeBtn").addEventListener("click", function () {
        window.__srAction = "close";
    });
    Array.prototype.forEach.call(ratings.querySelectorAll(".action"), function (b) {
        b.addEventListener("click", function () {
            window.__srAction = b.getAttribute("data-action");
        });
    });
    window.__showDone = function () {
        document.getElementById("done").hidden = false;
    };
    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") { window.__srAction = "close"; return; }
        if (!window.__srRevealed && (e.key === " " || e.key === "Enter")) {
            e.preventDefault();
            reveal();
            return;
        }
        if (window.__srRevealed) {
            var map = { "1": "again", "2": "hard", "3": "good", "4": "easy" };
            if (map[e.key]) window.__srAction = map[e.key];
        }
    });
})();
</` + `script>
</body>
</html>`;
    }
}
