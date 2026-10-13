# RFx & E-Auction

A configurable RFx and E-Auction module for an enterprise Procure-to-Pay platform,
built from the `Concepts/` notes and the `Build Pack 00 delivered 2/` design files.

Two applications, one domain:

| | **Admin Platform** | **Vendor Portal** |
|---|---|---|
| Users | Buyers, evaluators, approvers, administrators | Suppliers, and customers on sell-side events |
| Chrome | Three-column, dense, 44px rows, 13–14px body | Top nav, airy, 56px rows, 15–16px body |
| Language | Internal terms permitted (NFA, DoA, envelope) | Plain language only |
| Nav depth | Up to 4 levels | 2 levels maximum |

---

## Running it

```bash
npm install
npm run dev        # http://localhost:5180
npm test           # engine tests
npm run typecheck  # no emit, strict
npm run build      # production bundle
npm run api        # the event-creation API on http://localhost:5176
npm run dev:portal # the supplier portal, on its own origin: http://localhost:5181
npm run dev:all    # the API and both applications
```

The app opens on the Sourcing Board. To reach the vendor portal, open the user
menu (top right) and choose **Open vendor portal**. In production these are
separate applications with separate authentication and nothing in one is
reachable from the other; the switch exists only so both can be demonstrated
from one running app, and it is the one seam that would not ship.

### The two applications, on two origins

`npm run dev:portal` runs the supplier portal as what it really is — a separate
application on a separate origin, with its own session and no route back. Two
origins share no browser storage, so "an event published in admin appears in the
portal" needs somewhere outside both to hold it.

That is the **sync seam**: one in-memory document, split by owner. The buyer
writes events, lots, lines, terms, invitations and questionnaires; the supplier
writes responses. Neither side can overwrite the other's half, so there is no
conflict to resolve.

It is served by the buyer's dev server at `/__sync`, and the portal's dev server
proxies the same path to it — so the call is same-origin from both sides, there
is no CORS, and there is no third process to remember. Start `npm run dev` and
`npm run dev:portal` and the link is up. If the buyer's platform is not running,
both applications say so in a banner rather than quietly showing stale data.

Three things the seam does deliberately, each of them a bug that was found by
running it rather than reading it:

- **A push merges by id; it does not replace the collection.** Two tabs of the
  buyer's platform are two independent stores. Replacing meant the older tab
  erased what the newer one had just published, every time it pushed — the event
  appeared in the portal and vanished a second later.
- **What was last sent is recorded per tab, not per side.** Keyed by side, a
  second tab invalidated the first tab's record, the first read that as a failed
  push and sent again, and the two re-sent identical documents at each other for
  as long as both were open.
- **Silence is reported as silence.** "The buyer has published nothing" and "the
  buyer's platform is not running yet" are the same empty array over the wire,
  and applying the second one blanks a portal that was fine a moment earlier.

`npm run sync` runs the identical handler on `:5175` for anyone who wants the
seam as a server they can curl and restart on its own; point both applications
at it with `VITE_SYNC_URL=http://localhost:5175`.

---

## Auction mechanisms are configuration, not ten builds

A naive build has ten auction "types", each with its own screen and its own
logic. That is unmaintainable, and it is how a product ends up contradicting
itself about price direction.

Instead the mechanism is a **label over orthogonal attributes**, and
`domain/auctionMechanics.ts` is where the consequences of those attributes live:

| Attribute | What it decides |
|---|---|
| `bidEntry` | Whether there is a number to type at all — and therefore which control the supplier sees |
| `clockOwner` | Whether bidders move the price or a system clock does |
| `liveRanking` | Whether a standing exists *while it runs*. Four of the ten have none |
| `elimination` | Whether a bidder can be put out permanently before it closes |
| `buyerDrivesProgress` | Whether a round, a reveal or a turn needs a human |

Both applications read that one module. The controller's **Advance the round**
and the bidder's **Stay in at ₹4,68,000** are two views of a single rule, which
is the point: a cockpit and a console that each kept their own copy would
eventually describe different auctions, and in a format where not acting
eliminates you, that difference is a supplier losing a tender to a screen.

What falls out of it:

- **The E-Auction section lists auctions, not events at the auction stage.** The
  mechanism is a column, because a Japanese auction three rounds in and a sealed
  bid waiting to be opened have nothing in common but a status.
- **The controller's actions are the ones that mechanism has.** A Dutch auction
  offers no *Extend* — the clock is the auction. A sealed bid offers *Open the
  envelopes* once, typed-confirmed, logged before the values become readable.
- **The supplier's control is the decision they actually face.** One button and
  a consequence in Japanese; one button and no number in Dutch; one submission
  and a receipt in sealed; a closed box until your turn in rank compression; a
  live composite in multi-attribute.
- **Contradictions are refused rather than rendered.** `mechanismIssues` blocks
  a sealed bid with rank feedback, a Dutch auction that reports a position, a
  clock owner the mechanism inverts.

