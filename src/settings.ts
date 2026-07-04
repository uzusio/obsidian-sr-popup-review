import { App, PluginSettingTab, Setting } from "obsidian";
import type SRPopupPlugin from "./main";
import { normalizeDeckPaths } from "./sr-bridge";
import { t } from "./i18n";

export interface SRPopupSettings {
    intervalMinutes: number;
    quietHoursStart: string;
    quietHoursEnd: string;
    autoCloseSeconds: number;
    dueCardsOnly: boolean;
    deckFilterMode: "all" | "include" | "exclude";
    deckFilterList: string[];
    showDeckName: boolean;
    checkOnStartup: boolean;
    /** Persisted state, not user-facing: epoch ms of the last popup. */
    lastShownAt: number;
}

export const DEFAULT_SETTINGS: SRPopupSettings = {
    intervalMinutes: 120,
    quietHoursStart: "01:00",
    quietHoursEnd: "09:00",
    autoCloseSeconds: 90,
    dueCardsOnly: true,
    deckFilterMode: "all",
    deckFilterList: [],
    showDeckName: true,
    checkOnStartup: false,
    lastShownAt: 0,
};

const HHMM_RE = /^(\d{1,2}):(\d{2})$/;

export class SRPopupSettingTab extends PluginSettingTab {
    constructor(
        app: App,
        private plugin: SRPopupPlugin,
    ) {
        super(app, plugin);
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        const probe = this.plugin.bridge.probe();
        const version = this.plugin.bridge.getSRPlugin()?.manifest?.version ?? "?";
        new Setting(containerEl)
            .setName(t("settingsStatus"))
            .setDesc(
                probe.status === "ok"
                    ? t("settingsStatusOk", { version })
                    : t("settingsStatusNg", { reason: probe.reason ?? "?" }),
            );

        new Setting(containerEl)
            .setName(t("settingsInterval"))
            .setDesc(t("settingsIntervalDesc"))
            .addText((text) =>
                text.setValue(String(this.plugin.settings.intervalMinutes)).onChange(async (v) => {
                    const n = Number(v);
                    if (Number.isFinite(n) && n >= 5) {
                        this.plugin.settings.intervalMinutes = Math.round(n);
                        await this.plugin.saveSettings();
                    }
                }),
            );

        new Setting(containerEl)
            .setName(t("settingsQuietStart"))
            .setDesc(t("settingsQuietDesc"))
            .addText((text) =>
                text.setValue(this.plugin.settings.quietHoursStart).onChange(async (v) => {
                    if (HHMM_RE.test(v.trim())) {
                        this.plugin.settings.quietHoursStart = v.trim();
                        await this.plugin.saveSettings();
                    }
                }),
            );

        new Setting(containerEl).setName(t("settingsQuietEnd")).addText((text) =>
            text.setValue(this.plugin.settings.quietHoursEnd).onChange(async (v) => {
                if (HHMM_RE.test(v.trim())) {
                    this.plugin.settings.quietHoursEnd = v.trim();
                    await this.plugin.saveSettings();
                }
            }),
        );

        new Setting(containerEl)
            .setName(t("settingsAutoClose"))
            .setDesc(t("settingsAutoCloseDesc"))
            .addText((text) =>
                text.setValue(String(this.plugin.settings.autoCloseSeconds)).onChange(async (v) => {
                    const n = Number(v);
                    if (Number.isFinite(n) && n >= 0) {
                        this.plugin.settings.autoCloseSeconds = Math.round(n);
                        await this.plugin.saveSettings();
                    }
                }),
            );

        new Setting(containerEl)
            .setName(t("settingsDeckFilterMode"))
            .setDesc(t("settingsDeckFilterModeDesc"))
            .addDropdown((dropdown) =>
                dropdown
                    .addOption("all", t("deckFilterAll"))
                    .addOption("include", t("deckFilterInclude"))
                    .addOption("exclude", t("deckFilterExclude"))
                    .setValue(this.plugin.settings.deckFilterMode)
                    .onChange(async (v) => {
                        if (v === "all" || v === "include" || v === "exclude") {
                            this.plugin.settings.deckFilterMode = v;
                            await this.plugin.saveSettings();
                        }
                    }),
            );

        new Setting(containerEl)
            .setName(t("settingsDeckFilterList"))
            .setDesc(t("settingsDeckFilterListDesc"))
            .addTextArea((text) => {
                text.setValue(this.plugin.settings.deckFilterList.join("\n")).onChange(
                    async (v) => {
                        this.plugin.settings.deckFilterList = normalizeDeckPaths(v.split("\n"));
                        await this.plugin.saveSettings();
                    },
                );
                text.inputEl.rows = 4;
                text.inputEl.placeholder = "flashcards/韓国語";
            });

        new Setting(containerEl)
            .setName(t("settingsDueOnly"))
            .setDesc(t("settingsDueOnlyDesc"))
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.dueCardsOnly).onChange(async (v) => {
                    this.plugin.settings.dueCardsOnly = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(containerEl)
            .setName(t("settingsShowDeckName"))
            .setDesc(t("settingsShowDeckNameDesc"))
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.showDeckName).onChange(async (v) => {
                    this.plugin.settings.showDeckName = v;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(containerEl)
            .setName(t("settingsCheckOnStartup"))
            .setDesc(t("settingsCheckOnStartupDesc"))
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.checkOnStartup).onChange(async (v) => {
                    this.plugin.settings.checkOnStartup = v;
                    await this.plugin.saveSettings();
                }),
            );
    }
}
