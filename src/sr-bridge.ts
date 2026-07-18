import { App } from "obsidian";

const SR_PLUGIN_ID = "obsidian-spaced-repetition";

// ---------------------------------------------------------------------------
// Structural types for the Spaced Repetition internals this plugin touches.
// They mirror obsidian-spaced-repetition v1.15.4. Every member is optional and
// probed before use, so an incompatible future SR version fails the probe
// instead of crashing or writing through an unknown code path.
// ---------------------------------------------------------------------------

interface AppWithPlugins extends App {
    plugins?: {
        enabledPlugins?: Set<string>;
        plugins?: Record<string, unknown>;
    };
}

interface SRSettingsLike {
    flashcardAgainText?: unknown;
    flashcardHardText?: unknown;
    flashcardGoodText?: unknown;
    flashcardEasyText?: unknown;
}

interface SRTopicPath {
    path?: unknown;
}

interface SRDeck {
    deckName?: unknown;
    subdecks?: unknown;
    getTopicPath?: () => SRTopicPath | undefined;
    getDistinctRepItemCount?: (repItemType: number, includeSubdecks: boolean) => number;
}

interface SRCard {
    front?: unknown;
    back?: unknown;
    hasSchedule?: unknown;
}

interface SRSequencer {
    hasCurrentCard?: unknown;
    currentCard?: SRCard | null;
    currentDeck?: SRDeck | null;
    processReview?: (response: number) => Promise<void>;
    skipCurrentCard?: () => void;
    /** Same API the SR modal uses when the user picks a deck from the deck list. */
    setCurrentDeck?: (topicPath: SRTopicPath) => void;
}

interface SRReviewQueueLoader {
    loadReviewQueue?: () => Promise<SRSequencer>;
}

interface SRTabViewManager {
    openSRTabView?: (loader: SRReviewQueueLoader) => Promise<void>;
}

interface SRUIManager {
    openDeckContainer?: (reviewMode: number) => Promise<void>;
    openFlashcardModal?: (loader: SRReviewQueueLoader) => void;
    focusObsidianWindow?: () => void;
    getSRInFocusState?: () => boolean;
    tabViewManager?: SRTabViewManager;
}

interface SROsrCore {
    remainingDeckTree?: SRDeck;
    reviewableDeckTree?: SRDeck;
}

interface SRDataManager {
    sync?: () => Promise<void>;
    syncLock?: unknown;
    osrCore?: SROsrCore;
    data?: { settings?: SRSettingsLike };
}

/** The SR plugin instance. dataManager/uiManager are getters that THROW until
 * SR finishes its layout-ready initialization — access them inside try/catch. */
interface SRPluginLike {
    isInitialized?: unknown;
    manifest?: { version?: string };
    dataManager?: SRDataManager;
    uiManager?: SRUIManager;
}

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
    mode: "all" | "include";
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
    // An empty target list means "no restriction" — otherwise switching the mode
    // would silently stop all popups until a deck is picked.
    if (filter.mode !== "include" || filter.paths.length === 0) return true;
    return filter.paths.some((p) => deckPath === p || deckPath.startsWith(p + "/"));
}