The visibility manifest in `domain/feedbackPolicy.ts` still decides what a
bidder may *see*; nothing in the mechanics module widens it. The tests in
`admin/__tests__/auctionMechanisms.test.tsx` render both sides of every seeded
auction and assert that no competitor name or number crosses the boundary.

---

## The idea the whole codebase rests on

**RFI, RFP, RFQ, Negotiation and Auction are stages of one piece of work, not
four unrelated tenders.** One sourcing event owns the basket — its lots, its line
items and the requisition lines behind them — and everything else hangs off the
family it heads: bidders, questionnaires, responses, scores, negotiation rounds,
the auction and the award.

What publishing creates is therefore a *family*, not a record. A Full Ladder
journey produces the sourcing event on the board plus one **ask** per
solicitation stage, each with its own number, deadline, invitations and inbox:

```
SRC-2026-0007  Facilities Management 2026        the board
  ├─ RFI-2026-0011   issued now                  the RFI section
  ├─ RFP-2026-0012   planned                     the RFP section
  ├─ RFQ-2026-0013   planned                     the RFQ section
  └─ AUC-2026-0014   planned                     the E-Auction section
```

Two rules stop that becoming four copies of the same event:

- **One basket.** Lots and lines belong to the sourcing event; an ask inherits
  them (`lotsForEvent`, `lineItemsForEvent`). Re-lotting once cannot leave the
  RFP describing something the RFQ does not.
- **Invitations belong to the ask.** A supplier invited to the RFI has not
  thereby been invited to the RFP, which is also what lets the portal show four
  separate asks with four separate deadlines instead of one event with a list of
  stages.

The asks behind the first are created *planned* — prepared, scheduled, and not
yet sent to anybody. Issuing one is a decision the buyer takes ("Issue now" on
the event overview, or `POST /api/events/:id/issue`), not a timer.

That is why the "RFQ list" in the nav is still a filtered projection
(`StageList` in `src/admin/IntakeAndLists.tsx`) rather than a second table — it
filters on `currentStage`, and an ask has exactly one stage — and why the event
workspace derives its tab strip from the journey pattern rather than hard-coding
thirteen tabs. `src/domain/stageEvents.ts` is where a journey turns into a
family, and it is pure: same input, same clock, same numbers out.

A fourth, on what is asked: **a questionnaire is not owned by a stage.** An RFx
journey asks the supplier for information at several points, and the same
capability set is routinely asked more than once — so a template declares the
`VendorInputPoint`s it may be applied at, and the journey decides which of those
run. A stable question `code` is what lets an answer given at RFI be carried into
RFP rather than asked twice.

A third, on the way in: **an event's source reference is a PRD, not a PR.** A
sourcing event is routinely raised for lines drawn from several requisitions, so
the event points at one consolidated demand and that demand carries the RQ
numbers and the specific line ids. A typed requisition reference could not be
walked back to lines; `PRD-2026-0001` can.

The second load-bearing idea: **`side` (BUY or SELL) is set once at creation and
is immutable**, and every comparison in the product routes through
`src/domain/comparator.ts`. Nothing anywhere hard-codes "lowest wins".

A corollary the journey composer rests on: **a journey is a subset of the
canonical stage order, never a re-ordering.** `buildStageRail` and
`workspaceTabs` both walk `STAGE_ORDER`, so a journey claiming AUCTION before
RFQ would render in canonical order anyway and the configuration would be a lie.
The composer therefore offers inclusion only, and normalises what it is given.

---

## Layout

