import { App, Platform, PluginSettingTab, moment } from "obsidian";
import type { ButtonComponent, ExtraButtonComponent, Setting, SettingDefinitionItem } from "obsidian";
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
import type { ShortcutResult } from "./global-shortcut";
import { DEFAULT_MIRROR_PORT, MIRROR_PORT_MAX, MIRROR_PORT_MIN, isValidMirrorPort } from "./mirror-server";
import { setLocaleOverride, t } from "./i18n";

export interface SRPopupSettings {
    /** "-" = follow Obsidian's app language. */
    language: "-" | "en" | "ja";
    /** Pause switch: no automatic popups while true (manual command still works). */
    paused: boolean;
    /** Electron accelerator for the system-wide show-popup shortcut; "" = off. */
    globalShortcut: string;
    /** Mirror the popup to a local web page (http://127.0.0.1:<mirrorPort>/). */
    mirrorEnabled: boolean;
    mirrorPort: number;
    intervalMinutes: number;
    quietHoursEnabled: boolean;
    quietHoursStart: string;
    quietHoursEnd: string;
    autoCloseSeconds: number;
    /** Whether never-reviewed cards are mixed in with due cards (and with what cap). */
    newCardsMode: "none" | "limited" | "unlimited";
    /** Daily cap used when newCardsMode is "limited". */
    newCardsPerDay: number;
    /** Fix the share of new cards (instead of following the remaining counts). */
    newCardRatioEnabled: boolean;
    /** Share of new cards in percent (0-100), used when newCardRatioEnabled. */
    newCardRatio: number;
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

export const DEFAULT_NEW_CARD_RATIO = 67;

export const DEFAULT_SETTINGS: SRPopupSettings = {
    language: "-",
    paused: false,
    globalShortcut: "",
    mirrorEnabled: false,
    mirrorPort: DEFAULT_MIRROR_PORT,
    intervalMinutes: 120,
    quietHoursEnabled: true,
    quietHoursStart: "01:00",
    quietHoursEnd: "09:00",
    autoCloseSeconds: 90,
    newCardsMode: "limited",
    newCardsPerDay: 10,
    newCardRatioEnabled: false,
    newCardRatio: DEFAULT_NEW_CARD_RATIO,
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

// ---------------------------------------------------------------------------
// Global-shortcut key recorder: KeyboardEvent.code -> Electron accelerator key
// name, and the reverse (accelerator -> display string). Data-driven so the
// mapping is a lookup, not scattered conditionals.
// ---------------------------------------------------------------------------

const MODIFIER_CODES = new Set([
    "ControlLeft",
    "ControlRight",
    "AltLeft",
    "AltRight",
    "ShiftLeft",
    "ShiftRight",
    "MetaLeft",
    "MetaRight",
]);

/** Fixed (non-alphanumeric, non-F-key, non-numpad) code -> accelerator key name. */
const CODE_TO_KEY: Record<string, string> = {
    Space: "Space",
    Enter: "Enter",
    Tab: "Tab",
    Backspace: "Backspace",
    Delete: "Delete",
    Insert: "Insert",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Escape: "Escape",
    Minus: "-",
    Equal: "=",
    BracketLeft: "[",
    BracketRight: "]",
    Backslash: "\\",
    Semicolon: ";",
    Quote: "'",
    Comma: ",",
    Period: ".",
    Slash: "/",
    Backquote: "`",
};

const KEY_LETTER_RE = /^Key([A-Z])$/;
const DIGIT_RE = /^Digit([0-9])$/;
const F_KEY_RE = /^F(?:[1-9]|1\d|2[0-4])$/;
const NUMPAD_RE = /^Numpad([0-9])$/;

/** Converts a KeyboardEvent.code into the key part of an Electron accelerator,
 * or null when the code has no accelerator equivalent (recording continues). */
function codeToAcceleratorKey(code: string): string | null {
    const letter = KEY_LETTER_RE.exec(code);
    if (letter) return letter[1];
    const digit = DIGIT_RE.exec(code);
    if (digit) return digit[1];
    if (F_KEY_RE.test(code)) return code;
    const numpad = NUMPAD_RE.exec(code);
    if (numpad) return `num${numpad[1]}`;
    return CODE_TO_KEY[code] ?? null;
}

/** Builds an Electron accelerator string in the fixed modifier order. */
function buildAccelerator(mods: { ctrl: boolean; alt: boolean; shift: boolean; meta: boolean }, key: string): string {
    const parts: string[] = [];
    if (mods.ctrl) parts.push("Ctrl");
    if (mods.alt) parts.push("Alt");
    if (mods.shift) parts.push("Shift");
    if (mods.meta) parts.push("Super");
    parts.push(key);
    return parts.join("+");
}

/** "Super" displays as the platform's own modifier name; every other part is shown as-is. */
function formatAccelerator(accelerator: string): string {
    return accelerator
        .split("+")
        .map((part) => (part === "Super" ? (Platform.isMacOS ? "Cmd" : "Win") : part))
        .join(" + ");
}

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
            {
                name: t("settingsStatus"),
                // "notReady" is the only transient probe state; the others are
                // settled, so polling stops as soon as one of them is reached.
                render: (setting) =>
                    this.renderLiveDesc(
                        setting,
                        () => this.statusDesc(),
                        2_000,
                        () => this.plugin.bridge.probe().status !== "notReady",
                    ),
            },
            {
                name: t("settingsNextPopup"),
                render: (setting) => this.renderLiveDesc(setting, () => this.scheduleDesc(), 30_000),
            },
            {
                name: t("settingsPaused"),
                desc: t("settingsPausedDesc"),
                control: { type: "toggle", key: "paused" },
            },
            {
                name: t("settingsGlobalShortcut"),
                desc: t("settingsGlobalShortcutDesc"),
                render: (setting) => this.renderGlobalShortcut(setting),
            },
            {
                name: t("settingsMirror"),
                desc: t("settingsMirrorDesc"),
                control: { type: "toggle", key: "mirrorEnabled" },
            },
            {
                name: t("settingsMirrorPort"),
                desc: t("settingsMirrorPortDesc"),
                visible: () => this.plugin.settings.mirrorEnabled,
                control: {
                    type: "number",
                    key: "mirrorPort",
                    min: MIRROR_PORT_MIN,
                    max: MIRROR_PORT_MAX,
                    step: 1,
                    validate: (v) => {
                        if (!isValidMirrorPort(v)) return t("settingsMirrorPortInvalid");
                    },
                },
            },
            {
                name: t("settingsMirrorUrl"),
                visible: () => this.plugin.settings.mirrorEnabled,
                render: (setting) => this.renderMirrorUrl(setting),
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
                render: (setting) => this.renderDeckPicker(setting),
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
                name: t("settingsNewRatioEnabled"),
                desc: t("settingsNewRatioEnabledDesc"),
                visible: () => this.plugin.settings.newCardsMode !== "none",
                control: { type: "toggle", key: "newCardRatioEnabled" },
            },
            {
                name: t("settingsNewRatio"),
                desc: t("settingsNewRatioDesc"),
                visible: () =>
                    this.plugin.settings.newCardsMode !== "none" && this.plugin.settings.newCardRatioEnabled,
                control: {
                    type: "slider",
                    key: "newCardRatio",
                    min: 5,
                    max: 95,
                    step: 1,
                    displayFormat: (v) => `${v}%`,
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
                this.update(); // show/hide the per-day cap and the new-card share rows
                return;
            }
            case "newCardRatioEnabled": {
                if (typeof value !== "boolean") return;
                this.plugin.settings.newCardRatioEnabled = value;
                await this.plugin.saveSettings();
                this.update(); // show/hide the share slider
                return;
            }
            case "newCardRatio": {
                // No update(): rebuilding the tab would interrupt the drag.
                if (typeof value !== "number" || !Number.isFinite(value)) return;
                this.plugin.settings.newCardRatio = Math.min(100, Math.max(0, Math.round(value)));
                await this.plugin.saveSettings();
                return;
            }
            case "mirrorEnabled": {
                if (typeof value !== "boolean") return;
                await this.plugin.setMirrorEnabled(value); // saves and starts/stops the server
                this.update(); // show/hide the port and URL rows
                return;
            }
            case "mirrorPort": {
                // No update() here: rebuilding the tab would steal focus from the
                // port field while typing; the URL row refreshes itself.
                if (!isValidMirrorPort(value)) return;
                await this.plugin.setMirrorPort(value);
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

    /**
     * Live description row: the definition's `desc` string is evaluated once by
     * the framework and goes stale, so dynamic rows render their text here and
     * keep re-evaluating it while the tab is open. `until` ends the polling once
     * the row reaches a state that no longer changes on its own.
     */
    private renderLiveDesc(
        setting: Setting,
        desc: () => string,
        intervalMs: number,
        until?: () => boolean,
    ): () => void {
        let current: string | null = null;
        const apply = (): void => {
            const text = desc();
            if (text === current) return; // keep the user's text selection intact
            current = text;
            setting.setDesc(text);
        };
        apply();
        let timer: number | null = null;
        if (!until?.()) {
            timer = window.setInterval(() => {
                apply();
                if (until?.() && timer !== null) window.clearInterval(timer);
            }, intervalMs);
        }
        return () => {
            if (timer !== null) window.clearInterval(timer);
        };
    }

    /**
     * System-wide shortcut recorder: a button that, once clicked, captures the
     * next key combination pressed anywhere (not just while focused) and turns
     * it into an Electron accelerator. While recording, the plugin's own OS-level
     * registration is suspended (globalShortcut.suspend()) so its keys reach this
     * page's keydown handler instead of being swallowed by the OS shortcut.
     */
    private renderGlobalShortcut(setting: Setting): () => void {
        const statusEl = setting.descEl.createDiv({ cls: "sr-popup-shortcut-status" });
        let mainButton!: ButtonComponent;
        let clearButton!: ExtraButtonComponent;
        let recording: { cancel: () => void } | null = null;

        const clearStatus = (): void => {
            statusEl.hidden = true;
            statusEl.setText("");
            statusEl.removeClass("mod-warning");
        };
        const showStatus = (text: string, warning: boolean): void => {
            statusEl.setText(text);
            statusEl.hidden = false;
            statusEl.toggleClass("mod-warning", warning);
        };
        const messageForFailure = (state: ShortcutResult, keyDisplay: string): string | null => {
            switch (state) {
                case "conflict":
                    return t("shortcutConflict", { key: keyDisplay });
                case "invalid":
                    return t("shortcutInvalid", { key: keyDisplay });
                case "unavailable":
                    return t("shortcutUnavailable");
                default:
                    return null;
            }
        };
        /** Shows the persisted registration problem for the saved shortcut, if any. */
        const refreshPersistedStatus = (): void => {
            const accel = this.plugin.settings.globalShortcut;
            const state = this.plugin.globalShortcutState;
            const msg = accel !== "" && state !== "ok" ? messageForFailure(state, formatAccelerator(accel)) : null;
            if (msg) showStatus(msg, true);
            else clearStatus();
        };
        const idleDisplay = (): string => {
            const accel = this.plugin.settings.globalShortcut;
            return accel === "" ? t("shortcutNotSet") : formatAccelerator(accel);
        };
        const refreshIdle = (): void => {
            mainButton.buttonEl.removeClass("mod-cta");
            mainButton.setButtonText(idleDisplay());
            clearButton.setDisabled(this.plugin.settings.globalShortcut === "");
        };

        const startRecording = (): void => {
            if (recording) return;
            this.plugin.globalShortcut.suspend();
            mainButton.buttonEl.addClass("mod-cta");
            mainButton.setButtonText(t("shortcutRecording"));
            clearStatus();

            const held = { ctrl: false, alt: false, shift: false, meta: false };
            const showHeldModifiers = (): void => {
                const parts: string[] = [];
                if (held.ctrl) parts.push("Ctrl");
                if (held.alt) parts.push("Alt");
                if (held.shift) parts.push("Shift");
                if (held.meta) parts.push(Platform.isMacOS ? "Cmd" : "Win");
                mainButton.setButtonText(parts.length ? `${parts.join(" + ")} + …` : t("shortcutRecording"));
            };

            const finish = (accel: string): void => {
                stop();
                // End the recording UI state immediately; the accelerator itself
                // (idle text, clear-button enabled state) updates once the async
                // register call below settles.
                mainButton.buttonEl.removeClass("mod-cta");
                void (async (): Promise<void> => {
                    const result = await this.plugin.setGlobalShortcut(accel);
                    refreshIdle();
                    const display = formatAccelerator(accel);
                    if (result === "ok") {
                        showStatus(t("shortcutSaved", { key: display }), false);
                    } else {
                        const msg = messageForFailure(result, display);
                        if (msg) showStatus(msg, true);
                    }
                })();
            };
            const cancel = (): void => {
                stop();
                this.plugin.globalShortcut.resume();
                refreshIdle();
                refreshPersistedStatus();
            };

            const onKeydown = (e: KeyboardEvent): void => {
                e.preventDefault();
                e.stopPropagation();
                if (e.isComposing || e.key === "Process") return;

                if (MODIFIER_CODES.has(e.code)) {
                    held.ctrl = e.ctrlKey;
                    held.alt = e.altKey;
                    held.shift = e.shiftKey;
                    held.meta = e.metaKey;
                    showHeldModifiers();
                    return;
                }
                if (e.code === "Escape" && !e.ctrlKey && !e.altKey && !e.metaKey) {
                    cancel();
                    return;
                }
                const key = codeToAcceleratorKey(e.code);
                if (key === null) {
                    showStatus(t("shortcutUnsupportedKey"), true);
                    return;
                }
                if (!e.ctrlKey && !e.altKey && !e.metaKey) {
                    showStatus(t("shortcutNeedModifier"), true);
                    return;
                }
                finish(
                    buildAccelerator(
                        { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey },
                        key,
                    ),
                );
            };
            // Releasing a modifier before the final key must drop it from the live preview.
            const onKeyup = (e: KeyboardEvent): void => {
                if (!MODIFIER_CODES.has(e.code)) return;
                held.ctrl = e.ctrlKey;
                held.alt = e.altKey;
                held.shift = e.shiftKey;
                held.meta = e.metaKey;
                showHeldModifiers();
            };
            const onBlur = (): void => cancel();

            window.addEventListener("keydown", onKeydown, { capture: true });
            window.addEventListener("keyup", onKeyup, { capture: true });
            mainButton.buttonEl.addEventListener("blur", onBlur);
            const stop = (): void => {
                window.removeEventListener("keydown", onKeydown, { capture: true });
                window.removeEventListener("keyup", onKeyup, { capture: true });
                mainButton.buttonEl.removeEventListener("blur", onBlur);
                recording = null;
            };
            recording = { cancel };
        };

        setting.addButton((btn) => {
            mainButton = btn;
            btn.buttonEl.addClass("sr-popup-shortcut-button");
            btn.setButtonText(idleDisplay());
            btn.onClick(() => startRecording());
        });
        setting.addExtraButton((btn) => {
            clearButton = btn;
            btn.setIcon("x");
            btn.setTooltip(t("shortcutClear"));
            btn.setDisabled(this.plugin.settings.globalShortcut === "");
            btn.onClick(() => {
                void (async (): Promise<void> => {
                    await this.plugin.setGlobalShortcut("");
                    refreshIdle();
                    clearStatus();
                })();
            });
        });

        refreshPersistedStatus();

        return () => {
            if (recording) recording.cancel();
        };
    }

    /**
     * The local page's URL with the server's state (running / port in use /
     * unavailable), refreshed while the tab is open, plus a copy button.
     */
    private renderMirrorUrl(setting: Setting): () => void {
        const statusEl = setting.descEl.createDiv({ cls: "sr-popup-shortcut-status" });
        let current: string | null = null;
        const apply = (): void => {
            const url = this.plugin.mirrorUrl();
            let text: string;
            let warning = true;
            switch (this.plugin.mirrorState) {
                case "ok":
                    text = t("mirrorRunning", { url });
                    warning = false;
                    break;
                case "inUse":
                    text = t("mirrorInUse", { port: this.plugin.settings.mirrorPort });
                    break;
                case "unavailable":
                    text = t("mirrorUnavailable");
                    break;
                case "error":
                    text = t("mirrorError");
                    break;
                default:
                    text = url; // starting
                    warning = false;
            }
            const key = `${warning ? "!" : ""}${text}`;
            if (key === current) return; // keep the user's text selection intact
            current = key;
            statusEl.setText(text);
            statusEl.toggleClass("mod-warning", warning);
        };
        apply();
        const timer = window.setInterval(apply, 1_000);
        setting.addExtraButton((btn) => {
            btn.setIcon("copy");
            btn.setTooltip(t("mirrorCopy"));
            btn.onClick(() => {
                navigator.clipboard.writeText(this.plugin.mirrorUrl()).catch((e: unknown) => {
                    console.error("[sr-popup-review] failed to copy the local page URL", e);
                });
            });
        });
        return () => window.clearInterval(timer);
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
                text.inputEl.addClass("sr-popup-size-input");
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
    private renderDeckPicker(setting: Setting): (() => void) | void {
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

        // The dual list is far wider than a row's control area, so it wraps onto
        // its own line inside the row. It cannot sit beside the row in
        // group.listEl: Obsidian re-syncs that element to the setting rows only
        // and drops anything else. Removed again when the row is torn down.
        setting.settingEl.addClass("sr-popup-duallist-row");
        const wrap = setting.settingEl.createDiv({ cls: "sr-popup-duallist" });
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
            setting.settingEl.removeClass("sr-popup-duallist-row");
        };
    }
}
