import { Notice, Plugin, moment, setIcon } from "obsidian";
import { SRBridge } from "./sr-bridge";
import { DiagLog } from "./diaglog";
import { PopupController } from "./popup";
import { Scheduler } from "./scheduler";
import { DEFAULT_SETTINGS, SRPopupSettings, SRPopupSettingTab } from "./settings";
import { setLocaleOverride, t } from "./i18n";

export default class SRPopupPlugin extends Plugin {
    declare settings: SRPopupSettings;
    bridge!: SRBridge;
    diag!: DiagLog;
    popup!: PopupController;
    scheduler!: Scheduler;
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
        );
        this.scheduler = new Scheduler(this);

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
        this.popup.close();
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
        setLocaleOverride(this.settings.language);
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }
}
