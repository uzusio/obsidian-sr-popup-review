import { App, PluginSettingTab, moment } from "obsidian";
import type { Setting, SettingDefinitionItem, SettingGroup } from "obsidian";
import type SRPopupPlugin from "./main";
import { normalizeDeckPaths } from "./sr-bridge";
import { isInQuietHours, quietHoursEndDate } from "./scheduler";
import {
    DEFAULT_HEIGHT_FRONT,
    DEFAULT_HEIGHT_REVEALED,
    DEFAULT_WIDTH,
    MIN_HEIGHT,
    MIN_WIDTH,
} from "./popup";
import { setLocaleOverride, t } from "./i18n";

export interface SRPopupSettings {
    /** "-" = follow Obsidian's app language. */
    language: "-" | "en" | "ja";
    /** Pause switch: no automatic popups while true (manual command still works). */
    paused: boolean;
    intervalMinutes: number;
    quietHoursEnabled: boolean;
    quietHoursStart: string;
    quietHoursEnd: string;
    autoCloseSeconds: number;
    /** Whether never-reviewed cards are introduced when nothing is due. */
    newCardsMode: "none" | "limited" | "unlimited";
    /** Daily cap used when newCardsMode is "limited". */
    newCardsPerDay: number;
    /** Persisted state: date ("YYYY-MM-DD") and count of new cards shown that day. */
    newCardsShownDate: string;
    newCardsShownCount: number;
    randomizeDeckOrder: boolean;
    /** Skip (postpone) popups while a fullscreen app / presentation is active (Windows only). */
    pauseDuringFullscreen: boolean;
    deckFilterMode: "all" | "include";
    deckFilterList: string[];
    showDeckName: boolean;
    checkOnStartup: boolean;
    /** Persisted state, not user-facing: epoch ms of the last popup. */
    lastShownAt: number;
    /** Persisted state: no automatic popups before this time (snooze from the popup menu). */
    snoozeUntil: number;
    /** Default popup size; null = built-in defaults. */
    popupWidth: number | null;
    popupHeightFront: number | null;
    popupHeightRevealed: number | null;
}

export const DEFAULT_SETTINGS: SRPopupSettings = {
    language: "-",
    paused: false,
    intervalMinutes: 120,
    quietHoursEnabled: true,
    quietHoursStart: "01:00",
    quietHoursEnd: "09:00",
    autoCloseSeconds: 90,
    newCardsMode: "limited",
    newCardsPerDay: 10,
    newCardsShownDate: "",
    newCardsShownCount: 0,
    randomizeDeckOrder: true,
    pauseDuringFullscreen: true,
    deckFilterMode: "all",
    deckFilterList: [],
    showDeckName: true,
    checkOnStartup: false,
    lastShownAt: 0,
    snoozeUntil: 0,
    popupWidth: null,
    popupHeightFront: null,
    popupHeightRevealed: null,
};

const HHMM_RE = /^(\d{1,2}):(\d{2})$/;
const MIN_INTERVAL_MINUTES = 5;

/**
 * Declarative settings tab (Obsidian 1.13+). Every row is a definition so it
 * reaches the settings search; rows whose controls the framework cannot express
 * (popup size, do-not-disturb range, deck picker) use `render` instead.
 *
 * Definitions are rebuilt on every update() because their labels come from t():
 * switching the language re-renders the tab in the new one.
 */
export class SRPopupSettingTab extends PluginSettingTab {
    constructor(
        app: App,
        private plugin: SRPopupPlugin,
    ) {
        super(app, plugin);
    }

