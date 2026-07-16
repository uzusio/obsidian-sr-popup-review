import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";

export default tseslint.config(
    {
        ignores: ["main.js", "esbuild.config.mjs", "eslint.config.mjs", "node_modules/**"],
    },
    ...tseslint.configs.recommendedTypeChecked,
    ...obsidianmd.configs.recommended,
    {
        files: ["src/**/*.ts"],
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
);
