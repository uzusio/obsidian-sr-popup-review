import { App, PluginSettingTab, Setting, moment } from "obsidian";
import type SRPopupPlugin from "./main";
import { normalizeDeckPaths } from "./sr-bridge";
import { isInQuietHours, quietHoursEndDate } from "./scheduler";
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
    deckFilterMode: "all" | "include";
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

        // Diagnosis: when the next automatic popup can appear (interval gate,
        // pushed back to the end of do-not-disturb if that is later).
        {
            const s = this.plugin.settings;
            const now = new Date();
            let nextAt = s.lastShownAt + s.intervalMinutes * 60_000;
            if (
                s.quietHoursEnabled &&
                isInQuietHours(now, s.quietHoursStart, s.quietHoursEnd)
            ) {
                const dndEnd = quietHoursEndDate(now, s.quietHoursEnd);
                if (dndEnd && dndEnd.getTime() > nextAt) nextAt = dndEnd.getTime();
            }
            const fmt = (ts: number): string => moment(ts).format("YYYY-MM-DD HH:mm");
            const lastText = s.lastShownAt === 0 ? t("lastPopupNever") : fmt(s.lastShownAt);
            const nextText =
                nextAt <= now.getTime()
                    ? t("nextPopupAsap")
                    : t("nextPopupAt", { time: fmt(nextAt) });
            new Setting(containerEl)
                .setName(t("settingsNextPopup"))
                .setDesc(t("settingsNextPopupDesc", { last: lastText, next: nextText }));
        }

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
                    .setValue(this.plugin.settings.deckFilterMode)
                    .onChange(async (v) => {
                        if (v === "all" || v === "include") {
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
     * Dual-list deck picker: available decks on the left, target decks on the
     * right, add/remove buttons in the middle. Lines are selected by clicking
     * (multi-select works via Ctrl/Shift); double-clicking a line also moves it.
     * Falls back to a plain textarea when the deck tree is unavailable
     * (SR still initializing).
     */
    private displayDeckPicker(containerEl: HTMLElement): void {
        const known = this.plugin.bridge.listDeckPaths();
        const listed = this.plugin.settings.deckFilterList;

        if (known.length === 0 && listed.length === 0) {
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
            .setDesc(t("deckPickerIncludeDesc"))
            .setHeading();

        const wrap = containerEl.createDiv({ cls: "sr-popup-duallist" });
        const makeColumn = (labelKey: string): HTMLSelectElement => {
            const column = wrap.createDiv({ cls: "sr-popup-duallist-col" });
            column.createDiv({ cls: "sr-popup-duallist-label", text: t(labelKey) });
            const select = column.createEl("select");
            select.multiple = true;
            select.size = 10;
            return select;
        };

        const left = makeColumn("deckAvailable");
        const buttons = wrap.createDiv({ cls: "sr-popup-duallist-buttons" });
        const right = makeColumn("deckTarget");

        for (const path of known.filter((p) => !listed.includes(p))) {
            left.createEl("option", { text: path, attr: { value: path } });
        }
        for (const rule of listed) {
            const label = known.includes(rule) ? rule : `${rule} — ${t("deckNotFound")}`;
            right.createEl("option", { text: label, attr: { value: rule } });
        }

        const add = async (): Promise<void> => {
            const selected = Array.from(left.selectedOptions).map((o) => o.value);
            if (selected.length === 0) return;
            const next = [...this.plugin.settings.deckFilterList];
            for (const path of selected) {
                if (!next.includes(path)) next.push(path);
            }
            this.plugin.settings.deckFilterList = next;
            await this.plugin.saveSettings();
            this.display();
        };
        const remove = async (): Promise<void> => {
            const selected = new Set(Array.from(right.selectedOptions).map((o) => o.value));
            if (selected.size === 0) return;
            this.plugin.settings.deckFilterList = this.plugin.settings.deckFilterList.filter(
                (rule) => !selected.has(rule),
            );
            await this.plugin.saveSettings();
            this.display();
        };

        const addButton = buttons.createEl("button", { text: t("deckAdd") });
        const removeButton = buttons.createEl("button", { text: t("deckRemove") });
        addButton.addEventListener("click", () => void add());
        removeButton.addEventListener("click", () => void remove());
        left.addEventListener("dblclick", () => void add());
        right.addEventListener("dblclick", () => void remove());
    }
}
