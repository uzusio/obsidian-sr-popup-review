type Strings = Record<string, string>;

const en: Strings = {
    showAnswer: "Show answer",
    due: "{n} due",
    newCard: "New card",
    saved: "Saved",
    ratingFailed:
        "SR Popup Review: failed to save the review. See the developer console for details.",
    srMissing: "SR Popup Review: the Spaced Repetition plugin is not enabled.",
    srNotReady: "SR Popup Review: Spaced Repetition is still initializing. Try again in a moment.",
    incompatible:
        "SR Popup Review: the installed Spaced Repetition version looks incompatible ({reason}). Popup reviews are disabled to keep your data safe.",
    nothingDue: "SR Popup Review: no cards to review right now.",
    popupFailed:
        "SR Popup Review: could not open the popup window. See the developer console for details.",
    commandShowNow: "Show review popup now",
    settingsStatus: "Spaced Repetition integration",
    settingsStatusOk: "Connected (Spaced Repetition v{version})",
    settingsStatusNg: "Unavailable: {reason}",
    settingsInterval: "Popup interval (minutes)",
    settingsIntervalDesc: "How often a popup may appear. Minimum 5 minutes.",
    settingsQuietStart: "Quiet hours start (HH:mm)",
    settingsQuietEnd: "Quiet hours end (HH:mm)",
    settingsQuietDesc: "No popups appear during quiet hours. Set both to the same time to disable.",
    settingsAutoClose: "Auto-close (seconds)",
    settingsAutoCloseDesc:
        "Close the popup automatically after this many seconds without interaction (nothing is written). 0 disables auto-close.",
    settingsDeckFilterMode: "Deck filter",
    settingsDeckFilterModeDesc: "Which decks may appear in popups.",
    deckFilterAll: "All decks",
    deckFilterInclude: "Only listed decks",
    deckFilterExclude: "All except listed decks",
    settingsDeckFilterList: "Deck list",
    settingsDeckFilterListDesc:
        "One deck path per line, e.g. flashcards/korean. A rule also matches all of the deck's subdecks.",
    settingsDueOnly: "Due cards only",
    settingsDueOnlyDesc: "Only show popups for cards that are actually due. Turn off to also get popups for new cards.",
    settingsShowDeckName: "Show deck name",
    settingsShowDeckNameDesc: "Show the deck name and due count in the popup header.",
    settingsCheckOnStartup: "Check shortly after startup",
    settingsCheckOnStartupDesc: "Run one check about 15 seconds after Obsidian starts, without waiting for the first interval.",
};

const ja: Strings = {
    showAnswer: "答えを見る",
    due: "期限 {n}枚",
    newCard: "新規カード",
    saved: "記録しました",
    ratingFailed:
        "SR Popup Review: 評価の書き込みに失敗しました。詳細は開発者コンソールを確認してください。",
    srMissing: "SR Popup Review: Spaced Repetition プラグインが有効になっていません。",
    srNotReady: "SR Popup Review: Spaced Repetition の初期化がまだ終わっていません。少し待ってからもう一度試してください。",
    incompatible:
        "SR Popup Review: インストールされている Spaced Repetition と互換性がありません（{reason}）。データ保護のためポップアップレビューを無効化しました。",
    nothingDue: "SR Popup Review: 今レビューするカードはありません。",
    popupFailed:
        "SR Popup Review: ポップアップウィンドウを開けませんでした。詳細は開発者コンソールを確認してください。",
    commandShowNow: "今すぐレビューポップアップを表示",
    settingsStatus: "Spaced Repetition 連携",
    settingsStatusOk: "接続済み（Spaced Repetition v{version}）",
    settingsStatusNg: "利用できません: {reason}",
    settingsInterval: "ポップアップ間隔（分）",
    settingsIntervalDesc: "ポップアップを出す間隔。最小5分。",
    settingsQuietStart: "静穏時間の開始（HH:mm）",
    settingsQuietEnd: "静穏時間の終了（HH:mm）",
    settingsQuietDesc: "静穏時間帯はポップアップを出しません。開始と終了を同じ時刻にすると無効になります。",
    settingsAutoClose: "自動クローズ（秒）",
    settingsAutoCloseDesc:
        "無操作のままこの秒数が経つとポップアップを閉じます（何も書き込みません）。0で無効。",
    settingsDeckFilterMode: "デッキフィルタ",
    settingsDeckFilterModeDesc: "ポップアップに出すデッキを制限します。",
    deckFilterAll: "全デッキ",
    deckFilterInclude: "リストのデッキのみ",
    deckFilterExclude: "リストのデッキ以外",
    settingsDeckFilterList: "デッキリスト",
    settingsDeckFilterListDesc:
        "1行に1デッキパス（例: flashcards/韓国語）。指定したデッキのサブデッキにも適用されます。",
    settingsDueOnly: "期限カードのみ",
    settingsDueOnlyDesc: "期限が来ているカードだけポップアップに出します。オフにすると新規カードでも出ます。",
    settingsShowDeckName: "デッキ名を表示",
    settingsShowDeckNameDesc: "ポップアップのヘッダにデッキ名と期限枚数を表示します。",
    settingsCheckOnStartup: "起動直後にチェック",
    settingsCheckOnStartupDesc: "Obsidian起動の約15秒後に1回チェックします（最初の間隔を待ちません）。",
};

function pickTable(): Strings {
    let locale = "en";
    try {
        locale = window.localStorage.getItem("language") ?? navigator.language ?? "en";
    } catch {
        /* fall back to English */
    }
    return locale.startsWith("ja") ? ja : en;
}

const table = pickTable();

export function t(key: string, vars?: Record<string, string | number>): string {
    let s = table[key] ?? en[key] ?? key;
    if (vars) {
        for (const [k, v] of Object.entries(vars)) {
            s = s.replace(`{${k}}`, String(v));
        }
    }
    return s;
}
