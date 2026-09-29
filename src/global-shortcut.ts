import { getRemote } from "./popup";

// ---------------------------------------------------------------------------
// Structural type for the piece of @electron/remote this module touches.
// Optional members, guarded before use, for the same reason as popup.ts's
// ElectronRemoteLike: the remote bridge differs across Obsidian/Electron
// versions, so an absent API must degrade to "unavailable", not a crash.
// ---------------------------------------------------------------------------
export interface GlobalShortcutLike {
    register?: (accelerator: string, callback: () => void) => boolean;
    unregister?: (accelerator: string) => void;
}

export type ShortcutResult = "ok" | "unavailable" | "conflict" | "invalid";

/**
 * Owns the single system-wide accelerator this plugin may register with
 * Electron's globalShortcut. Deliberately narrow: it only ever registers and
 * unregisters the one accelerator it itself owns (never
 * `unregisterAll`, which would also rip out other plugins'/apps' shortcuts).
 */
export class GlobalShortcutManager {
    /** The accelerator currently registered by this plugin, if any. */
    private current: string | null = null;
    /** Set by suspend() while the settings UI is recording a new combo, so
     * resume() can restore it if the recording is cancelled or fails. */
    private suspended: string | null = null;

    constructor(
        private log: (message: string) => void,
        private onPress: () => void,
    ) {}

    /**
     * Registers `accelerator` as the plugin's global shortcut, replacing any
     * previous one. `""` clears it. Registration failure (no API, a throw, or
     * another app/vault already owning the combo) is an expected outcome, not
     * a crash: it is reported via the return value and the previous
     * registration (if any) is left untouched.
     */
    apply(accelerator: string): ShortcutResult {
        if (accelerator === "") {
            this.unregister();
            return "ok";
        }
        if (accelerator === this.current) return "ok";

        const globalShortcut = getRemote()?.globalShortcut;
        if (typeof globalShortcut?.register !== "function") {
            this.log(`global shortcut unavailable (cannot register ${accelerator})`);
            return "unavailable";
        }

        let registered: boolean;
        try {
            registered = globalShortcut.register(accelerator, () => {
                this.log("global shortcut pressed");
                this.onPress();
            });
        } catch (e) {
            this.log(`global shortcut ${accelerator} could not be registered: ${String(e)}`);
            return "invalid";
        }
        if (!registered) {
            this.log(`global shortcut ${accelerator} is already in use elsewhere (conflict)`);
            return "conflict";
        }

        const previous = this.current;
        if (previous !== null) {
            try {
                globalShortcut.unregister?.(previous);
            } catch (e) {
                this.log(`failed to unregister previous global shortcut ${previous}: ${String(e)}`);
            }
        }
        this.current = accelerator;
        this.suspended = null;
        return "ok";
    }

    /** Unregisters this plugin's shortcut, if any. Never unregisterAll(). */
    unregister(): void {
        if (this.current === null) return;
        try {
            getRemote()?.globalShortcut?.unregister?.(this.current);
        } catch (e) {
            this.log(`failed to unregister global shortcut: ${String(e)}`);
        }
        this.current = null;
    }

    /**
     * Temporarily releases the OS-level registration so the settings UI's key
     * recorder can see the raw keydown events for the accelerator's own keys
     * (while registered, the OS delivers them to this shortcut instead of the
     * page). No-op when nothing is registered.
     */
    suspend(): void {
        if (this.current === null) return;
        this.suspended = this.current;
        this.unregister();
    }

    /** Restores whatever suspend() released. No-op if there was nothing to restore. */
    resume(): void {
        if (this.suspended === null) return;
        const accelerator = this.suspended;
        this.suspended = null;
        this.apply(accelerator);
    }
}
