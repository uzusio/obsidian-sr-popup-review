import { App, moment } from "obsidian";

/**
 * Persistent diagnostics log. Console output is invisible unless DevTools is
 * open with the Verbose level enabled and vanishes on restart, which makes
 * after-the-fact troubleshooting ("popups seemed to stop yesterday")
 * impossible — so every scheduler decision and popup lifecycle event is also
 * appended to a size-capped file inside the plugin folder.
 */

const MAX_BYTES = 512 * 1024;
const KEEP_BYTES = 256 * 1024;

export class DiagLog {
    /** Serializes appends so concurrent log calls cannot interleave. */
    private queue: Promise<void> = Promise.resolve();

    constructor(
        private app: App,
        /** Vault-relative path, e.g. ".obsidian/plugins/sr-popup-review/diagnostics.log". */
        private filePath: string,
    ) {}

    /** Trims the file to its newest part once it outgrows the cap. */
    async init(): Promise<void> {
        try {
            const adapter = this.app.vault.adapter;
            if (!(await adapter.exists(this.filePath))) return;
            const stat = await adapter.stat(this.filePath);
            if (!stat || stat.size <= MAX_BYTES) return;
            const content = await adapter.read(this.filePath);
            const tail = content.slice(-KEEP_BYTES);
            const firstNewline = tail.indexOf("\n") + 1;
            await adapter.write(this.filePath, "[log trimmed]\n" + tail.slice(firstNewline));
        } catch (e) {
            console.error("[sr-popup-review] failed to trim diagnostics log", e);
        }
    }

    /** Appends a timestamped line (best effort) and mirrors it to the console. */
    log(message: string): void {
        console.debug(`[sr-popup-review] ${message}`);
        const line = `${moment().format("YYYY-MM-DD HH:mm:ss")} ${message}\n`;
        this.queue = this.queue.then(async () => {
            try {
                await this.app.vault.adapter.append(this.filePath, line);
            } catch {
                /* logging must never break the plugin */
            }
        });
    }
}
