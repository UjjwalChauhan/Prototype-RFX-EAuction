/**
 * What the API has created, and what it was seeded with.
 *
 * Deliberately in memory. This is the prototype's stand-in for the service the
 * real product would put behind these routes: stop the process and it starts
 * again from the seed, which is the right behaviour for something a client
 * demonstrates from rather than depends on.
 *
 * The same class backs both transports. In the browser it is built from a
 * snapshot of the store so numbering agrees with what is already on screen; in
 * the API server it holds the server's own records.
 */
import type {
  Auction, AuctionControlEvent, AuctionLot, Bid, EventBidder, Id, LineItem, Lot, Questionnaire,
  SourcingEvent,
} from '../domain/types';
import type { CreatedEvents } from '../domain/stageEvents';
import type { EventExtension } from '../domain/eventTimeline';

/**
 * A running auction, as the API holds it.
 *
 * The configuration and its lots are written once at publish; the bids and the
 * control events are two append-only ledgers on top of them. Nothing derived
 * is stored — the standing, the round a Japanese auction is in, whether the
 * envelopes are open — because a stored derivation is a second opinion waiting
 * to disagree with the log it came from.
 */
export interface AuctionRecord {
  auction: Auction;
  lots: AuctionLot[];
  bids: Bid[];
  controlEvents: AuctionControlEvent[];
}

export interface ApiState {
  events: SourcingEvent[];
  lots: Lot[];
  lineItems: LineItem[];
  bidders: EventBidder[];
  questionnaires: Questionnaire[];
  /** Every deadline that has been moved. Append-only. */
  extensions: EventExtension[];
  /** The auctions, keyed in the list by the ask each one belongs to. */
  auctions: AuctionRecord[];
}

export const emptyState = (): ApiState => ({
  events: [],
  lots: [],
  lineItems: [],
  bidders: [],
  questionnaires: [],
  extensions: [],
  auctions: [],
});

export class Repository {
  private state: ApiState;

  private readonly initial: ApiState;

  constructor(initial: Partial<ApiState> = {}) {
    this.initial = { ...emptyState(), ...initial };
    this.state = { ...this.initial };
  }

  snapshot(): ApiState {
    return {
      events: [...this.state.events],
      lots: [...this.state.lots],
      lineItems: [...this.state.lineItems],
      bidders: [...this.state.bidders],
      questionnaires: [...this.state.questionnaires],
      extensions: [...this.state.extensions],
      auctions: [...this.state.auctions],
    };
  }

  /**
   * Every number in use, so a new one cannot collide with an old one.
   *
   * Auction references belong here as well as event numbers. They are
   * allocated by the same `nextEventNumber` against this list, so leaving
   * them out meant a freshly published auction was handed EA-2026-0001 —
   * a reference another auction was already answering to.
   */
  takenNumbers(): string[] {
    return [
      ...this.state.events.map((event) => event.eventNumber),
      ...this.state.auctions.map((record) => record.auction.auctionNumber),
    ];
  }

  event(id: Id): SourcingEvent | undefined {
    return this.state.events.find((event) => event.id === id);
  }

  /** The asks belonging to one umbrella, in the order the journey issues them. */
  children(parentId: Id): SourcingEvent[] {
    return this.state.events.filter((event) => event.parentEventId === parentId);
  }

  /**
   * The basket an event answers against — its own, or its parent's. One
   * basket per family is the rule; this is where it is enforced on reads.
   */
  basketOf(event: SourcingEvent): { lots: Lot[]; lineItems: LineItem[] } {
    const ownerId = event.parentEventId ?? event.id;
    const lots = this.state.lots.filter((lot) => lot.eventId === ownerId);
    const lotIds = new Set(lots.map((lot) => lot.id));
    return {
      lots,
      lineItems: this.state.lineItems.filter((line) => lotIds.has(line.lotId)),
    };
  }

  biddersOf(eventId: Id): EventBidder[] {
    return this.state.bidders.filter((bidder) => bidder.eventId === eventId);
  }

  questionnairesOf(eventId: Id): Questionnaire[] {
    return this.state.questionnaires.filter((q) => q.eventId === eventId);
  }

  extensionsOf(eventId: Id): EventExtension[] {
    return this.state.extensions
      .filter((extension) => extension.eventId === eventId)
      .sort((a, b) => a.sequence - b.sequence);
  }

  /** One deadline moved: the record kept, and the asks it moved. */
  recordExtension(extension: EventExtension, closes: { eventId: Id; closesAt: number }[]): void {
    const moved = new Map(closes.map((c) => [c.eventId, c.closesAt]));
    this.state = {
      ...this.state,
      events: this.state.events.map((event) =>
        moved.has(event.id) ? { ...event, closesAt: moved.get(event.id)! } : event),
      extensions: [...this.state.extensions, extension],
    };
  }

  // -------------------------------------------------------------------------
  // Auctions
  // -------------------------------------------------------------------------

  allAuctions(): AuctionRecord[] {
    return [...this.state.auctions];
  }

  /** The auction on one ask. `eventId` is the auction ask, not the umbrella. */
  auctionOf(eventId: Id): AuctionRecord | undefined {
    return this.state.auctions.find((held) => held.auction.eventId === eventId);
  }

  /**
   * The auction behind an id, whichever id the caller happens to hold.
   *
   * Callers arrive with the ask's id from the board and the auction's own id
   * from a bid; refusing one of them would be a detail of storage leaking into
   * the URL a client has to construct.
   */
  auction(id: Id): AuctionRecord | undefined {
    return this.auctionOf(id) ?? this.state.auctions.find((held) => held.auction.id === id);
  }

  /** Replace one auction whole. The caller has already applied the transition. */
  replaceAuction(next: AuctionRecord): void {
    this.state = {
      ...this.state,
      auctions: this.state.auctions.map(
        (held) => (held.auction.id === next.auction.id ? next : held),
      ),
    };
  }

  /** Everything one publish created, stored as one transaction. */
  save(created: CreatedEvents): void {
    this.state = {
      events: [...this.state.events, created.event, ...created.stageEvents.filter(
        (stage) => stage.id !== created.event.id,
      )],
      lots: [...this.state.lots, ...created.lots],
      lineItems: [...this.state.lineItems, ...created.lineItems],
      bidders: [...this.state.bidders, ...created.bidders],
      questionnaires: [...this.state.questionnaires, ...created.questionnaires],
      extensions: this.state.extensions,
      auctions: created.auction === null
        ? this.state.auctions
        : [...this.state.auctions, {
          auction: created.auction.auction,
          lots: created.auction.lots,
          bids: [],
          controlEvents: [],
        }],
    };
  }

  replaceEvent(next: SourcingEvent): void {
    this.state = {
      ...this.state,
      events: this.state.events.map((event) => (event.id === next.id ? next : event)),
    };
  }

  reset(): void {
    this.state = { ...this.initial };
  }
}
