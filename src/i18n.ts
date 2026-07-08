type Strings = Record<string, string>;

const en: Strings = {
    showAnswer: "Show answer",
    due: "{n} due",
    newCard: "New card",
    saved: "Saved",
    saving: "Saving…",
    ratingFailed:
        "Popup Review for Spaced Repetition: failed to save the review. See the developer console for details.",
    ratingTimeout:
        "Popup Review for Spaced Repetition: the review write did not respond, so the popup was closed. Please check the card's schedule.",
    savingStuck: "Not responding — press ✕ or Esc to close",
    srMissing: "Popup Review for Spaced Repetition: the Spaced Repetition plugin is not enabled.",
    srNotReady: "Popup Review for Spaced Repetition: Spaced Repetition is still initializing. Try again in a moment.",
    incompatible:
        "Popup Review for Spaced Repetition: the installed Spaced Repetition version looks incompatible ({reason}). Popup reviews are disabled to keep your data safe.",
    nothingDue: "Popup Review for Spaced Repetition: no cards to review right now.",
    popupFailed:
        "Popup Review for Spaced Repetition: could not open the popup window. See the developer console for details.",
    commandShowNow: "Show review popup now",
    settingsLanguage: "Language",
    settingsLanguageDesc: "Language of this plugin's interface.",
    languageDefault: "Obsidian's default",
    settingsStatus: "Spaced Repetition integration",
    settingsStatusOk: "Connected (Spaced Repetition v{version})",
    settingsStatusNg: "Unavailable: {reason}",
    settingsNextPopup: "Popup schedule",
    settingsNextPopupDesc: "Last shown: {last} — next: {next}",
    lastPopupNever: "never",
    nextPopupAsap: "within about a minute, as soon as a matching due card exists",
    nextPopupAt: "{time} or later",
    popupOpenNow: "a popup is open right now",
    settingsInterval: "Popup interval (minutes)",
    settingsIntervalDesc: "How often a popup may appear. Minimum 5 minutes.",
    settingsQuietHours: "Do not disturb",
    settingsQuietHoursDesc:
        "No popups during this time range (ranges across midnight are supported).",
    settingsAutoClose: "Auto-close (seconds)",
    settingsAutoCloseDesc:
        "Close the popup automatically after this many seconds without interaction (nothing is written). 0 disables auto-close.",
    settingsDeckFilterMode: "Deck filter",
    settingsDeckFilterModeDesc: "Which decks may appear in popups.",
    deckFilterAll: "All decks",
    deckFilterInclude: "Only listed decks",
    settingsDeckFilterList: "Deck list",
    settingsDeckFilterListDesc:
        "One deck path per line, e.g. flashcards/korean. A rule also matches all of the deck's subdecks. While the list is empty, all decks appear.",
    deckPickerIncludeDesc:
        "Move decks to the target list with the buttons (or double-click). Only target decks appear in popups; a target deck also covers its subdecks. While the target list is empty, all decks appear.",
    deckAvailable: "Available decks",
    deckTarget: "Target decks",
    deckAdd: "Add →",
    deckRemove: "← Remove",
    deckNotFound: "not found in the current decks",
    settingsDueOnly: "Due cards only",
    settingsDueOnlyDesc: "Only show popups for cards that are actually due. Turn off to also get popups for new cards.",
    settingsShowDeckName: "Show deck name",
    settingsShowDeckNameDesc: "Show the deck name and due count in the popup header.",
    settingsCheckOnStartup: "Check shortly after startup",
    settingsCheckOnStartupDesc:
        "Show one popup about 15 seconds after Obsidian starts if a matching card exists, regardless of the popup interval. Do-not-disturb still applies; while Spaced Repetition is still indexing, the check retries for a couple of minutes.",
};