function asString(value: unknown, fallback: string): string {
    return typeof value === "string" ? value : fallback;
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

    getSRPlugin(): SRPluginLike | null {
        const appPlugins = (this.app as AppWithPlugins).plugins;
        if (!appPlugins?.enabledPlugins?.has(SR_PLUGIN_ID)) return null;
        const instance = appPlugins.plugins?.[SR_PLUGIN_ID];
        return instance ? (instance) : null;
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
        if (!sr.isInitialized)
            return { status: "notReady", reason: "Spaced Repetition is still initializing" };
        let dm: SRDataManager | undefined;
        let ui: SRUIManager | undefined;
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
     * All deck paths currently known to SR (from its reviewable deck tree),
     * in tree order, e.g. ["flashcards", "flashcards/韓国語", ...].
     * Empty when SR is not ready — callers should fall back to manual input.
     */
    listDeckPaths(): string[] {
        const result: string[] = [];
        const walk = (deck: SRDeck, prefix: string): void => {
            const subdecks = deck.subdecks;
            if (!Array.isArray(subdecks)) return;
            for (const entry of subdecks as unknown[]) {
                const sub = entry as SRDeck;
                if (typeof sub?.deckName !== "string") continue;
                const path = prefix.length > 0 ? `${prefix}/${sub.deckName}` : sub.deckName;
                result.push(path);
                walk(sub, path);
            }
        };
        try {
            const root = this.getSRPlugin()?.dataManager?.osrCore?.reviewableDeckTree;
            if (root) walk(root, "");
        } catch {
            /* SR not initialized — return what we have */
        }
        return result;
    }

    /**
     * Capture method: temporarily stub the UI-opening and focus-stealing methods of
     * SR's UIManager, run its own openDeckContainer() pipeline (which syncs the
     * vault and builds a ReviewQueueLoader), and grab the loader it would have handed
     * to the review modal. No UI is shown, no focus is taken, and every stub is
     * restored in `finally`. The loader then builds a real FlashcardReviewSequencer.
     */
    private async acquireSequencer(sr: SRPluginLike): Promise<SRSequencer | null> {
        const dm = sr.dataManager;
        const ui = sr.uiManager;
        if (!dm || dm.syncLock === true) return null;
        if (!ui || typeof ui.openDeckContainer !== "function") return null;
        const tvm = ui.tabViewManager;
        // Holder object: TypeScript's control-flow analysis cannot see the
        // assignments made inside the stub closures below.
        const capture: { loader: SRReviewQueueLoader | null } = { loader: null };
        const origModal = ui.openFlashcardModal;
        const origFocus = ui.focusObsidianWindow;
        const origTab = tvm?.openSRTabView;
        ui.focusObsidianWindow = () => {
            /* suppressed while capturing */
        };
        ui.openFlashcardModal = (l: SRReviewQueueLoader) => {
            capture.loader = l;
        };
        if (tvm) {
            tvm.openSRTabView = (l: SRReviewQueueLoader) => {
                capture.loader = l;
                return Promise.resolve();
            };
        }
        try {
            await ui.openDeckContainer(REVIEW_MODE_REVIEW);
        } finally {
            ui.openFlashcardModal = origModal;
            ui.focusObsidianWindow = origFocus;
            if (tvm) tvm.openSRTabView = origTab;
        }
        const loader = capture.loader;
        if (!loader || typeof loader.loadReviewQueue !== "function") return null;
        return await loader.loadReviewQueue();
    }

    /**
     * Opens a one-card review session, or returns null when there is nothing to show
     * (no cards, SR busy, internals incompatible, or no card passes the deck filter /
     * dueCardsOnly conditions).
     */
    async openSession(
        dueCardsOnly: boolean,
        filter: DeckFilter,
        randomizeDeckOrder: boolean,
    ): Promise<ReviewSession | null> {
        const sr = this.getSRPlugin();
        if (!sr) return null;
        let sequencer: SRSequencer | null = null;
        try {
            sequencer = await this.acquireSequencer(sr);
        } catch (e) {
            console.error("[sr-popup-review] failed to acquire review sequencer", e);
            return null;
        }
        if (!sequencer || sequencer.hasCurrentCard !== true) return null;
        const processReview = sequencer.processReview;
        if (typeof processReview !== "function") return null;

        // SR's own deck order is sequential: the first deck in the tree supplies
        // every card until its due pile is empty, which starves later decks when
        // only one card is sampled per popup. Optionally re-position the sequencer
        // onto a deck chosen at random, weighted by due-card count, so every due
        // card in the vault has (approximately) equal probability.
        if (randomizeDeckOrder && typeof sequencer.setCurrentDeck === "function") {
            const chosen = this.pickRandomDeck(sr, dueCardsOnly, filter);
            const topicPath =
                typeof chosen?.getTopicPath === "function" ? chosen.getTopicPath() : undefined;
            if (topicPath) {
                try {
                    sequencer.setCurrentDeck(topicPath);
                } catch (e) {
                    console.error(
                        "[sr-popup-review] failed to select a random deck; falling back to SR's deck order",
                        e,
                    );
                }
            }
        }

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
        if (!card || typeof card.front !== "string" || typeof card.back !== "string") return null;
        const isNewCard = card.hasSchedule !== true;

        let dueCount = 0;
        let newCount = 0;
        try {
            const tree = sr.dataManager?.osrCore?.remainingDeckTree;
            if (typeof tree?.getDistinctRepItemCount === "function") {
                dueCount = tree.getDistinctRepItemCount(REP_ITEM_TYPE_DUE, true);
                newCount = tree.getDistinctRepItemCount(REP_ITEM_TYPE_NEW, true);
            }
        } catch {
            /* counts are cosmetic only */
        }

        const deckPath = this.currentDeckPath(sequencer);
        const deckName: string | null = deckPath.length > 0 ? deckPath : null;

        let srSettings: SRSettingsLike | undefined;
        try {
            srSettings = sr.dataManager?.data?.settings;
        } catch {
            /* labels fall back to defaults */
        }
        const buttonLabels = {
            again: asString(srSettings?.flashcardAgainText, "Again"),
            hard: asString(srSettings?.flashcardHardText, "Hard"),
            good: asString(srSettings?.flashcardGoodText, "Good"),
            easy: asString(srSettings?.flashcardEasyText, "Easy"),
        };

        const boundSequencer = sequencer;
        return {
            front: card.front.trimStart(),
            back: card.back,
            deckName,
            dueCount,
            newCount,
            isNewCard,
            buttonLabels,
            rate: async (response: ReviewResponseValue) => {
                await processReview.call(boundSequencer, response);
            },
        };
    }

    /**
     * Picks a deck at random from those holding cards that pass the deck filter,
     * weighted by the number of eligible cards each deck itself holds (subdecks
     * are their own candidates). Returns null when nothing is eligible.
     */
    private pickRandomDeck(
        sr: SRPluginLike,
        dueCardsOnly: boolean,
        filter: DeckFilter,
    ): SRDeck | null {
        const candidates: { deck: SRDeck; weight: number }[] = [];
        const collect = (deck: SRDeck, path: string): void => {
            if (typeof deck.getDistinctRepItemCount === "function" && deckAllowed(path, filter)) {
                let weight = deck.getDistinctRepItemCount(REP_ITEM_TYPE_DUE, false);
                if (!dueCardsOnly) {
                    weight += deck.getDistinctRepItemCount(REP_ITEM_TYPE_NEW, false);
                }
                if (weight > 0) candidates.push({ deck, weight });
            }
            const subdecks = deck.subdecks;
            if (!Array.isArray(subdecks)) return;
            for (const entry of subdecks as unknown[]) {
                const sub = entry as SRDeck;
                if (typeof sub?.deckName !== "string") continue;
                collect(sub, path.length > 0 ? `${path}/${sub.deckName}` : sub.deckName);
            }
        };
        try {
            const root = sr.dataManager?.osrCore?.remainingDeckTree;
            if (root) collect(root, "");
        } catch {
            return null;
        }
        if (candidates.length === 0) return null;
        let r = Math.random() * candidates.reduce((sum, c) => sum + c.weight, 0);
        for (const candidate of candidates) {
            r -= candidate.weight;
            if (r < 0) return candidate.deck;
        }
        return candidates[candidates.length - 1].deck;
    }

    /** Full deck path of the current card, e.g. "flashcards/韓国語" ("" if unknown). */
    private currentDeckPath(sequencer: SRSequencer): string {
        try {
            const deck = sequencer.currentDeck;
            const topicPath =
                typeof deck?.getTopicPath === "function" ? deck.getTopicPath() : undefined;
            const path = topicPath?.path;
            if (Array.isArray(path)) {
                return (path as unknown[]).map((p) => String(p)).join("/");
            }
        } catch {
            /* fall through */
        }
        return "";
    }
}
