import { getLanguage } from "obsidian";

type Strings = Record<string, string>;

const en: Strings = {
    showAnswer: "Show answer",
    headerStats: "{today} today · {due} due · {new} new",
    headerStatsNoToday: "{due} due · {new} new",
    newCard: "New card",
    saved: "Saved",
    savedAfterEdit: "Saved (to the edited card)",
    saving: "Saving…",
    ivlMinutes: "{n}m",
    ivlHours: "{n}h",
    ivlDays: "{n}d",
    ivlMonths: "{n}mo",
    ivlYears: "{n}y",
    menuTooltip: "Options",
    menuOpenNote: "Open note",
    menuPause: "Pause until resumed",
    menuSnooze30: "Snooze 30 minutes",
    menuSnooze60: "Snooze 1 hour",
    menuSnooze180: "Snooze 3 hours",
    snoozedNotice: "Popup Review for Spaced Repetition: popups snoozed until {time}.",
    snoozedNow: "snoozed until {time}",
    ratingFailed:
        "Popup Review for Spaced Repetition: failed to save the review. See the developer console for details.",
    ratingTimeout:
        "Popup Review for Spaced Repetition: the review write did not respond, so the popup was closed. Please check the card's schedule.",
    ratingNotSaved:
        "Popup Review for Spaced Repetition: the rating was not saved because the card's text was changed while the popup was open. Review the card again.",
    popupNotSaved: "Not saved — the card was edited",
    savingStuck: "Not responding — press ✕ or Esc to close",
    srMissing: "Popup Review for Spaced Repetition: the Spaced Repetition plugin is not enabled.",
    srNotReady: "Popup Review for Spaced Repetition: Spaced Repetition is still initializing. Try again in a moment.",
    incompatible:
        "Popup Review for Spaced Repetition: the installed Spaced Repetition version looks incompatible ({reason}). Popup reviews are disabled to keep your data safe.",
    nothingDue: "Popup Review for Spaced Repetition: no cards to review right now.",
    popupFailed:
        "Popup Review for Spaced Repetition: could not open the popup window. See the developer console for details.",
    commandShowNow: "Show review popup now",
    popupPreparing: "A review popup is being prepared…",
    commandTogglePause: "Toggle popup pause",
    statusBarPause: "Pause review popups",
    statusBarResume: "Resume review popups (paused)",
    pausedOn: "Popup Review for Spaced Repetition: popups paused.",
    pausedOff: "Popup Review for Spaced Repetition: popups resumed.",
    pausedNow: "paused",
    settingsPaused: "Pause popups",
    settingsPausedDesc:
        "Temporarily stop automatic popups. The bell icon in the status bar (bottom right) and the toggle-pause command flip this too. The manual show-popup-now command still works while paused.",
    settingsGlobalShortcut: "Global shortcut",
    settingsGlobalShortcutDesc:
        "Show a review popup with this key combination even while Obsidian is in the background (same as the show-popup-now command; Obsidian itself stays in the background, and the popup gets keyboard focus so you can answer with Space and the number keys right away). Click the button, then press the keys together, e.g. Ctrl + Alt + R. Esc cancels.",
    shortcutNotSet: "Not set",
    shortcutRecording: "Press keys…",
    shortcutClear: "Clear",
    shortcutNeedModifier: "Include Ctrl, Alt, or Win in the combination.",
    shortcutUnsupportedKey: "This key can't be used for a shortcut.",
    shortcutConflict:
        "{key} is already used by another app (or Obsidian in another vault), so it could not be registered.",
    shortcutInvalid: "{key} could not be registered as a shortcut.",
    shortcutUnavailable: "Global shortcuts are not available in this version of Obsidian.",
    shortcutSaved: "Registered {key}.",
    settingsMirror: "Show the popup on a local page",
    settingsMirrorDesc:
        "Mirror the popup, exactly as it appears, to a local web page so it can be shown in OBS (browser source), screen sharing, or another browser window. Only this computer can connect.",
    settingsMirrorPort: "Port",
    settingsMirrorPortDesc: "Port of the local page (1024–65535).",
    settingsMirrorPortInvalid: "Enter a whole number from 1024 to 65535.",
    settingsMirrorUrl: "Page URL",
    mirrorRunning: "{url} — running",
    mirrorInUse: "Port {port} is already in use by another app. Choose another port.",
    mirrorUnavailable: "The local page is not available in this version of Obsidian.",
    mirrorError: "The local page could not be started. See diagnostics.log in the plugin folder.",
    mirrorCopy: "Copy URL",
    settingsLanguage: "Language",
    settingsLanguageDesc: "Language of this plugin's interface.",
    languageDefault: "Obsidian's default",
    settingsStatus: "Spaced Repetition integration",
    settingsStatusOk: "Connected (Spaced Repetition v{version})",
    settingsStatusNg: "Unavailable: {reason}",
    settingsNextPopup: "Popup schedule",
    settingsNextPopupDesc: "Last shown: {last} — next: {next}",
    lastPopupNever: "never",
    nextPopupAsap: "within about a minute, as soon as a matching card exists",
    nextPopupAt: "{time} or later",
    nextPopupBackoff: "{time} or later — the last check found no matching card",
    popupOpenNow: "a popup is open right now",
    settingsInterval: "Popup interval (minutes)",
    settingsIntervalDesc: "How often a popup may appear. Minimum 5 minutes.",
    settingsIntervalInvalid: "Enter a whole number of 5 or more.",
    settingsAutoCloseInvalid: "Enter 0 or a positive whole number.",
    settingsNewPerDayInvalid: "Enter a whole number of 1 or more.",
    popupSizeName: "Popup size",
    popupSizeDesc:
        "Width, question height, and answer height in pixels. Leave a field empty for the default ({w} × {hf} / {hr}).",
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
    settingsNewMode: "New cards",
    settingsNewModeDesc:
        "Never-reviewed cards are mixed in with due cards, in proportion to how many of each are available (with a daily limit, only today's remaining allowance counts). New cards keep entering the review cycle even while due cards remain.",
    newModeNone: "Don't introduce",
    newModeLimited: "Up to a daily limit",
    newModeUnlimited: "Unlimited",
    settingsNewPerDay: "New cards per day",
    settingsNewPerDayDesc: "At most this many never-reviewed cards are introduced per day.",
    settingsNewRatioEnabled: "Fixed share of new cards",
    settingsNewRatioEnabledDesc:
        "When on, a new card is picked with the share below whenever both new and due cards are left. When off, the share follows how many of each are left.",
    settingsNewRatio: "Share of new cards",
    settingsNewRatioDesc:
        "Percentage of popups that show a new card. 67% ≈ 2 out of 3. Once the daily new-card limit is reached, only due cards are shown.",
    settingsRandomDeck: "Randomize deck order",
    settingsRandomDeckDesc:
        "Pick each popup card from a random deck (weighted by its card count), so every card has a roughly equal chance. Turn off to follow Spaced Repetition's deck order, which drains the first deck in the tree before later ones.",
    settingsFullscreen: "Skip popups during fullscreen apps",
    settingsFullscreenDesc:
        "When Windows reports a fullscreen app or presentation in the foreground (games, slideshows, F11 fullscreen), the popup is postponed and appears within a minute after fullscreen ends. Windows only; the manual show-popup-now command is not affected.",
    settingsShowDeckName: "Show deck name",
    settingsShowDeckNameDesc: "Show the deck name in the popup header.",
    settingsCheckOnStartup: "Check shortly after startup",
    settingsCheckOnStartupDesc:
        "Show one popup about 15 seconds after Obsidian starts if a matching card exists, regardless of the popup interval. Do-not-disturb still applies; while Spaced Repetition is still indexing, the check retries for a couple of minutes.",
};

