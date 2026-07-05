import { App } from "obsidian";

/* eslint-disable @typescript-eslint/no-explicit-any */

const SR_PLUGIN_ID = "obsidian-spaced-repetition";

// Enum values verified against obsidian-spaced-repetition v1.15.4 (bundled main.js).
export const ReviewResponse = {
    Easy: 0,
    Good: 1,
    Hard: 2,
    Again: 3,
} as const;
export type ReviewResponseValue = (typeof ReviewResponse)[keyof typeof ReviewResponse];

const REVIEW_MODE_REVIEW = 1;
const REP_ITEM_TYPE_NEW = 0;
const REP_ITEM_TYPE_DUE = 1;
/** Runaway guard for the deck-filter skip loop. */
const MAX_FILTER_SKIPS = 1000;

export interface DeckFilter {
    mode: "all" | "include" | "exclude";
    /** Deck paths like "flashcards/韓国語"; a rule matches the deck itself and all subdecks. */
    paths: string[];
}

/** Trims, strips a leading "#" and trailing "/", and drops empty lines. */
export function normalizeDeckPaths(lines: string[]): string[] {
    return lines
        .map((l) => l.trim().replace(/^#/, "").replace(/\/+$/, ""))
        .filter((l) => l.length > 0);
}

function deckAllowed(deckPath: string, filter: DeckFilter): boolean {
    if (filter.mode === "all" || filter.paths.length === 0) return true;
    const matched = filter.paths.some((p) => deckPath === p || deckPath.startsWith(p + "/"));
    return filter.mode === "include" ? matched : !matched;
}

export interface ReviewSession {
    /** Markdown of the question side (cloze deletions already masked by SR's parser). */
    front: string;
    /** Markdown of the answer side. */
    back: string;
    deckName: string | null;
    dueCount: number;
    newCount: number;
    isNewCard: boolean;
    /** Button labels as configured in the SR plugin's settings. */
    buttonLabels: { again: string; hard: string; good: string; easy: string };
    /** Writes the review through SR's own pipeline (identical to pressing a button in its modal). */
    rate(response: ReviewResponseValue): Promise<void>;
}

export type ProbeStatus = "ok" | "missing" | "notReady" | "incompatible";

export interface ProbeResult {
    status: ProbeStatus;
    /** Diagnostic detail (English only, shown in notices/settings). */
    reason?: string;
}

/**
 * The single point of contact with the Spaced Repetition plugin's internals.
 *
 * Everything here relies on unexported internals of SR (verified against v1.15.4),
 * so every access is defensive: if any expected member is missing, probe() fails
 * and the plugin never attempts to write scheduling data through an unknown path.
 */
export class SRBridge {
    constructor(private app: App) {}

    getSRPlugin(): any | null {
        const plugins = (this.app as any).plugins;
        if (!plugins?.enabledPlugins?.has?.(SR_PLUGIN_ID)) return null;
        return plugins.plugins?.[SR_PLUGIN_ID] ?? null;
    }

    /**
     * SR's dataManager/uiManager getters THROW until the plugin finishes its
     * layout-ready initialization, so "not ready yet" (transient) must be kept
     * apart from "incompatible" (permanent, warn the user).
     */
    probe(): ProbeResult {
        const sr = this.getSRPlugin();
        if (!sr) return { status: "missing", reason: "Spaced Repetition plugin is not enabled" };
        if (typeof sr.isInitialized !== "boolean")
            return { status: "incompatible", reason: "isInitialized flag not found" };
        if (sr.isInitialized !== true)
            return { status: "notReady", reason: "Spaced Repetition is still initializing" };
        let dm: any = null;
        let ui: any = null;
        try {
            dm = sr.dataManager;
            ui = sr.uiManager;
        } catch {
            return { status: "notReady", reason: "managers not initialized yet" };
        }
        if (typeof dm?.sync !== "function")
            return { status: "incompatible", reason: "dataManager.sync not found" };
        if (typeof ui?.openDeckContainer !== "function")
            return { status: "incompatible", reason: "uiManager.openDeckContainer not found" };
        if (typeof ui?.openFlashcardModal !== "function")
            return { status: "incompatible", reason: "uiManager.openFlashcardModal not found" };
        if (typeof ui?.focusObsidianWindow !== "function")
            return { status: "incompatible", reason: "uiManager.focusObsidianWindow not found" };
        return { status: "ok" };
    }

    /** True while SR's own review UI is in focus (avoid double review sessions). */
    isSRReviewUIOpen(): boolean {
        try {
            return this.getSRPlugin()?.uiManager?.getSRInFocusState?.() === true;
        } catch {
            return false;
        }
    }

    /**
     * Capture method: temporarily stub the UI-opening and focus-stealing methods of
     * SR's UIManager, run its own openDeckContainer() pipeline (which syncs the
     * vault and builds a ReviewQueueLoader), and grab the loader it would have handed
     * to the review modal. No UI is shown, no focus is taken, and every stub is
     * restored in `finally`. The loader then builds a real FlashcardReviewSequencer.
     */
    private async acquireSequencer(sr: any): Promise<any | null> {
        if (sr.dataManager.syncLock) return null;
        const ui = sr.uiManager;
        const tvm = ui.tabViewManager;
        let loader: any = null;
        const origModal = ui.openFlashcardModal;
        const origFocus = ui.focusObsidianWindow;
        const origTab = tvm?.openSRTabView;
        ui.focusObsidianWindow = () => {};
        ui.openFlashcardModal = (l: any) => {
            loader = l;
        };
        if (tvm) {
            tvm.openSRTabView = async (l: any) => {
                loader = l;
            };
        }
        try {
            await ui.openDeckContainer(REVIEW_MODE_REVIEW);
        } finally {
            ui.openFlashcardModal = origModal;
            ui.focusObsidianWindow = origFocus;
            if (tvm) tvm.openSRTabView = origTab;
        }
        if (!loader || typeof loader.loadReviewQueue !== "function") return null;
        return await loader.loadReviewQueue();
    }

    /**
     * All deck paths currently known to SR (from its reviewable deck tree),
     * in tree order, e.g. ["flashcards", "flashcards/韓国語", ...].
     * Empty when SR is not ready — callers should fall back to manual input.
     */
    listDeckPaths(): string[] {
        const result: string[] = [];
        try {
            const root = this.getSRPlugin()?.dataManager?.osrCore?.reviewableDeckTree;
            const walk = (deck: any, prefix: string): void => {
                for (const sub of deck?.subdecks ?? []) {
                    if (typeof sub?.deckName !== "string") continue;
                    const path = prefix.length > 0 ? `${prefix}/${sub.deckName}` : sub.deckName;
                    result.push(path);
                    walk(sub, path);
                }
            };
            if (root) walk(root, "");
        } catch {
            /* SR not initialized — return what we have */
        }
        return result;
    }

    /** Full deck path of the current card, e.g. "flashcards/韓国語" ("" if unknown). */
    private currentDeckPath(sequencer: any): string {
        try {
            const topicPath = sequencer.currentDeck?.getTopicPath?.();
            if (Array.isArray(topicPath?.path)) return topicPath.path.join("/");
        } catch {
            /* fall through */
        }
        return "";
    }

    /**
     * Opens a one-card review session, or returns null when there is nothing to show
     * (no cards, SR busy, internals incompatible, or no card passes the deck filter /
     * dueCardsOnly conditions).
     */
    async openSession(dueCardsOnly: boolean, filter: DeckFilter): Promise<ReviewSession | null> {
        const sr = this.getSRPlugin();
        if (!sr) return null;
        let sequencer: any = null;
        try {
            sequencer = await this.acquireSequencer(sr);
        } catch (e) {
            console.error("[sr-popup-review] failed to acquire review sequencer", e);
            return null;
        }
        if (!sequencer || sequencer.hasCurrentCard !== true) return null;
        if (typeof sequencer.processReview !== "function") return null;

        // Walk the queue to the first card that passes the deck filter (and, with
        // dueCardsOnly, has a schedule). skipCurrentCard() only mutates the in-memory
        // queue — nothing is written, and the next sync rebuilds the tree.
        let skips = 0;
        while (sequencer.hasCurrentCard === true) {
            const allowed = deckAllowed(this.currentDeckPath(sequencer), filter);
            const isNew = sequencer.currentCard?.hasSchedule !== true;
            if (allowed && (!dueCardsOnly || !isNew)) break;
            if (typeof sequencer.skipCurrentCard !== "function" || ++skips > MAX_FILTER_SKIPS)
                return null;
            sequencer.skipCurrentCard();
        }
        if (sequencer.hasCurrentCard !== true) return null;
        const card = sequencer.currentCard;
        if (typeof card?.front !== "string" || typeof card?.back !== "string") return null;
        const isNewCard = card.hasSchedule !== true;

        let dueCount = 0;
        let newCount = 0;
        try {
            const tree = sr.dataManager?.osrCore?.remainingDeckTree;
            dueCount = tree?.getDistinctRepItemCount?.(REP_ITEM_TYPE_DUE, true) ?? 0;
            newCount = tree?.getDistinctRepItemCount?.(REP_ITEM_TYPE_NEW, true) ?? 0;
        } catch {
            /* counts are cosmetic only */
        }

        const deckPath = this.currentDeckPath(sequencer);
        const deckName: string | null = deckPath.length > 0 ? deckPath : null;

        const srSettings = sr.dataManager?.data?.settings;
        const buttonLabels = {
            again: srSettings?.flashcardAgainText ?? "Again",
            hard: srSettings?.flashcardHardText ?? "Hard",
            good: srSettings?.flashcardGoodText ?? "Good",
            easy: srSettings?.flashcardEasyText ?? "Easy",
        };

        return {
            front: card.front.trimStart(),
            back: card.back,
            deckName,
            dueCount,
            newCount,
            isNewCard,
            buttonLabels,
            rate: async (response: ReviewResponseValue) => {
                await sequencer.processReview(response);
            },
        };
    }
}