```
src/
  domain/            Pure logic. No React, no I/O. This is the product.
    types.ts             The data model from DATA_MODEL_REFERENCE.md
    comparator.ts        BUY/SELL inversion — the single point of truth
    auctionEngine.ts     Ranking, bid validation, anti-gaming, proxies
    auctionMechanics.ts  What each of the ten mechanisms *is* — how a bid arrives,
                         who owns the clock, what the controller may do next
    feedbackPolicy.ts    The visibility manifest (security-critical)
    transformation.ts    Bid transformation, and its inverse
    evaluation.ts        Scoring, and the corrected award-score model
    savings.ts           Baselines, negotiated vs realised
    journeyPatterns.ts   JP-01…JP-13, the stage rail, transition gates
    stageEvents.ts       One publish → the sourcing event and the asks its journey implies
    comparison.ts        The technical and commercial comparison sheets, and their CSV export
    eventTimeline.ts     Windows per ask, and the rules for moving a deadline
    terms.ts             The terms an event goes out with, and where each set applies
    journeyComposer.ts   Stage components, derivation and validation for custom journeys
    purchaseRequests.ts  Requisition lines as sourceable demand; amounts derived, never stored
    sourcingRequisition.ts  Consolidating lines across requisitions into one PRD demand
    questionnaireTemplates.ts  What is asked at each vendor input point, and what it is worth
    questionTypes.ts     What each question type asks for, and the suggested choice sets
    config.ts            Four-scope resolution with locking
    doa.ts               Delegation of authority + the simulator
    nfaLifecycle.ts      The NFA after the first run — materiality, revisions,
                         chain consequence, recall, rejection, scope-change routing
    agents.ts            The sixteen agents and their eight hard limits
    permissions.ts       Roles and the hard separation rules
    statusMachine.ts     Legal transitions and status presentation
    __tests__/           ~500 assertions over the above

  server/            The boundary a client talks to. Owns the clock and the seal.
    clock.ts             Server-authoritative time
    audit.ts             Append-only ledger
    envelopeGuard.ts     Envelope separation, enforced at the data layer
    auctionService.ts    Bid submission, controller actions, buyer/bidder views

  api/               Creating events as an API. One router, two transports.
    router.ts            Every route, as a pure function of a request
    repository.ts        What the API holds — in memory, seeded, reset-able
    client.ts            In-process and HTTP clients behind one interface
    server.ts            What api-server.mjs loads

  design-system/     Pack 00, tokens and components
  data/seed.ts       Seed data lifted from the design files
  data/purchaseRequests.ts  Requisitions, lines generated from a fixed seed (1–100 lines)
  data/termsTemplates.ts    The terms library — general, payment, delivery, NDA, compliance, bid
  data/nfaScenarios.ts      Notes with history — a return, a recall, a rejection, an approval
  store/store.tsx    Reducer over the domain; components never mutate directly
  store/sync.ts      Keeping the two applications in step across two origins
  admin/             Packs 01–09, 13–18, 20–23, 25–28
    AuctionBoard.tsx     The E-Auction section — every auction, with its mechanism
    tabs/AuctionMechanismPanels.tsx  The cockpit parts that differ by mechanism
    nfa/                 Pack 28's surfaces: revision drawer and diff, amendment
                         banner, chain history, recall, scope change, tolerance,
                         errata, and the open-decision sheet
  portal/            Packs 10–12, 19, 24
    BiddingModes.tsx     The bid control each mechanism actually needs

sync-core.mjs         The sync seam: one shared document, split by owner
vite-plugin-sync.mjs  …mounted at /__sync on the buyer's dev server
sync-server.mjs       …or on a port of its own, for when you want to curl it
api-server.mjs        The event-creation API on :5176
```

The dependency rule is one-directional: `domain` knows nothing about `server`,
`server` knows nothing about React, and components dispatch rather than mutate.
That is what lets the same rules apply identically to the buyer cockpit and the
supplier console.

### The one layout rule

No section may paint over another. Getting that for free rather than policing it
per screen takes four classes in `design-system/global.css` — `.rfx-split`,
`.rfx-side`, `.rfx-nav`, `.rfx-triple` for multi-column work surfaces, and
`.rfx-stack` for the single-column stacks inside them. Use those instead of an
inline `gridTemplateColumns`.

What they do, and why it is not optional:

- **`min-width: 0` on every child.** A grid item defaults to `min-width: auto`,
  so an item holding something with a wide minimum — a bid table, a long
  reference — grows past its own track, bleeds into the next column, and gets
  painted over by whichever sibling comes later in the DOM. This is what made
  the "Bid on behalf" rail sit on top of the live standing table.
- **`grid-template-columns: minmax(0, 1fr)` on the stacks.** An `auto` track
  cannot shrink below its widest child's minimum, so a single wide table would
  otherwise push a whole stack of cards past the column containing it.
- **Columns collapse before they get too narrow** (1480px for three, 1280px for
  two) rather than being squeezed until something has to give.
- **`repeat(auto-fit, minmax(min(Npx, 100%), 1fr))`**, never a bare `Npx` —
  otherwise a 340px minimum inside a 300px rail overflows by 40px.
- **`.rfx-scroll-x` is `position: relative`.** Wide content scrolls inside its
  own container; without the positioning, an absolutely positioned descendant
  such as a visually-hidden label is laid out against the viewport instead,
  escapes the scroller, and widens the entire page.

Verified with a DOM probe over every route, every workspace tab and both portal
and admin surfaces at 900/1024/1280/1440/1728px: no element paints outside its
parent, and the page never scrolls sideways.

---

## The API

Creating events is available as an API as well as a wizard. Both go through the
same code — `src/api/router.ts` is a plain function from a request to a
`{ status, body }`, and it has two transports:

- **In-process.** The default. The wizard calls `sourcingApi()` and the routes
  run in the tab, so the prototype publishes with nothing else running.
- **Over HTTP.** `npm run api` serves the same routes on `:5176`. Point the app
  at it with `VITE_API_URL=http://localhost:5176` and the wizard's publish goes
  over the wire instead.

There is one implementation of what a route means, so the two cannot drift.
Everything the server holds is in memory: restart it and it is back to the seed.

```bash
npm run api        # the API on :5176
npm run dev:all    # the API and both applications
curl localhost:5176/api            # every route, with a one-line summary
```

### Creating a family

`POST /api/sourcing-events` takes exactly what the nine wizard steps collect —
one field group per step — and creates the sourcing event plus every ask its
journey implies.