    getSettingDefinitions(): SettingDefinitionItem[] {
        return [
            {
                name: t("settingsLanguage"),
                desc: t("settingsLanguageDesc"),
                control: {
                    type: "dropdown",
                    key: "language",
                    options: { "-": t("languageDefault"), en: "English", ja: "日本語" },
                },
            },
            { name: t("settingsStatus"), desc: this.statusDesc() },
            { name: t("settingsNextPopup"), desc: this.scheduleDesc() },
            {
                name: t("settingsPaused"),
                desc: t("settingsPausedDesc"),
                control: { type: "toggle", key: "paused" },
            },
            {
                name: t("settingsInterval"),
                desc: t("settingsIntervalDesc"),
                control: {
                    type: "number",
                    key: "intervalMinutes",
                    min: MIN_INTERVAL_MINUTES,
                    step: 1,
                    validate: (v) => {
                        if (!Number.isFinite(v) || v < MIN_INTERVAL_MINUTES) {
                            return t("settingsIntervalInvalid");
                        }
                    },
                },
            },
            {
                name: t("popupSizeName"),
                desc: t("popupSizeDesc", {
                    w: DEFAULT_WIDTH,
                    hf: DEFAULT_HEIGHT_FRONT,
                    hr: DEFAULT_HEIGHT_REVEALED,
                }),
                render: (setting) => {
                    this.renderPopupSize(setting);
                },
            },
            {
                name: t("settingsQuietHours"),
                desc: t("settingsQuietHoursDesc"),
                render: (setting) => {
                    this.renderQuietHours(setting);
                },
            },
            {
                name: t("settingsAutoClose"),
                desc: t("settingsAutoCloseDesc"),
                control: {
                    type: "number",
                    key: "autoCloseSeconds",
                    min: 0,
                    step: 1,
                    validate: (v) => {
                        if (!Number.isFinite(v) || v < 0) return t("settingsAutoCloseInvalid");
                    },
                },
            },
            {
                name: t("settingsDeckFilterMode"),
                desc: t("settingsDeckFilterModeDesc"),
                control: {
                    type: "dropdown",
                    key: "deckFilterMode",
                    options: { all: t("deckFilterAll"), include: t("deckFilterInclude") },
                },
            },
            {
                name: t("settingsDeckFilterList"),
                desc: t("settingsDeckFilterListDesc"),
                visible: () => this.plugin.settings.deckFilterMode !== "all",
                render: (setting, group) => this.renderDeckPicker(setting, group),
            },
            {
                name: t("settingsNewMode"),
                desc: t("settingsNewModeDesc"),
                control: {
                    type: "dropdown",
                    key: "newCardsMode",
                    options: {
                        none: t("newModeNone"),
                        limited: t("newModeLimited"),
                        unlimited: t("newModeUnlimited"),
                    },
                },
            },
            {
                name: t("settingsNewPerDay"),
                desc: t("settingsNewPerDayDesc"),
                visible: () => this.plugin.settings.newCardsMode === "limited",
                control: {
                    type: "number",
                    key: "newCardsPerDay",
                    min: 1,
                    step: 1,
                    validate: (v) => {
                        if (!Number.isFinite(v) || v < 1) return t("settingsNewPerDayInvalid");
                    },
                },
            },
            {
                name: t("settingsRandomDeck"),
                desc: t("settingsRandomDeckDesc"),
                control: { type: "toggle", key: "randomizeDeckOrder" },
            },
            {
                name: t("settingsFullscreen"),
                desc: t("settingsFullscreenDesc"),
                control: { type: "toggle", key: "pauseDuringFullscreen" },
            },
            {
                name: t("settingsShowDeckName"),
                desc: t("settingsShowDeckNameDesc"),
                control: { type: "toggle", key: "showDeckName" },
            },
            {
                name: t("settingsCheckOnStartup"),
                desc: t("settingsCheckOnStartupDesc"),
                control: { type: "toggle", key: "checkOnStartup" },
            },
        ];
    }

    getControlValue(key: string): unknown {
        return (this.plugin.settings as unknown as Record<string, unknown>)[key];
    }

