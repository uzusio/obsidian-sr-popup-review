# SR Popup Review

Review your [Spaced Repetition](https://github.com/st3v3nmw/obsidian-spaced-repetition) flashcards without opening Obsidian: a small always-on-top popup appears at regular intervals, shows one due card, and lets you reveal the answer and rate it (Again / Hard / Good / Easy) right in the popup.

Ratings are written through the Spaced Repetition plugin's **own review pipeline** (the same code path as its review modal), so your scheduling data stays fully consistent — no re-implementation of SM-2 or FSRS.

> ⚠ **Work in progress (prototype).** Not yet published to the community plugin list.

## How it works

- A scheduler checks at your configured interval (default: every 2 hours) whether any cards are due.
- If so, a frameless always-on-top popup appears at the bottom-right of your primary display — **without stealing focus**.
- Click "Show answer" (or press Space), then rate with the four buttons (or keys 1–4).
- Closing the popup without rating writes nothing; the card simply stays due.

Internally, the plugin briefly intercepts the Spaced Repetition plugin's own review-opening pipeline to obtain a real `FlashcardReviewSequencer` without showing any UI ("capture method"). If the internals of a future Spaced Repetition version are incompatible, the plugin disables itself safely and never writes data through an unknown path.

## Requirements

- Obsidian desktop (this plugin is `isDesktopOnly`; it uses an Electron `BrowserWindow` for the popup)
- [Spaced Repetition](https://github.com/st3v3nmw/obsidian-spaced-repetition) plugin — tested with **v1.15.4**

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