```jsonc
{
  "journeyPattern": "JP-05",                       // 1 · Basics
  "title": "Facilities Management 2026",
  "category": "Facilities",
  "businessUnit": "Corporate Services",
  "ownerId": "user-ar",
  "sourceReference": "PRD-2026-0004",              //     raised against a PRD
  "lines": [                                       // 2 · Items & Lots
    { "description": "HVAC planned maintenance", "quantity": 96, "uom": "visit",
      "baselinePrice": 2400, "lotName": "Lot 1 · Hard services",
      "sourcePrLineId": "pr-0125-01" }             //     PR line → event line
  ],
  "bidders": [                                     // 3 · Bidders
    { "counterpartyId": "cp-abc", "category": "Facilities" }
  ],
  "questionnaires": [                              // 4 · Questionnaire
    { "point": "RFI", "name": "Capability", "questions": [ /* … */ ] }
  ],
  "terms":      { "attached": true },              // 5 · Terms
  "evaluation": { "envelopeMode": "TWO_ENVELOPE",  // 6 · Evaluation
                  "technicalGate": "MIN_SCORE", "minTechnicalScore": 60 },
  "auction":    { "mechanism": "ENGLISH",          // 7 · Auction
                  "feedbackPolicy": "RANK_GAP", "minDecrement": 500 },
  "timeline":   { "closesInHours": 72,             // 8 · Timeline
                  "stageHours": { "RFI": 120, "AUCTION": 4 } },
  "publish": true                                  // 9 · Review
}
```

`201` returns every record it created — the event, the asks, the lots, the
lines, the invitations, the questionnaires — plus a derived `schedule`:

```jsonc
{ "event": { "eventNumber": "SRC-2026-0001", "status": "PUBLISHED", … },
  "schedule": [
    { "stage": "RFI",     "eventNumber": "RFI-2026-0001", "status": "PUBLISHED" },
    { "stage": "RFP",     "eventNumber": "RFP-2026-0001", "status": "DRAFT" },
    { "stage": "RFQ",     "eventNumber": "RFQ-2026-0143", "status": "DRAFT" },
    { "stage": "AUCTION", "eventNumber": "AUC-2026-0001", "status": "DRAFT" }
  ], … }
```

Windows run back to back — the RFP opens when the RFI closes — and numbering
continues from what already exists rather than restarting, which is why the RFQ
above is `0143` and not `0001`.

A refusal is a `400` that names the fields, never a silent partial create:

```jsonc
{ "error": "The event could not be created.",
  "details": [ { "field": "lines[0].quantity",
                 "message": "Quantity must be greater than zero." } ] }
```

### Creating one ask

`POST /api/rfis`, `/api/rfps`, `/api/rfqs`, `/api/auctions` each create a single
ask. With `parentEventId` the ask joins an event that already exists and
inherits what it does not restate — title, owner, category, currency, the
basket, and the shortlist already invited to its siblings:

```bash
curl -X POST localhost:5176/api/auctions -H 'content-type: application/json' \
  -d '{ "parentEventId": "evt-1788721864342",
        "auction": { "mechanism": "JAPANESE" },
        "timeline": { "closesInHours": 2 } }'
```

Without one, the ask is standalone and raises an umbrella of its own so it still
reaches the board. A second ask of the same kind on one event is refused.

### Reading

| Route | What it answers |
| --- | --- |
| `GET /api/journeys` | the patterns, and which asks each one creates |
| `GET /api/sourcing-events` | the board — umbrellas only |
| `GET /api/sourcing-events/:id` | one family: asks, basket, invitations, questionnaires |
| `GET /api/events?stage=RFI` | what the RFI section lists (also `?status=`, `?parentId=`, `?ownerId=`) |
| `GET /api/events/:id` | one event, with the basket resolved through its family |
| `GET /api/rfis` `/api/rfps` `/api/rfqs` `/api/auctions` | the same, per section |
| `POST /api/events/:id/issue` | issue a planned ask |
| `GET /api/events/:id/timeline` | the schedule, the rules in force, and every extension granted |
| `POST /api/events/:id/extend` | move a deadline — refused when the event's own rules say no |
| `POST /api/reset` | back to the seed |

---

## The comparison sheet

Two sheets, on the **Comparison** tab of the event workspace: suppliers across
the top, what was asked of them down the side.

**Technical** is built from the questions in the technical envelope of every ask
in the family, grouped by the ask that asked them — a ladder asks capability at
RFI and re-confirms it at RFP, and a supplier is read down one column across
both. Each cell carries the answer, any attachment, and the consensus score.
The sheet closes with the weighted score, how much of it has actually been
scored, the rank, and the gate verdict.

That verdict is deliberately three-valued. The score is a percentage of the
*achievable* total, so mid-evaluation it is low by construction; reporting that
as "does not qualify" would fail every supplier on the day the sheet is opened,
which is wrong in the direction that gets a qualified supplier excluded. So the
gate reads **scoring incomplete** until every weighted question is scored — with
one exception: a knockout scored zero decides immediately, however much else
remains open.