    /**
     * Every key is handled here rather than by the default implementation, so
     * that all writes go through the plugin's saveSettings() and so that keys
     * with side effects (locale, pause state, dependent rows) can trigger them.
     */
    async setControlValue(key: string, value: unknown): Promise<void> {
        switch (key) {
            case "language": {
                if (value !== "-" && value !== "en" && value !== "ja") return;
                this.plugin.settings.language = value;
                setLocaleOverride(value);
                await this.plugin.saveSettings();
                this.update(); // rebuild every label in the new language
                return;
            }
            case "paused": {
                if (typeof value !== "boolean") return;
                await this.plugin.setPaused(value); // also saves and updates the status bar
                this.update(); // refresh the schedule line
                return;
            }
            case "deckFilterMode": {
                if (value !== "all" && value !== "include") return;
                this.plugin.settings.deckFilterMode = value;
                await this.plugin.saveSettings();
                this.update(); // show/hide the deck picker
                return;
            }
            case "newCardsMode": {
                if (value !== "none" && value !== "limited" && value !== "unlimited") return;
                this.plugin.settings.newCardsMode = value;
                await this.plugin.saveSettings();
                this.update(); // show/hide the per-day cap
                return;
            }
            case "intervalMinutes":
            case "autoCloseSeconds":
            case "newCardsPerDay": {
                if (typeof value !== "number" || !Number.isFinite(value)) return;
                this.plugin.settings[key] = Math.round(value);
                await this.plugin.saveSettings();
                return;
            }
            case "randomizeDeckOrder":
            case "pauseDuringFullscreen":
            case "showDeckName":
            case "checkOnStartup": {
                if (typeof value !== "boolean") return;
                this.plugin.settings[key] = value;
                await this.plugin.saveSettings();
                return;
            }
        }
    }

    private statusDesc(): string {
        const probe = this.plugin.bridge.probe();
        const version = this.plugin.bridge.getSRPlugin()?.manifest?.version ?? "?";
        return probe.status === "ok"
            ? t("settingsStatusOk", { version })
            : t("settingsStatusNg", { reason: probe.reason ?? "?" });
    }

    /**
     * Diagnosis: when the next automatic popup can appear (interval gate,
     * pushed back to the end of do-not-disturb if that is later).
     */
    private scheduleDesc(): string {
        const s = this.plugin.settings;
        const now = new Date();
        let nextAt = s.lastShownAt + s.intervalMinutes * 60_000;
        if (s.quietHoursEnabled && isInQuietHours(now, s.quietHoursStart, s.quietHoursEnd)) {
            const dndEnd = quietHoursEndDate(now, s.quietHoursEnd);
            if (dndEnd && dndEnd.getTime() > nextAt) nextAt = dndEnd.getTime();
        }
        const fmt = (ts: number): string => moment(ts).format("YYYY-MM-DD HH:mm");
        const lastText = s.lastShownAt === 0 ? t("lastPopupNever") : fmt(s.lastShownAt);
        const backoffUntil = this.plugin.scheduler.getNothingDueUntil();
        const nextText = this.plugin.popup.isOpen
            ? t("popupOpenNow")
            : s.paused
              ? t("pausedNow")
              : s.snoozeUntil > now.getTime()
                ? t("snoozedNow", { time: fmt(s.snoozeUntil) })
                : backoffUntil > now.getTime()
                  ? t("nextPopupBackoff", { time: fmt(backoffUntil) })
                  : nextAt <= now.getTime()
                    ? t("nextPopupAsap")
                    : t("nextPopupAt", { time: fmt(nextAt) });
        return t("settingsNextPopupDesc", { last: lastText, next: nextText });
    }

    /** Width / question height / answer height; an empty field means the default. */
    private renderPopupSize(setting: Setting): void {
        const addSizeInput = (
            value: number | null,
            fallback: number,
            min: number,
            save: (v: number | null) => void,
        ): void => {
            setting.addText((text) => {
                text.setPlaceholder(String(fallback));
                text.setValue(value === null ? "" : String(value));
                text.onChange(async (raw) => {
                    const trimmed = raw.trim();
                    if (trimmed === "") {
                        save(null); // empty = back to the built-in default
                        await this.plugin.saveSettings();
                        return;
                    }
                    const n = Number(trimmed);
                    if (Number.isFinite(n) && n >= min) {
                        save(Math.round(n));
                        await this.plugin.saveSettings();
                    }
                });
            });
        };
        addSizeInput(this.plugin.settings.popupWidth, DEFAULT_WIDTH, MIN_WIDTH, (v) => {
            this.plugin.settings.popupWidth = v;
        });
        setting.controlEl.createSpan({ text: "×", cls: "sr-popup-separator" });
        addSizeInput(
            this.plugin.settings.popupHeightFront,
            DEFAULT_HEIGHT_FRONT,
            MIN_HEIGHT,
            (v) => {
                this.plugin.settings.popupHeightFront = v;
            },
        );
        setting.controlEl.createSpan({ text: "/", cls: "sr-popup-separator" });
        addSizeInput(
            this.plugin.settings.popupHeightRevealed,
            DEFAULT_HEIGHT_REVEALED,
            MIN_HEIGHT,
            (v) => {
                this.plugin.settings.popupHeightRevealed = v;
            },
        );
    }

