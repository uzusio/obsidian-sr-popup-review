import { App, PluginSettingTab, Setting } from "obsidian";
import type SRPopupPlugin from "./main";
import { normalizeDeckPaths } from "./sr-bridge";
import { setLocaleOverride, t } from "./i18n";

export interface SRPopupSettings {
    /** "-" = follow Obsidian's app language. */
    language: "-" | "en" | "ja";
    intervalMinutes: number;
    quietHoursEnabled: boolean;
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
    language: "-",
    intervalMinutes: 120,
    quietHoursEnabled: true,
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

        new Setting(containerEl)
            .setName(t("settingsLanguage"))
            .setDesc(t("settingsLanguageDesc"))
            .addDropdown((dropdown) =>
                dropdown
                    .addOption("-", t("languageDefault"))
                    .addOption("en", "English")
                    .addOption("ja", "日本語")
                    .setValue(this.plugin.settings.language)
                    .onChange(async (v) => {
                        if (v === "-" || v === "en" || v === "ja") {
                            this.plugin.settings.language = v;
                            setLocaleOverride(v);
                            await this.plugin.saveSettings();
                            this.display(); // re-render the tab in the new language
                        }
                    }),
            );

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

        const quiet = new Setting(containerEl)
            .setName(t("settingsQuietHours"))
            .setDesc(t("settingsQuietHoursDesc"));
        quiet.addToggle((toggle) =>
            toggle.setValue(this.plugin.settings.quietHoursEnabled).onChange(async (v) => {
                this.plugin.settings.quietHoursEnabled = v;
                await this.plugin.saveSettings();
                this.display(); // enable/disable the time inputs
            }),
        );
        const addTimeInput = (value: string, save: (v: string) => void) => {
            quiet.addText((text) => {
                text.setValue(value).onChange(async (v) => {
                    if (HHMM_RE.test(v.trim())) {
                        save(v.trim());
                        await this.plugin.saveSettings();
                    }
                });
                text.inputEl.type = "time";
                text.inputEl.disabled = !this.plugin.settings.quietHoursEnabled;
            });
        };
        addTimeInput(this.plugin.settings.quietHoursStart, (v) => {
            this.plugin.settings.quietHoursStart = v;
        });
        const separator = quiet.controlEl.createSpan({ text: "〜" });
        separator.style.margin = "0 4px";
        addTimeInput(this.plugin.settings.quietHoursEnd, (v) => {
            this.plugin.settings.quietHoursEnd = v;
        });

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
                            this.display(); // show/hide the deck picker
                        }
                    }),
            );

        if (this.plugin.settings.deckFilterMode !== "all") {
            this.displayDeckPicker(containerEl);
        }

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

    /**
     * Deck picker: toggles for every deck SR currently knows, in tree order with
     * indentation. A listed deck covers its subdecks, so decks implied by a listed
     * ancestor show as checked-but-disabled. Falls back to a plain textarea when
     * the deck tree is unavailable (SR still initializing).
     */
    private displayDeckPicker(containerEl: HTMLElement): void {
        const decks = this.plugin.bridge.listDeckPaths();

        if (decks.length === 0) {
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
            return;
        }

        new Setting(containerEl)
            .setName(t("settingsDeckFilterList"))
            .setDesc(
                t(
                    this.plugin.settings.deckFilterMode === "include"
                        ? "deckPickerIncludeDesc"
                        : "deckPickerExcludeDesc",
                ),
            )
            .setHeading();

        const list = () => this.plugin.settings.deckFilterList;
        const coveringAncestor = (path: string): string | undefined =>
            list().find((rule) => rule !== path && path.startsWith(rule + "/"));

        for (const path of decks) {
            const depth = path.split("/").length - 1;
            const leaf = path.split("/").pop() ?? path;
            const ancestor = coveringAncestor(path);
            const row = new Setting(containerEl)
                .setName(leaf)
                .setDesc(ancestor ? t("deckImplied", { parent: ancestor }) : path);
            row.settingEl.style.paddingLeft = `${depth * 24}px`;
            row.addToggle((toggle) =>
                toggle
                    .setValue(ancestor !== undefined || list().includes(path))
                    .setDisabled(ancestor !== undefined)
                    .onChange(async (v) => {
                        let next = list().filter((rule) => rule !== path);
                        if (v) {
                            // a new ancestor rule makes explicit descendant rules redundant
                            next = next.filter((rule) => !rule.startsWith(path + "/"));
                            next.push(path);
                        }
                        this.plugin.settings.deckFilterList = next;
                        await this.plugin.saveSettings();
                        this.display();
                    }),
            );
        }

        // Entries on the list that no current deck matches (renamed/empty decks etc.)
        for (const rule of list().filter((r) => !decks.includes(r))) {
            new Setting(containerEl)
                .setName(rule)
                .setDesc(t("deckNotFound"))
                .addExtraButton((button) =>
                    button
                        .setIcon("trash")
                        .setTooltip(t("remove"))
                        .onClick(async () => {
                            this.plugin.settings.deckFilterList = list().filter(
                                (r) => r !== rule,
                            );
                            await this.plugin.saveSettings();
                            this.display();
                        }),
                );
        }
    }
}