**Commercial** is the quotation against the basket. Per line: price, quantity,
tax and total per supplier, then `L1 VENDOR` and `L1 QUANTITY` naming the
supplier that line would go to. Per supplier: Other Charges, Base Amount, Tax
Amount, the landed total and a rank.

```
                      ABC Supplies   Global Office   Metro Business   L1 VENDOR        L1 QUANTITY
Lot 1 · Paper
  A4 copier paper     Rank 3         Rank 4          Rank 1           Metro Business   12,000
  Price               $8.15          $8.58           $7.80
  Qtty                12,000         12,000          12,000
  Tax (12%)           $11,736.00     $12,355.20      $11,232.00
  Total               $109,536.00    $115,315.20     $104,832.00
  …
Other Charges         $7,138.20      $480.65         $10,408.33
Base Amount           $154,642.00    $162,826.20     $148,015.80
Tax Amount            $18,557.04     $19,539.14      $17,761.90
Total landed value    $180,337.24    $182,845.99     $176,186.03     Metro Business   $176,186.03
Commercial rank       Rank 2         Rank 3          Rank 1
```

Four rules the sheet will not bend:

- **A blank is not a zero.** A supplier who did not quote a line shows an em
  dash, is not ranked on it, and cannot become L1 by silence.
- **A partial quotation is not ranked on total.** Priced 4 of 6 lines and it is
  ranked line by line but left out of the total ranking, because a partial bid
  compared against a complete one is the classic false L1.
- **Nothing hard-codes "lowest wins".** Every rank routes through `comparator`,
  so a SELL event inverts by construction. Ties share a rank rather than being
  broken by array order.
- **Money is derived once, to the cent.** Line totals, base and tax amounts are
  computed in `domain/comparison.ts` and nowhere else, and the screen and the
  CSV show the same figures — an approver must not be able to find two numbers
  for one bid.

Tax comes from the line's tax class (`TAX_RATE_BY_CLASS`), standing in for the
tax master. Other charges resolve on the same four bases the auction's
transformation uses — per unit, per line, percentage, lump sum — so a charge
cannot mean one thing in the cockpit and another here.

A two-envelope event shows the commercial sheet as **sealed**, with no prices at
all, until it is unlocked; the technical sheet is read against masked labels
while `evaluation.blind_technical` is on, which is locked at tenant scope.
**Export CSV** writes either sheet in the layout above.

---

## Time rules

Every ask an event creates — RFI, RFP, RFQ, auction — has a real start and a
real end, and one set of rules governs all of them. The rules are set once on
the **Timeline** step of the wizard and **frozen onto the event at publish**, so
an extension six weeks later is judged against what the event went out under
rather than against whatever the tenant default has since become.

One set per event is the point. An RFQ that may be extended twice while the RFI
beside it may be extended five times is not a policy, it is an accident.

### The schedule

Windows run in journey order and may not overlap. Only the **close** date is
stored, on each ask; an opening is derived from the ask before it plus the
configured gap. One stored date rather than two is what stops a schedule
drifting out of step with itself when a deadline moves.

```
RFI-2026-0001   opens 5 Sep 09:00   closes  8 Sep 09:00   72h   clarifications close 7 Sep 09:00
RFP-2026-0001   opens 8 Sep 09:00   closes 11 Sep 09:00   72h   …
RFQ-2026-0143   opens 11 Sep 09:00  closes 14 Sep 09:00   72h   …
AUC-2026-0001   opens 14 Sep 09:00  closes 14 Sep 12:00    3h   —
```

An auction is exempt from the response-window rules and held to its own floor of
ten minutes: a live event running for days is not a live event, and the hours
rule that protects a supplier's pricing time does not apply to it.

### What the rules cover

| Rule | What it does |
| --- | --- |
| `minResponseWindowHours` / `maxResponseWindowDays` | how short and how long an ask may be open |
| `gapHoursBetweenStages` | quiet time between one ask closing and the next opening |
| `maxExtensions` | how many times each ask may be extended; `0` forbids it |
| `maxExtensionHoursEach` / `maxTotalExtensionHours` | the cap on one extension, and the budget across all of them |
| `approvalRequiredBeyondHours` | past this, a second authorised approver is required |
| `minReasonLength` | how much of a narrative suppliers are owed |
| `allowReopenAfterClose` / `reopenWithinHours` | whether a closed ask can be reopened, and for how long |
| `clarificationCutoffHours` | when questions stop being accepted before each deadline |
| `notifyChannels` / `notifyAudience` | who is told a date moved, and how |
| `cascade` | `SHIFT` moves everything behind it; `ABSORB` keeps the end date |
| `autoExtendAuction`, `autoExtendMinutes`, `maxAutoExtensions` | soft close on the auction |

### Extending

Extending is not an edit box. Moving a deadline asks for:

- **the new date** — as `+12h`, `+24h`, `+48h` or a figure typed in;
- **a reason from a fixed list** — clarifications unanswered, corrigendum
  issued, requirement changed, too few responses, supplier request, technical
  issue, internal delay, other. A closed list because "why do we keep extending
  RFQs" is a question asked once a quarter and unanswerable from a thousand
  free-text sentences;