const ja: Strings = {
    showAnswer: "答えを見る",
    headerStats: "今日 {today}枚 · 期限 {due}枚 · 新規 {new}枚",
    headerStatsNoToday: "期限 {due}枚 · 新規 {new}枚",
    newCard: "新規カード",
    saved: "記録しました",
    savedAfterEdit: "記録しました（編集後のカードに記録）",
    saving: "保存中…",
    ivlMinutes: "{n}分",
    ivlHours: "{n}時間",
    ivlDays: "{n}日",
    ivlMonths: "{n}ヶ月",
    ivlYears: "{n}年",
    menuTooltip: "オプション",
    menuOpenNote: "ノートを開く",
    menuPause: "再開するまで停止",
    menuSnooze30: "30分止める",
    menuSnooze60: "1時間止める",
    menuSnooze180: "3時間止める",
    snoozedNotice: "Popup Review for Spaced Repetition: {time} までポップアップを停止しました。",
    snoozedNow: "{time} まで停止中（スヌーズ）",
    ratingFailed:
        "Popup Review for Spaced Repetition: 評価の書き込みに失敗しました。詳細は開発者コンソールを確認してください。",
    ratingTimeout:
        "Popup Review for Spaced Repetition: 書き込みが応答しないためポップアップを閉じました。カードのスケジュールを確認してください。",
    ratingNotSaved:
        "Popup Review for Spaced Repetition: ポップアップ表示中にカードの文面が変更されたため、評価は記録されませんでした。もう一度レビューしてください。",
    popupNotSaved: "記録できませんでした（カードが編集されました）",
    savingStuck: "応答がありません — ✕ か Esc で閉じられます",
    srMissing: "Popup Review for Spaced Repetition: Spaced Repetition プラグインが有効になっていません。",
    srNotReady: "Popup Review for Spaced Repetition: Spaced Repetition の初期化がまだ終わっていません。少し待ってからもう一度試してください。",
    incompatible:
        "Popup Review for Spaced Repetition: インストールされている Spaced Repetition と互換性がありません（{reason}）。データ保護のためポップアップレビューを無効化しました。",
    nothingDue: "Popup Review for Spaced Repetition: 今レビューするカードはありません。",
    popupFailed:
        "Popup Review for Spaced Repetition: ポップアップウィンドウを開けませんでした。詳細は開発者コンソールを確認してください。",
    commandShowNow: "今すぐレビューポップアップを表示",
    popupPreparing: "レビューポップアップを準備中です…",
    commandTogglePause: "ポップアップの一時停止を切り替え",
    statusBarPause: "レビューポップアップを一時停止",
    statusBarResume: "レビューポップアップを再開（一時停止中）",
    pausedOn: "Popup Review for Spaced Repetition: ポップアップを一時停止しました。",
    pausedOff: "Popup Review for Spaced Repetition: ポップアップを再開しました。",
    pausedNow: "一時停止中",
    settingsPaused: "ポップアップを一時停止",
    settingsPausedDesc:
        "自動ポップアップを一時的に止めます。右下ステータスバーのベルアイコンとコマンドでも切り替えられます。停止中でも「今すぐ表示」コマンドは動きます。",
    settingsGlobalShortcut: "グローバルショートカット",
    settingsGlobalShortcutDesc:
        "Obsidian がバックグラウンドでも、このキーの組み合わせでレビューポップアップを表示します（「今すぐ表示」コマンドと同じ動作。Obsidian 本体は前面に出ず、ポップアップにキーボードフォーカスが移るので Space と数字キーですぐ回答できます）。ボタンを押してから、キーを同時に押してください（例: Ctrl + Alt + R）。Esc で取り消し。",
    shortcutNotSet: "未設定",
    shortcutRecording: "キーを押してください…",
    shortcutClear: "解除",
    shortcutNeedModifier: "Ctrl・Alt・Win のいずれかと組み合わせてください。",
    shortcutUnsupportedKey: "このキーはショートカットに使えません。",
    shortcutConflict: "{key} は他のアプリ（または別の保管庫の Obsidian）が使用中のため登録できませんでした。",
    shortcutInvalid: "{key} はショートカットとして登録できませんでした。",
    shortcutUnavailable: "このバージョンの Obsidian ではグローバルショートカットを使えません。",
    shortcutSaved: "{key} を登録しました。",
    settingsMirror: "ポップアップをローカルページに表示",
    settingsMirrorDesc:
        "ポップアップと同じ表示をローカルの Web ページに映します。OBS のブラウザソースや画面共有、別のブラウザウィンドウでポップアップだけを表示できます。このPC内からのみ接続できます。",
    settingsMirrorPort: "ポート",
    settingsMirrorPortDesc: "ローカルページのポート番号（1024〜65535）。",
    settingsMirrorPortInvalid: "1024〜65535 の整数を入力してください。",
    settingsMirrorUrl: "ページの URL",
    mirrorRunning: "{url} — 起動中",
    mirrorInUse: "ポート {port} は他のアプリが使用中です。別のポートを指定してください。",
    mirrorUnavailable: "このバージョンの Obsidian ではローカルページを使えません。",
    mirrorError: "ローカルページを起動できませんでした。プラグインフォルダの diagnostics.log を確認してください。",
    mirrorCopy: "URL をコピー",
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
    nextPopupBackoff: "{time} 以降（直前のチェックでは条件を満たすカードがありませんでした）",
    popupOpenNow: "現在ポップアップを表示中",
    settingsInterval: "ポップアップ間隔（分）",
    settingsIntervalDesc: "ポップアップを出す間隔。最小5分。",
    settingsIntervalInvalid: "5以上の整数を入力してください。",
    settingsAutoCloseInvalid: "0以上の整数を入力してください。",
    settingsNewPerDayInvalid: "1以上の整数を入力してください。",
    popupSizeName: "ポップアップのサイズ",
    popupSizeDesc: "幅・問題表示の高さ・解答表示の高さ（px）。空欄で既定値（{w} × {hf} / {hr}）。",
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
    settingsNewMode: "新規カードの導入",
    settingsNewModeDesc:
        "未レビューの新規カードを、期限カードとの枚数の比率で混ぜて出します（1日の上限枚数までの場合は、その日の残り枠だけを新規カードの枚数とみなします）。期限カードが残っていても新規カードが復習サイクルに入ります。",
    newModeNone: "出さない",
    newModeLimited: "1日の上限枚数まで",
    newModeUnlimited: "無制限",
    settingsNewPerDay: "1日の新規カード導入枚数",
    settingsNewPerDayDesc: "1日にこの枚数まで導入します。",
    settingsNewRatioEnabled: "新規カードの割合を固定する",
    settingsNewRatioEnabledDesc:
        "オンにすると、新規と復習の両方が残っているとき、下の割合で新規カードを選びます。オフのときは残りの枚数に比例します。",
    settingsNewRatio: "新規カードの割合",
    settingsNewRatioDesc:
        "ポップアップのうち新規カードを出す割合（%）。67% なら 3 枚中およそ 2 枚。1 日の上限に達したあとは復習だけになります。",
    settingsRandomDeck: "デッキ順を無視してランダムに出題",
    settingsRandomDeckDesc:
        "毎回のポップアップを、カード枚数で重み付けしたランダムなデッキから選びます（全カードがほぼ等確率になります）。オフにすると Spaced Repetition 本来のデッキ順（ツリーの前のデッキから消化）に従います。",
    settingsFullscreen: "フルスクリーンアプリ中はポップアップを出さない",
    settingsFullscreenDesc:
        "ゲーム・スライドショー・F11全画面などのフルスクリーン状態をWindowsに問い合わせて検出し、その間はポップアップを見送ります（フルスクリーン終了後1分以内に出ます）。Windows専用。手動の「今すぐ表示」コマンドには影響しません。",
    settingsShowDeckName: "デッキ名を表示",
    settingsShowDeckNameDesc: "ポップアップのヘッダにデッキ名を表示します。",
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
    let locale = "en";
    if (localeOverride !== "-") {
        locale = localeOverride;
    } else {
        try {
            locale = typeof getLanguage === "function" ? getLanguage() : "en";
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
