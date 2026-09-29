import { Notice } from "obsidian";

/** Every user-facing notice message uses this prefix (see i18n.ts). */
const NOTICE_PREFIX = "Popup Review for Spaced Repetition: ";
const NOTIFICATION_TITLE = "Popup Review for Spaced Repetition";

/**
 * Shows the usual in-app Notice, and — when Obsidian's window does not have
 * focus (minimized, or the user is in another app) — also tries an OS-level
 * Notification, since a Notice inside an unfocused/minimized window can go
 * completely unseen. This matters for the scheduler, whose automatic popups
 * are the whole point of running while Obsidian is in the background.
 *
 * Fail-safe: the Notification API is best-effort only. Any failure (not
 * supported, permission not granted, thrown error) is swallowed; the Notice
 * above has already informed the user via Obsidian's own UI.
 */
export function notify(message: string): void {
    new Notice(message);
    if (document.hasFocus()) return;
    try {
        if (typeof Notification !== "function") return;
        if (Notification.permission === "denied") return;
        const body = message.startsWith(NOTICE_PREFIX)
            ? message.slice(NOTICE_PREFIX.length)
            : message;
        new Notification(NOTIFICATION_TITLE, { body });
    } catch {
        /* best-effort; the Notice already covered this */
    }
}
