import { Notice } from "obsidian";
import type SRPopupPlugin from "./main";
import { t } from "./i18n";

const TICK_MS = 60_000;
const STARTUP_DELAY_MS = 15_000;

export class Scheduler {
    private ticking = false;
    private warnedIncompatible = false;

    constructor(private plugin: SRPopupPlugin) {}

    start(): void {
        this.plugin.registerInterval(window.setInterval(() => void this.tick(false), TICK_MS));
        if (this.plugin.settings.checkOnStartup) {
            window.setTimeout(() => void this.tick(false), STARTUP_DELAY_MS);
        }
    }

    /** force=true (manual command) bypasses interval / quiet hours / SR-UI-open checks. */
    async tick(force: boolean): Promise<void> {
        if (this.ticking) return;
        this.ticking = true;
        try {
            await this.doTick(force);
        } finally {
            this.ticking = false;
        }
    }

    private async doTick(force: boolean): Promise<void> {
        const s = this.plugin.settings;
        if (this.plugin.popup.isOpen) return;
        if (!force) {
            if (Date.now() - s.lastShownAt < s.intervalMinutes * 60_000) return;
            if (
                s.quietHoursEnabled &&
                isInQuietHours(new Date(), s.quietHoursStart, s.quietHoursEnd)
            )
                return;
        }
        const probe = this.plugin.bridge.probe();
        if (probe.status !== "ok") {
            if (force) {
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
        if (!force && this.plugin.bridge.isSRReviewUIOpen()) return;

        const session = await this.plugin.bridge.openSession(s.dueCardsOnly, {
            mode: s.deckFilterMode,
            paths: s.deckFilterList,
        });
        if (!session) {
            if (force) new Notice(t("nothingDue"));
            return;
        }
        s.lastShownAt = Date.now();
        await this.plugin.saveSettings();
        const shown = await this.plugin.popup.show(session, s.autoCloseSeconds, s.showDeckName);
        if (!shown && force) new Notice(t("popupFailed"));
    }
}

/** Quiet-hours check; supports ranges that cross midnight (e.g. 23:00–07:00). */
export function isInQuietHours(now: Date, start: string, end: string): boolean {
    const a = parseHhmm(start);
    const b = parseHhmm(end);
    if (a === null || b === null || a === b) return false;
    const cur = now.getHours() * 60 + now.getMinutes();
    return a < b ? cur >= a && cur < b : cur >= a || cur < b;
}

function parseHhmm(hhmm: string): number | null {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
}