- **a narrative** of at least `minReasonLength` characters, sent to suppliers
  verbatim;
- **a corrigendum reference**, when that is the reason;
- **who is told and how**, defaulted from the rules;
- **a second approver**, past the threshold — and never the person asking.

Before the button, the dialog says what it will do to the asks behind it. After
it, the extension is kept against the ask with both names, the old and the new
date, the channels and the time — append-only, on the **Timeline** tab. It
cannot be edited; a further change is another extension.

Everything the dialog enforces is enforced identically over HTTP:

```bash
curl -X POST localhost:5176/api/events/$RFI/extend -H 'content-type: application/json' \
  -d '{ "addHours": 24, "reason": "CLARIFICATION_PENDING",
        "narrative": "Two clarifications on the HVAC specification are still unanswered.",
        "requestedBy": "user-ar" }'
```

```jsonc
// A refusal names the rule, and the field it belongs to.
{ "error": "The event could not be extended.",
  "details": [ { "stage": "RFQ", "field": "newCloseAt",
                 "message": "This adds 96h; one extension may add at most 24h on this event." },
               { "stage": "RFQ", "field": "approvedBy",
                 "message": "An extension longer than 48h needs a second authorised approver." } ] }
```

`GET /api/events/:id/timeline` returns the schedule, the rules in force and
every extension granted.

---

## Terms and conditions

An event does not go out with one set of terms and a tick box. It goes out with
several, and they do not all apply at the same point in the journey. Two are
asked for first and blocked without:

- **General terms and conditions** — the conditions of purchase, attached to
  every ask, because a supplier answering an RFI is already inside a process
  with rules.
- **Payment terms and conditions** — credit period, trigger, advance, retention
  and price basis. These belong where a price is asked and nowhere else: quoting
  a number without knowing when it is paid is quoting a different number.

Around those sit the sets market practice adds as the journey narrows —
delivery and liquidated damages, warranty, confidentiality, compliance and code
of conduct, the bid conditions themselves, and special conditions for one event.
All eight are in the library at `data/termsTemplates.ts`, with the clause
numbering a supplier and an approver will both cite.

**A document is attached to the sourcing event and names the asks it applies
at.** One document applied at RFP and RFQ is one row, not two copies that later
disagree; `termsForEvent` resolves what a given ask carries.

```
Terms                                   RFI   RFP   RFQ   AUCTION
General conditions of purchase v3.2      ✓     ✓     ✓      ✓
Payment terms — Net 45 with retention    —     ✓     ✓      ✓
Confidentiality undertaking v1.0         ✓     ✓     —      —
```

The Terms step is that grid, plus an editor for the document in hand: title,
category, version, what the supplier must do about it (read only, accept,
accept-or-deviate clause by clause, sign and return), whether a deviation may be
proposed at all, the clauses with a non-negotiable flag on each, and — on a
payment document — the figures as **fields rather than prose**, because credit
days and retention are what a comparison sheet puts side by side.

What the wizard blocks on:

- an ask with no terms at all;
- an ask with no general conditions;
- a price asked with no payment terms — blocking at RFQ and auction, a warning
  at RFP where the price is indicative;
- two payment documents at the same ask, which a supplier cannot both follow;
- a document applied at nothing, or with neither clauses nor an attachment;
- advance plus retention over 100% of the order.

