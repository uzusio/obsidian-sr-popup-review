import { Notice } from "obsidian";
import type SRPopupPlugin from "./main";
import { t } from "./i18n";

const TICK_MS = 60_000;
const STARTUP_DELAY_MS = 15_000;
/** SR indexes the vault on startup; on large vaults 15 s is not enough, so retry. */
const STARTUP_MAX_ATTEMPTS = 8;

/**
 * auto    — the regular 1-minute tick; honors the popup interval and do-not-disturb.
 * startup — the check-on-startup tick; ignores the interval, honors do-not-disturb,
 *           logs every skip reason to the console for diagnosis.
 * manual  — the "show popup now" command; ignores all gates and shows notices.
 */
export type TickMode = "auto" | "startup" | "manual";

export class Scheduler {
    private ticking = false;
    private warnedIncompatible = false;

    constructor(private plugin: SRPopupPlugin) {}

    start(): void {
        this.plugin.registerInterval(window.setInterval(() => void this.tick("auto"), TICK_MS));
        if (this.plugin.settings.checkOnStartup) {
            this.scheduleStartupCheck(1);
        }
    }

    async tick(mode: TickMode): Promise<void> {
        if (this.ticking) return;
        this.ticking = true;
        try {
            await this.doTick(mode);
        } finally {
            this.ticking = false;
        }
    }

    private scheduleStartupCheck(attempt: number): void {
        window.setTimeout(() => void this.startupCheck(attempt), STARTUP_DELAY_MS);
    }

    private async startupCheck(attempt: number): Promise<void> {
        const probe = this.plugin.bridge.probe();
        if (probe.status === "notReady" && attempt < STARTUP_MAX_ATTEMPTS) {
            console.debug(
                `[sr-popup-review] startup check ${attempt}/${STARTUP_MAX_ATTEMPTS}: Spaced Repetition not ready yet, retrying in ${STARTUP_DELAY_MS / 1000}s`,
            );
            this.scheduleStartupCheck(attempt + 1);
            return;
        }
        await this.tick("startup");
    }

    private async doTick(mode: TickMode): Promise<void> {
        const s = this.plugin.settings;
        const log = (message: string): void => {
            if (mode === "startup") console.debug(`[sr-popup-review] startup check: ${message}`);
        };
        if (this.plugin.popup.isOpen) {
            log("a popup is already open");
            return;
        }
        if (mode === "auto" && Date.now() - s.lastShownAt < s.intervalMinutes * 60_000) return;
        if (
            mode !== "manual" &&
            s.quietHoursEnabled &&
            isInQuietHours(new Date(), s.quietHoursStart, s.quietHoursEnd)
        ) {
            log("inside do-not-disturb hours");
            return;
        }
        const probe = this.plugin.bridge.probe();
        if (probe.status !== "ok") {
            log(`integration unavailable (${probe.status}: ${probe.reason ?? "?"})`);
            if (mode === "manual") {
                if (probe.status === "missing") new Notice(t("srMissing"));
                else if (probe.status === "notReady") new Notice(t("srNotReady"));
                else new Notice(t("incompatible", { reason: probe.reason ?? "?" }));
            } else if (probe.status === "incompatible" && !this.warnedIncompatible) {
                // SR is installed but its internals don't match what we verified:
                // warn once and never write through an unknown path.
                // "missing"/"notReady" are normal transient states — stay silent.
                this.warnedIncompatible = true;
                new Notice(t("incompatible", { reason: probe.reason ?? "?" }));
            }
            return;
        }
        if (mode !== "manual" && this.plugin.bridge.isSRReviewUIOpen()) {
            log("SR's own review UI is in focus");
            return;
        }

        const session = await this.plugin.bridge.openSession(s.dueCardsOnly, {
            mode: s.deckFilterMode,
            paths: s.deckFilterList,
        });
        if (!session) {
            log("no card matches (nothing due, or filtered out by the deck filter)");
            if (mode === "manual") new Notice(t("nothingDue"));
            return;
        }
        s.lastShownAt = Date.now();
        await this.plugin.saveSettings();
        const shown = await this.plugin.popup.show(session, s.autoCloseSeconds, s.showDeckName);
        if (!shown) {
            log("popup window failed to open");
            if (mode === "manual") new Notice(t("popupFailed"));
        }
    }
}

/** Do-not-disturb check; supports ranges that cross midnight (e.g. 23:00–07:00). */
export function isInQuietHours(now: Date, start: string, end: string): boolean {
    const a = parseHhmm(start);
    const b = parseHhmm(end);
    if (a === null || b === null || a === b) return false;
    const cur = now.getHours() * 60 + now.getMinutes();
    return a < b ? cur >= a && cur < b : cur >= a || cur < b;
}

/** Next moment the do-not-disturb window ends (call only while inside the window). */
export function quietHoursEndDate(now: Date, end: string): Date | null {
    const min = parseHhmm(end);
    if (min === null) return null;
    const d = new Date(now);
    d.setHours(Math.floor(min / 60), min % 60, 0, 0);
    if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
    return d;
}

function parseHhmm(hhmm: string): number | null {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
}
