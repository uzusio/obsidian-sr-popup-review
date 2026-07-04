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
     * Opens a one-card review session, or returns null when there is nothing to show
     * (no cards, SR busy, internals incompatible, or only new cards while dueCardsOnly).
     */
    async openSession(dueCardsOnly: boolean): Promise<ReviewSession | null> {
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
        const card = sequencer.currentCard;
        if (typeof card?.front !== "string" || typeof card?.back !== "string") return null;

        const isNewCard = card.hasSchedule !== true;
        // Card order is due-first in SR's defaults, so a new card at the head of the
        // queue means nothing is due right now.
        if (dueCardsOnly && isNewCard) return null;

        let dueCount = 0;
        let newCount = 0;
        try {
            const tree = sr.dataManager?.osrCore?.remainingDeckTree;
            dueCount = tree?.getDistinctRepItemCount?.(REP_ITEM_TYPE_DUE, true) ?? 0;
            newCount = tree?.getDistinctRepItemCount?.(REP_ITEM_TYPE_NEW, true) ?? 0;
        } catch {
            /* counts are cosmetic only */
        }

        let deckName: string | null = null;
        try {
            const raw = sequencer.currentDeck?.deckName;
            if (typeof raw === "string" && raw.length > 0 && raw !== "root") deckName = raw;
        } catch {
            /* cosmetic only */
        }

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
