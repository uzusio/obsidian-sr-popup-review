import { Notice, Plugin, moment, setIcon } from "obsidian";
import { SRBridge } from "./sr-bridge";
import { DiagLog } from "./diaglog";
import { PopupController } from "./popup";
import { Scheduler } from "./scheduler";
import { DEFAULT_SETTINGS, SRPopupSettings, SRPopupSettingTab } from "./settings";
import { setLocaleOverride, t } from "./i18n";
import { GlobalShortcutManager, ShortcutResult } from "./global-shortcut";
import { MirrorServer, MirrorStartResult } from "./mirror-server";

/** Debounce for port edits, so typing "27281" does not briefly bind 2728. */
const MIRROR_PORT_RESTART_MS = 800;

export default class SRPopupPlugin extends Plugin {
    declare settings: SRPopupSettings;
    bridge!: SRBridge;
    diag!: DiagLog;
    popup!: PopupController;
    scheduler!: Scheduler;
    globalShortcut!: GlobalShortcutManager;
    /** Result of the last apply() of settings.globalShortcut; drives the settings tab's status message. */
    globalShortcutState: ShortcutResult = "ok";
    mirrorServer!: MirrorServer;
    /** Result of the last local-page start; "off" while disabled (or starting). Drives the settings tab. */
    mirrorState: MirrorStartResult | "off" = "off";
    /** Serializes start/stop so overlapping setting changes cannot race on the port. */
    private mirrorOp: Promise<void> = Promise.resolve();
    private mirrorPortTimer: number | null = null;
    /** Set in onunload: a start still queued in mirrorOp must not leave a server behind. */
    private unloaded = false;
    private statusBarIconEl: HTMLElement | null = null;

    async onload(): Promise<void> {
        await this.loadSettings();
        this.bridge = new SRBridge(this.app);
        this.diag = new DiagLog(
            this.app,
            `${this.manifest.dir ?? `${this.app.vault.configDir}/plugins/sr-popup-review`}/diagnostics.log`,
        );
        void this.diag.init();
        this.diag.log(`plugin loaded (v${this.manifest.version})`);
        this.mirrorServer = new MirrorServer(
            (message) => this.diag.log(message),
            () => {
                const basePath = (this.app.vault.adapter as { getBasePath?: () => string }).getBasePath?.();
                return typeof basePath === "string" && basePath !== "" ? basePath : null;
            },
            () => this.settings.mirrorEnabled && this.mirrorState === "ok",
        );
        this.popup = new PopupController(
            this.app,
            this,
            (message) => this.diag.log(message),
            async (action, minutes) => {
                if (action === "pause") {
                    await this.setPaused(true);
                    return;
                }
                if (minutes === undefined || minutes <= 0) return;
                this.settings.snoozeUntil = Date.now() + minutes * 60_000;
                await this.saveSettings();
                const until = moment(this.settings.snoozeUntil).format("HH:mm");
                this.diag.log(`snoozed for ${minutes} min (until ${until})`);
                new Notice(t("snoozedNotice", { time: until }));
            },
            () => {
                // Restart the popup interval from the moment a popup ends, so a
                // long-open popup is not immediately followed by the next one.
                this.settings.lastShownAt = Date.now();
                void this.saveSettings();
            },
            () => ({
                width: this.settings.popupWidth,
                heightFront: this.settings.popupHeightFront,
                heightRevealed: this.settings.popupHeightRevealed,
            }),
            this.mirrorServer,
        );
        this.scheduler = new Scheduler(this);
        this.globalShortcut = new GlobalShortcutManager(
            (message) => this.diag.log(message),
            () => void this.scheduler.tick("manual", true),
        );
        this.globalShortcutState = this.globalShortcut.apply(this.settings.globalShortcut);
        if (this.globalShortcutState !== "ok") {
            this.diag.log(
                `global shortcut "${this.settings.globalShortcut}" could not be registered at startup (${this.globalShortcutState})`,
            );
        }
        // Quitting or reloading Obsidian tears this renderer down without
        // running onunload, which left the popup behind — and because a live
        // BrowserWindow blocks Electron's window-all-closed, it kept the whole
        // Obsidian process alive with it. beforeunload still runs here, and
        // @electron/remote calls are synchronous, so the popup (and the global
        // shortcut, which must not survive a reload/quit as a stale IPC
        // registration) can be torn down before the window goes away.
        this.registerDomEvent(window, "beforeunload", () => {
            this.globalShortcut.unregister();
            this.mirrorServer.stop();
            if (!this.popup.isOpen) return;
            this.diag.log("main window unloading; closing popup");
            this.popup.close();
        });

        if (this.settings.mirrorEnabled) void this.restartMirror();

        this.addSettingTab(new SRPopupSettingTab(this.app, this));
        this.addCommand({
            id: "show-review-popup-now",
            name: t("commandShowNow"),
            callback: () => void this.scheduler.tick("manual"),
        });
        this.addCommand({
            id: "toggle-popup-pause",
            name: t("commandTogglePause"),
            callback: () => void this.togglePaused(),
        });
        const showNowStatusItem = this.addStatusBarItem();
        showNowStatusItem.addClass("mod-clickable");
        showNowStatusItem.onClickEvent(() => void this.scheduler.tick("manual"));
        const showNowIconEl = showNowStatusItem.createSpan({ cls: "status-bar-item-icon" });
        setIcon(showNowIconEl, "layers");
        showNowStatusItem.setAttribute("aria-label", t("commandShowNow"));
        showNowStatusItem.setAttribute("data-tooltip-position", "top");
        const statusBarItem = this.addStatusBarItem();
        statusBarItem.addClass("mod-clickable");
        statusBarItem.onClickEvent(() => void this.togglePaused());
        this.statusBarIconEl = statusBarItem.createSpan({ cls: "status-bar-item-icon" });
        this.updatePauseIndicator();

        this.app.workspace.onLayoutReady(() => this.scheduler.start());
    }

