import esbuild from "esbuild";
import process from "process";
import { builtinModules } from "node:module";
import fs from "fs";
import path from "path";

const prod = process.argv.includes("production");
const watch = process.argv.includes("watch");

// Dev builds go straight into the test vault so Obsidian can load them.
// NEVER point this at a real vault: this plugin writes to SR scheduling data.
const TEST_VAULT_PLUGIN_DIR =
    "C:/work/sr-popup-test-vault/.obsidian/plugins/sr-popup-review";

const outdir = prod ? "." : TEST_VAULT_PLUGIN_DIR;

const copyAssets = {
    name: "copy-assets",
    setup(build) {
        build.onEnd((result) => {
            if (prod || result.errors.length > 0) return;
            fs.mkdirSync(outdir, { recursive: true });
            for (const f of ["manifest.json", "styles.css"]) {
                fs.copyFileSync(f, path.join(outdir, f));
            }
        });
    },
};

const context = await esbuild.context({
    entryPoints: ["src/main.ts"],
    bundle: true,
    external: [
        "obsidian",
        "electron",
        "@electron/remote",
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
    ],
    format: "cjs",
    target: "es2022",
    logLevel: "info",
    sourcemap: prod ? false : "inline",
    treeShaking: true,
    outfile: path.join(outdir, "main.js"),
    plugins: [copyAssets],
});

if (watch) {
    await context.watch();
} else {
    await context.rebuild();
    process.exit(0);
}
