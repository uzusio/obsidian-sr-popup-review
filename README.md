# Popup Review for Spaced Repetition

[日本語版 README はこちら / Japanese README](README.ja.md)

Review your [Spaced Repetition](https://github.com/st3v3nmw/obsidian-spaced-repetition) flashcards without opening Obsidian: a small always-on-top popup appears at regular intervals, shows one due card, and lets you reveal the answer and rate it (Again / Hard / Good / Easy) right in the popup.

Ratings are written through the Spaced Repetition plugin's **own review pipeline** (the same code path as its review modal), so your scheduling data stays fully consistent — no re-implementation of SM-2 or FSRS.

> ⚠ **Beta.** Not yet listed in the community plugin browser. Tested with Spaced Repetition **v1.15.4**.

## How it works

1. A scheduler checks at your configured interval (default: every 2 hours) whether any cards are due.
2. If so, a frameless popup appears at the bottom-right of your primary display — **without stealing focus**. Obsidian can stay minimized.
3. Read the question, click **Show answer** (or press `Space`), then rate the card with the four buttons (or keys `1`–`4`).
4. The rating is saved through Spaced Repetition itself, and the popup closes. Closing the popup without rating writes nothing — the card simply stays due.

## Requirements

- Obsidian **desktop** (Windows / macOS / Linux; the popup uses an Electron window, so mobile is not supported)
- The [Spaced Repetition](https://github.com/st3v3nmw/obsidian-spaced-repetition) plugin, installed and enabled

## Installation

### Via BRAT (recommended while in beta)

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) community plugin.
2. In BRAT settings, choose **Add beta plugin** and enter `uzusio/obsidian-sr-popup-review`.
3. Enable **Popup Review for Spaced Repetition** in *Settings → Community plugins*.

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/uzusio/obsidian-sr-popup-review/releases).
2. Put them into `<your vault>/.obsidian/plugins/sr-popup-review/`.
3. Reload Obsidian and enable **Popup Review for Spaced Repetition**.

## Using the popup

| Interaction | Effect |
| --- | --- |
| Click **Show answer** / press `Space` or `Enter` | Reveals the answer in place |
| Click **Again / Hard / Good / Easy** / press `1`–`4` | Saves the rating and closes |
| Click **✕** / press `Esc` | Closes without saving anything |
| Drag the header | Moves the popup |

The rating buttons use the labels you configured in the Spaced Repetition plugin. Card text is rendered as Markdown, and cloze deletions are masked exactly as in the normal review modal.

You can also open a popup at any time with the command **"Show review popup now"** (via the command palette).

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| Language | Obsidian's default | Interface language of this plugin (English / 日本語) |
| Popup interval (minutes) | 120 | How often a popup may appear (minimum 5) |
| Do not disturb | on, 01:00–09:00 | Toggle plus a time range with no popups; supports ranges across midnight |
| Auto-close (seconds) | 90 | Closes an untouched popup (nothing is written); 0 disables |
| Due cards only | on | Only show cards that are actually due; turn off to also get new cards |
| Deck filter | All decks | *All decks* or *Only listed decks* |
| Deck list | — | Dual-list picker: move decks between *available* and *target* with the add/remove buttons (double-click works too); a target deck also covers its subdecks. Empty target list = all decks |
| Show deck name | on | Shows the deck path and due count in the popup header |
| Check shortly after startup | off | Runs one check ~15 s after Obsidian starts |

The settings tab also shows whether the Spaced Repetition integration is working, and why not if it isn't.

## Data safety

- Ratings go through `Spaced Repetition`'s own review sequencer — identical writes to pressing the buttons in its modal (scheduling comment, sibling burying, load balancing, FSRS/SM-2, all of it).
- This plugin depends on internals of the Spaced Repetition plugin, so it **probes every internal it needs before each use**. If a future Spaced Repetition version changes them, popup reviews are disabled with a notice — the plugin never writes through an unknown code path.
- Dismissing or auto-closing a popup writes nothing.

## Known limitations

- Popups appear only while Obsidian is running (minimized is fine).
- The popup is a custom always-on-top window, not an OS notification: it does not appear in the notification center and ignores Do Not Disturb / Focus Assist.
- Position is fixed to the bottom-right of the primary display for now.

## Development

```bash
npm install
npm run dev    # one-shot build into ../sr-popup-test-vault (see esbuild.config.mjs)
npm run watch  # same, but watch mode
npm run build  # typecheck + production build to repo root
```

Development builds are emitted directly into a **dedicated test vault** (`C:/work/sr-popup-test-vault`). Never point dev builds at a real vault — this plugin writes to SR scheduling data.

## License

MIT