Warnings cover the judgement calls: retention with no stated release date ("a
supplier prices that as never"), core terms that ask for no confirmation,
payment terms on an RFI, a document applied at an ask the journey does not run.

The same rules gate the API, so an integration cannot publish what the wizard
would refuse:

```jsonc
{ "error": "The event could not be created.",
  "details": [ { "field": "terms.PAYMENT",
                 "message": "the RFQ asks for a price with no payment terms. When a supplier is paid changes the price they quote." } ] }
```

Suppliers see the resolved set on the ask they are answering, in the portal,
before they price anything. Deviations are shown against the clause they are
about on the **Terms** tab — which is what lets one reach the NFA's deviations
section rather than being buried in an attachment.

---

## Where the risk actually is

Five places where a mistake would be expensive, and what stops it.

### 1. A bidder seeing what the feedback policy forbids

`src/domain/feedbackPolicy.ts` is the visibility manifest expressed as code, and
`bidderView` in `auctionService.ts` is the only function permitted to build a
bidder-facing auction payload. The projection is built **by whitelist**: a field
the policy does not permit is absent from the returned object, not blanked out.

`BiddingConsole.tsx` can only render what arrives. Under `RANK_ONLY` there is no
`bestPrice` key to render, so no future edit to that component can leak one.

The manifest is also published in the buyer cockpit (Auction tab → *Visibility
manifest*), because Pack 18 owes Pack 19 that contract.

Tested in `feedbackPolicy.test.ts`, including a loop over every policy asserting
that no key outside the permitted set is ever emitted.

### 2. A sealed commercial envelope being readable

`src/server/envelopeGuard.ts` **throws** rather than returning placeholder data.
`ResponsesTab.tsx` attempts the read and renders the sealed state from the
refusal — so the sealed panel contains no numbers because it was given none.
There is no privileged read path; a `configure_tenant` administrator is refused
identically. Unlock is irreversible, witnessed, and written to the audit log.

### 3. Price counted twice in the award score

The legacy formula `Combined = Price × 40% + RFP Score × 60%` gives price an
effective 64% because the RFP score itself contains price.
`validateAwardScoreModel` rejects any configuration where more than one active
component carries price, and names the effective weight in the error. The
Evaluation tab surfaces it before the rankings can be relied on.

### 4. Ranking on the wrong number

Ranking reads `transformedValue`, never `bidValue`. The seed data is deliberately
constructed so this matters: ABC bids the lowest headline number and lands
second once freight and duty are applied. `bidToBeat` transforms the buyer's
target *back* into each supplier's own terms, so two suppliers correctly see
different figures for the same objective.

### 5. Client-side timing

`serverNow()` is the only time authority. `Bid.clientTimestamp` is stored for
diagnostics and never used for ranking or deadlines; the seed bids carry a
deliberately skewed client clock to make that visible. The `Countdown` component
re-reads the server clock every tick rather than decrementing locally, and
`sequenceNumber` is authoritative on a millisecond collision.

---

## Things that are deliberately not configurable

These are enforced in the domain layer, not in the UI, so no setting reaches them:

- **Clarification fairness.** A substantive answer is broadcast to every bidder.
  Private replies exist only for administrative matters, are labelled, and are
  logged. "Publish to all bidders" is the default action in the composer.
- **Bid withdrawal and self-outbidding.** Never permitted. Both appear as
  permanently-disabled, explained toggles in Auction Setup so administrators can
  see the boundary rather than wonder whether it exists.
- **Price never carries a question weight.** A `price_schedule`, `rate_table` or
  `quantity_break` question that also scores puts price in two places, which is
  the same defect `validateAwardScoreModel` catches on the award side. The
  builder zeroes the weight on switching to a priced type rather than letting a
  template save into an error state.
- **RFI is pre-commercial.** A template applied at RFI may not carry commercial
  questions — RFI qualifies the market before anyone is asked for a price. That
  is what the stage means, not a preference.
- **A knockout must have something to fail on.** A knockout choice question
  where no answer is marked as failing can never fire — a safety net with no
  hole in it, which is worse than none because it reads as protection. So is a
  rule-scored choice question where no choice carries a score. Both are errors,
  not warnings.
- **The eight agent hard limits.** `assertAgentMayNot` throws; there is no flag.
  Agents assist, humans decide.
- **Separation of duties.** `score_technical` and `view_commercial` cannot
  co-exist under two-envelope mode; the recommender cannot hold the final
  approval.
- **Server-authoritative timestamps.**

---

## Personas

Switch from the user menu. Each demonstrates a different boundary:

| Persona | What it shows |
|---|---|
| **A. Rahman** — Category Manager | The full buyer path, cockpit control, award recommendation |
| **J. Silva** — Technical Evaluator | Can score; holds no `view_commercial`, so the seal is real |
| **M. Prasad** — Approver | The approval decision view, built for a phone |
| **K. Tan** — Observer | Read-only; masked identities in the cockpit |

---

## What is demonstrable end to end

1. **Create an event** — the stepper reshapes from 4 to 9 steps as you change
   journey pattern, and nothing you entered is lost.
2. **Run the live auction** — RFQ-2026-0142 opens with a live English auction on
   Lot 1. Place a bid on behalf of a supplier from the cockpit, or switch to the
   portal and bid as ABC Supplies. Rejections carry the real reason:
   below minimum decrement, not an improvement, rebid on own lead, past ceiling.
3. **Soft close** — bid inside the last two minutes and the clock extends, for
   everyone, with the extension logged as a system action.
4. **Feedback policy** — change it in Auction Setup, then look at the portal
   bidding console. The panel changes shape because the payload changed shape.
5. **Unlock the commercial envelope** — witnessed, irreversible, audited.
6. **Attach terms** — the Terms step. It opens with the general conditions and
   payment terms already on, and a grid of which ask carries which. Add the NDA
   from the library and it lands at RFI and RFP; take the payment terms off the
   RFQ and publish is blocked with the reason. On the event, the Terms tab shows
   the same grid; on an ask it shows only what that ask sends.
7. **Move a deadline** — the Timeline tab on any event. The schedule shows each
   ask with its window and its clarification cutoff; **Extend** asks for a
   reason, a narrative and a second approver past the threshold, refuses a third
   extension where two were allowed, and shows what it will do to the asks
   behind it before you commit. The grant is kept underneath, append-only.
8. **Read the comparison** — the Comparison tab on RFQ-2026-0142. Technical
   opens against masked labels with the gate reading *scoring incomplete*, since
   only two of five weighted questions are scored; score the rest on the
   Evaluation tab and the verdict settles. Switch to Commercial and the sheet is
   sealed until it is unlocked, then reads line by line to an L1 supplier per
   line and a landed total per supplier. **Export CSV** gives the same figures
   as the screen.
9. **Award and approve** — scenarios, the twelve-section NFA populated from the
   event, DoA resolution with an uplift on rank override, then the approval
   decision view.
10. **Configuration Studio** — change the feedback policy at category scope and
   watch the event-scope value still win; try to change `blind_technical`, which
   is locked at tenant.
11. **Open a purchase request** — Procurement → Purchase Request. Click a request
   number to expand it into its items. RQ-TGRANL-00108 carries 100 lines, and
   00115, 00119, 00122, 00124 and 00033 sit at 76, 57, 38, 24 and 20, so the
   expansion is exercised across the range rather than at one point. The amount
   on the row is the sum of the lines in the panel — the same array, so the two
   cannot disagree — and a line already out in an event is not offered for
   sourcing again.
12. **Consolidate demand and source it** — the *Requested* tab is the basket: every
   requisition line across every requisition, each against its own RQ id. Tick
   lines from several requisitions and the rest of the list greys out, because
   category binds a basket — it drives the questionnaire, the shortlist, the
   evaluation model and the DoA chain, so one event cannot carry two. *Initiate
   sourcing* assigns a **PRD** number mapping the demand to its RQ ids, and opens
   the wizard with basics and lines populated. Publishing marks exactly those
   lines as out in the event, in the same dispatch that creates it.
13. **Configure a questionnaire** — Configuration Studio → Questionnaire. *Journey
   weighting* is the point: pick a journey pattern and the six vendor input points
   show what each asking contributes to the technical score, renormalised over the
   points that journey actually runs — JP-06 runs RFP alone, so RFP takes 100%.
   Weights are relative, never percentages, and the effective share is shown
   beside each. *Template library* holds the question sets; QT-RFI-COMBINED is
   deliberately broken so the three rules have something real to catch.
14. **Compose a journey** — the Journey patterns domain shows the thirteen-pattern
   master and composes new journeys from stage components. Pick components and the
   wizard, the workspace tabs, the supplier task labels and the duration estimate
   all recompute, because every one of them is derived from the stage set rather
   than entered. Enablement resolves narrowest-wins like every other setting;
   custom journeys deliberately do not — they **accumulate** down the chain, so
   the tenant's `CJ-01` stays available inside Indirect alongside the category's
   own `CJ-02`.
15. **Put an award through a second run** — Approvals, on RFQ-2026-0142. Seed a
   note from the rail: *Three revisions* gives a return at level 2, a recall
   after that, and a live third revision carrying a delegation and an escalation.
   *Revision 3 of 3* opens the drawer — read any revision exactly as its approver
   saw it, or compare two, where a changed allocation renders in the material
   column and a re-worded recommendation does not. Amend a returned note and the
   banner updates as you type: **non-material resumes at level 2, material
   restarts from level 1 and names whose approvals it discards** — before you
   submit, never after. Superseded approvals are struck in the chain history and
   never removed. Flip *DoA matrix edited since* and open revision 3: it still
   renders the chain it was decided under, and says the live matrix has moved.
16. **Hit the wall after the award** — Items & Lots or the award scenario grid,
   once the event is at Award Recommended or later. *Add a line* does not fail
   silently and is not a greyed control: it opens the panel that says an award
   line must trace to a bid and this item was never quoted, then offers the
   routes that are legitimate — a new event carrying the lineage and the
   shortlist, a call-off with its remaining ceiling headroom where the award
   established a contract that covers the category, and the corrigendum flow
   while responses are still open. OD-06 switches the panel between listing,
   recommending and pre-selecting.
17. **Settle nine open decisions by pointing** — *Open the sheet* in the
   Approvals rail. Each of §B14.8's nine decisions, every option, and what the
   screen looks like under it. Choosing an option flips the screens behind the
   drawer, so recall after first approval, rejection's aftermath, the tolerance
   re-approval path and post-approval correction can each be seen both ways
   rather than imagined.

---

## Known scope boundaries

Honest about what this build does and does not include:

- **State is in memory.** A refresh resets to seed. There is no persistence
  layer, no API and no auth — `src/server/` models the server boundary and its
  rules, but runs in the browser.
- **Real-time is simulated.** Bids from the two surfaces share one store rather
  than a socket. The bid-acceptance rules are real; the transport is not.
- **Encryption at rest is asserted, not implemented.** `envelopeGuard` enforces
  that no read path exists before unlock, which is the part that belongs in
  application code; the key management behind it is infrastructure.
- **Some packs are represented rather than fully built.** The form builder edits
  an existing questionnaire rather than composing all 26 question types; the
  template library and analytics (Pack 27) are not built. Pack 28 hands off to
  Pack 04's wizard and Pack 05's corrigendum rather than rebuilding either — the
  handoff is recorded and shown, and the destination screen is the existing one.
- **Four of the ten auction mechanisms run end to end** — English, sealed bid,
  and the single-shot path — the rest are configurable and their rules render,
  but the engine's round handling for Japanese and Dutch clocks is not driven by
  a live system clock in this build.