const ja: Strings = {
    showAnswer: "答えを見る",
    due: "期限 {n}枚",
    newCard: "新規カード",
    saved: "記録しました",
    saving: "保存中…",
    ratingFailed:
        "Popup Review for Spaced Repetition: 評価の書き込みに失敗しました。詳細は開発者コンソールを確認してください。",
    ratingTimeout:
        "Popup Review for Spaced Repetition: 書き込みが応答しないためポップアップを閉じました。カードのスケジュールを確認してください。",
    savingStuck: "応答がありません — ✕ か Esc で閉じられます",
    srMissing: "Popup Review for Spaced Repetition: Spaced Repetition プラグインが有効になっていません。",
    srNotReady: "Popup Review for Spaced Repetition: Spaced Repetition の初期化がまだ終わっていません。少し待ってからもう一度試してください。",
    incompatible:
        "Popup Review for Spaced Repetition: インストールされている Spaced Repetition と互換性がありません（{reason}）。データ保護のためポップアップレビューを無効化しました。",
    nothingDue: "Popup Review for Spaced Repetition: 今レビューするカードはありません。",
    popupFailed:
        "Popup Review for Spaced Repetition: ポップアップウィンドウを開けませんでした。詳細は開発者コンソールを確認してください。",
    commandShowNow: "今すぐレビューポップアップを表示",
    settingsLanguage: "言語",
    settingsLanguageDesc: "このプラグインの表示言語。",
    languageDefault: "Obsidianの設定に従う",
    settingsStatus: "Spaced Repetition 連携",
    settingsStatusOk: "接続済み（Spaced Repetition v{version}）",
    settingsStatusNg: "利用できません: {reason}",
    settingsNextPopup: "ポップアップ予定",
    settingsNextPopupDesc: "前回の表示: {last} ／ 次の表示: {next}",
    lastPopupNever: "まだ表示なし",
    nextPopupAsap: "条件を満たすカードがあれば約1分以内",
    nextPopupAt: "{time} 以降",
    popupOpenNow: "現在ポップアップを表示中",
    settingsInterval: "ポップアップ間隔（分）",
    settingsIntervalDesc: "ポップアップを出す間隔。最小5分。",
    settingsQuietHours: "ポップアップ停止時間帯",
    settingsQuietHoursDesc: "この時間帯はポップアップを出しません（日付をまたぐ範囲も指定できます）。",
    settingsAutoClose: "自動クローズ（秒）",
    settingsAutoCloseDesc:
        "無操作のままこの秒数が経つとポップアップを閉じます（何も書き込みません）。0で無効。",
    settingsDeckFilterMode: "デッキフィルタ",
    settingsDeckFilterModeDesc: "ポップアップに出すデッキを制限します。",
    deckFilterAll: "全デッキ",
    deckFilterInclude: "リストのデッキのみ",
    settingsDeckFilterList: "デッキリスト",
    settingsDeckFilterListDesc:
        "1行に1デッキパス（例: flashcards/韓国語）。指定したデッキのサブデッキにも適用されます。空欄の間は全デッキが出ます。",
    deckPickerIncludeDesc:
        "ボタン（またはダブルクリック）でデッキを対象リストへ移します。対象のデッキだけがポップアップに出ます（サブデッキにも適用）。対象リストが空の間は全デッキが出ます。",
    deckAvailable: "既存のデッキ",
    deckTarget: "対象のデッキ",
    deckAdd: "追加 →",
    deckRemove: "← 除外",
    deckNotFound: "現在のデッキに存在しません",
    settingsDueOnly: "期限カードのみ",
    settingsDueOnlyDesc: "期限が来ているカードだけポップアップに出します。オフにすると新規カードでも出ます。",
    settingsShowDeckName: "デッキ名を表示",
    settingsShowDeckNameDesc: "ポップアップのヘッダにデッキ名と期限枚数を表示します。",
    settingsCheckOnStartup: "起動直後にチェック",
    settingsCheckOnStartupDesc:
        "Obsidian起動の約15秒後、条件を満たすカードがあれば間隔に関係なく1回表示します。停止時間帯は優先されます。Spaced Repetition の準備中は数分間リトライします。",
};

/** "-" = follow Obsidian's app language (same convention as the SR plugin). */
let localeOverride = "-";

export function setLocaleOverride(lang: string): void {
    localeOverride = lang;
}

function currentTable(): Strings {
    let locale: string;
    if (localeOverride !== "-") {
        locale = localeOverride;
    } else {
        // Obsidian stores its UI language in localStorage; the key is absent for English.
        try {
            locale = window.localStorage.getItem("language") ?? "en";
        } catch {
            locale = "en";
        }
    }
    return locale.startsWith("ja") ? ja : en;
}

export function t(key: string, vars?: Record<string, string | number>): string {
    const table = currentTable();
    let s = table[key] ?? en[key] ?? key;
    if (vars) {
        for (const [k, v] of Object.entries(vars)) {
            s = s.replace(`{${k}}`, String(v));
        }
    }
    return s;
}