    /** On/off plus the time range; the inputs follow the toggle without a re-render. */
    private renderQuietHours(setting: Setting): void {
        const timeInputs: HTMLInputElement[] = [];
        setting.addToggle((toggle) =>
            toggle.setValue(this.plugin.settings.quietHoursEnabled).onChange(async (v) => {
                this.plugin.settings.quietHoursEnabled = v;
                await this.plugin.saveSettings();
                for (const input of timeInputs) input.disabled = !v;
            }),
        );
        const addTimeInput = (value: string, save: (v: string) => void): void => {
            setting.addText((text) => {
                text.setValue(value).onChange(async (v) => {
                    if (HHMM_RE.test(v.trim())) {
                        save(v.trim());
                        await this.plugin.saveSettings();
                    }
                });
                text.inputEl.type = "time";
                text.inputEl.disabled = !this.plugin.settings.quietHoursEnabled;
                timeInputs.push(text.inputEl);
            });
        };
        addTimeInput(this.plugin.settings.quietHoursStart, (v) => {
            this.plugin.settings.quietHoursStart = v;
        });
        setting.controlEl.createSpan({ text: "〜", cls: "sr-popup-separator" });
        addTimeInput(this.plugin.settings.quietHoursEnd, (v) => {
            this.plugin.settings.quietHoursEnd = v;
        });
    }

    /**
     * Dual-list deck picker: available decks on the left, target decks on the
     * right, add/remove buttons in the middle. Lines are selected by clicking
     * (multi-select works via Ctrl/Shift); double-clicking a line also moves it.
     * Falls back to a plain textarea when the deck tree is unavailable
     * (SR still initializing).
     */
    private renderDeckPicker(setting: Setting, group: SettingGroup): (() => void) | void {
        const known = this.plugin.bridge.listDeckPaths();
        const listed = this.plugin.settings.deckFilterList;

        if (known.length === 0 && listed.length === 0) {
            setting.addTextArea((text) => {
                text.setValue(listed.join("\n")).onChange(async (v) => {
                    this.plugin.settings.deckFilterList = normalizeDeckPaths(v.split("\n"));
                    await this.plugin.saveSettings();
                });
                text.inputEl.rows = 4;
                text.inputEl.placeholder = "Flashcards/韓国語";
            });
            return;
        }

        setting.setDesc(t("deckPickerIncludeDesc")).setHeading();

        // The dual list is far wider than a row's control area, so it lives
        // after the row and is removed again when that row is torn down.
        const wrap = group.listEl.createDiv({ cls: "sr-popup-duallist" });
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
            this.update();
        };
        const remove = async (): Promise<void> => {
            const selected = new Set(Array.from(right.selectedOptions).map((o) => o.value));
            if (selected.size === 0) return;
            this.plugin.settings.deckFilterList = this.plugin.settings.deckFilterList.filter(
                (rule) => !selected.has(rule),
            );
            await this.plugin.saveSettings();
            this.update();
        };

        const addButton = buttons.createEl("button", { text: t("deckAdd") });
        const removeButton = buttons.createEl("button", { text: t("deckRemove") });
        addButton.addEventListener("click", () => void add());
        removeButton.addEventListener("click", () => void remove());
        left.addEventListener("dblclick", () => void add());
        right.addEventListener("dblclick", () => void remove());

        return () => {
            wrap.remove();
        };
    }
}
