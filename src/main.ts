import { Plugin } from "obsidian";
import { SRBridge } from "./sr-bridge";
import { PopupController } from "./popup";
import { Scheduler } from "./scheduler";
import { DEFAULT_SETTINGS, SRPopupSettings, SRPopupSettingTab } from "./settings";
import { setLocaleOverride, t } from "./i18n";

export default class SRPopupPlugin extends Plugin {
    declare settings: SRPopupSettings;
    bridge!: SRBridge;
    popup!: PopupController;
    scheduler!: Scheduler;

    async onload(): Promise<void> {
        await this.loadSettings();
        this.bridge = new SRBridge(this.app);
        this.popup = new PopupController(this.app, this);
        this.scheduler = new Scheduler(this);

        this.addSettingTab(new SRPopupSettingTab(this.app, this));
        this.addCommand({
            id: "show-review-popup-now",
            name: t("commandShowNow"),
            callback: () => void this.scheduler.tick(true),
        });

        this.app.workspace.onLayoutReady(() => this.scheduler.start());
    }

    onunload(): void {
        this.popup.close();
    }

    async loadSettings(): Promise<void> {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        setLocaleOverride(this.settings.language);
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }
}