    async togglePaused(): Promise<void> {
        await this.setPaused(!this.settings.paused);
    }

    async setPaused(paused: boolean): Promise<void> {
        this.settings.paused = paused;
        if (!paused) this.settings.snoozeUntil = 0; // resuming clears any snooze too
        await this.saveSettings();
        this.updatePauseIndicator();
        new Notice(t(paused ? "pausedOn" : "pausedOff"));
    }

    private updatePauseIndicator(): void {
        if (!this.statusBarIconEl) return;
        setIcon(this.statusBarIconEl, this.settings.paused ? "bell-off" : "bell");
        const label = t(this.settings.paused ? "statusBarResume" : "statusBarPause");
        const container = this.statusBarIconEl.parentElement;
        container?.setAttribute("aria-label", label);
        container?.setAttribute("data-tooltip-position", "top");
    }

    onunload(): void {
        this.unloaded = true;
        this.globalShortcut.unregister();
        if (this.mirrorPortTimer !== null) window.clearTimeout(this.mirrorPortTimer);
        this.popup.close();
        this.mirrorServer.stop();
    }

    /** The local page's URL for the configured port. */
    mirrorUrl(): string {
        return `http://127.0.0.1:${this.settings.mirrorPort}/`;
    }

    async setMirrorEnabled(enabled: boolean): Promise<void> {
        this.settings.mirrorEnabled = enabled;
        await this.saveSettings();
        await this.restartMirror();
    }

    /** Saves the port at once; the server follows after a short debounce. */
    async setMirrorPort(port: number): Promise<void> {
        this.settings.mirrorPort = port;
        await this.saveSettings();
        if (this.mirrorPortTimer !== null) window.clearTimeout(this.mirrorPortTimer);
        this.mirrorPortTimer = window.setTimeout(() => {
            this.mirrorPortTimer = null;
            void this.restartMirror();
        }, MIRROR_PORT_RESTART_MS);
    }

    /** (Re)starts or stops the local page to match the settings. */
    private restartMirror(): Promise<void> {
        this.mirrorOp = this.mirrorOp
            .then(async () => {
                this.mirrorState = "off";
                if (this.unloaded || !this.settings.mirrorEnabled) {
                    this.mirrorServer.stop();
                    return;
                }
                const result = await this.mirrorServer.start(this.settings.mirrorPort);
                if (this.unloaded) {
                    this.mirrorServer.stop();
                    return;
                }
                this.mirrorState = result;
            })
            .catch((e: unknown) => {
                this.mirrorState = "error";
                this.diag.log(`ERROR: local page: restart failed: ${String(e)}`);
            });
        return this.mirrorOp;
    }

    /**
     * Applies a new global-shortcut accelerator (or "" to clear it). On
     * success the setting is saved and globalShortcutState becomes "ok". On
     * failure the setting is left untouched and the previously-registered
     * accelerator (if any) is restored via globalShortcut.resume() — the
     * caller (the settings tab's key recorder) is expected to have already
     * called globalShortcut.suspend() before recording a replacement.
     */
    async setGlobalShortcut(accelerator: string): Promise<ShortcutResult> {
        const result = this.globalShortcut.apply(accelerator);
        if (result === "ok") {
            this.settings.globalShortcut = accelerator;
            await this.saveSettings();
            this.globalShortcutState = "ok";
            return "ok";
        }
        this.globalShortcut.resume();
        return result;
    }

    async loadSettings(): Promise<void> {
        const raw: unknown = await this.loadData();
        const data: Record<string, unknown> =
            raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
        this.settings = Object.assign({}, DEFAULT_SETTINGS, data as Partial<SRPopupSettings>);
        // Migrate the old "start == end means disabled" convention to the toggle.
        if (
            data.quietHoursEnabled === undefined &&
            this.settings.quietHoursStart === this.settings.quietHoursEnd
        ) {
            this.settings.quietHoursEnabled = false;
        }
        // The former "exclude" deck filter mode was dropped in favor of a simple
        // all / only-listed choice.
        if (data.deckFilterMode === "exclude") {
            this.settings.deckFilterMode = "all";
        }
        // "Due cards only" was replaced by the daily new-card budget (newCardsPerDay).
        delete (this.settings as unknown as Record<string, unknown>).dueCardsOnly;
        // Today's review count is now derived from SR's schedules; drop the keys saved during development.
        for (const key of ["reviewsTodayDate", "reviewsTodayCount", "reviewsTodayDueCount", "reviewsTodayNewCount"]) {
            delete (this.settings as unknown as Record<string, unknown>)[key];
        }
        // v1.0.4 stored only newCardsPerDay (0 = none, no unlimited state) —
        // map it onto the mode dropdown introduced afterwards.
        if (data.newCardsMode === undefined && typeof data.newCardsPerDay === "number") {
            this.settings.newCardsMode = data.newCardsPerDay <= 0 ? "none" : "limited";
        }
        setLocaleOverride(this.settings.language);
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }
}
