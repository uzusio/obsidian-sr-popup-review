import { Platform } from "obsidian";
import { execFile } from "child_process";
import { Buffer } from "buffer";

/**
 * Windows-only detection of a fullscreen app / presentation in the foreground,
 * via SHQueryUserNotificationState — the same signal the OS uses to suppress
 * its own toast notifications. Fails open (false) on any error or timeout,
 * and is a no-op on non-Windows platforms.
 */

const QUERY_SCRIPT =
    'Add-Type -TypeDefinition \'using System.Runtime.InteropServices; public class Q { [DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int s); }\'; $s = 0; [void][Q]::SHQueryUserNotificationState([ref]$s); $s';

// PowerShell's -EncodedCommand takes the script as Base64(UTF-16LE), which
// sidesteps every layer of command-line quoting (argv → PowerShell → C#).
const ENCODED_QUERY = Buffer.from(QUERY_SCRIPT, "utf16le").toString("base64");

// QUNS values: 2 = BUSY (fullscreen window, e.g. F11 / borderless games),
// 3 = D3D exclusive fullscreen, 4 = presentation mode.
const FULLSCREEN_STATES = new Set([2, 3, 4]);
const CHECK_TIMEOUT_MS = 4000;

export function isFullscreenAppActive(): Promise<boolean> {
    if (!Platform.isWin) return Promise.resolve(false);
    return new Promise((resolve) => {
        try {
            execFile(
                "powershell.exe",
                ["-NoProfile", "-NonInteractive", "-EncodedCommand", ENCODED_QUERY],
                { timeout: CHECK_TIMEOUT_MS, windowsHide: true },
                (error, stdout) => {
                    if (error) {
                        resolve(false);
                        return;
                    }
                    const state = Number.parseInt(stdout.trim(), 10);
                    resolve(FULLSCREEN_STATES.has(state));
                },
            );
        } catch {
            resolve(false);
        }
    });
}
