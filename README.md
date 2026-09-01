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
```

The app opens on the Sourcing Board. To reach the vendor portal, open the user
menu (top right) and choose **Open vendor portal**. In production these are
separate applications with separate authentication and nothing in one is
reachable from the other; the switch exists only so both can be demonstrated
from one running app, and it is the one seam that would not ship.

---

## The idea the whole codebase rests on

**RFI, RFP, RFQ, Negotiation and Auction are not four objects — they are stages
of one `SourcingEvent`.** Everything hangs off it: lots and line items, bidders,
questionnaires, responses, scores, negotiation rounds, the auction and the award.

That is why the "RFQ list" in the nav is a filtered projection
(`StageList` in `src/admin/IntakeAndLists.tsx`), not a second table, and why the
event workspace derives its tab strip from the journey pattern rather than
hard-coding thirteen tabs.

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
    feedbackPolicy.ts    The visibility manifest (security-critical)
    transformation.ts    Bid transformation, and its inverse
    evaluation.ts        Scoring, and the corrected award-score model
    savings.ts           Baselines, negotiated vs realised
    journeyPatterns.ts   JP-01…JP-13, the stage rail, transition gates
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

  design-system/     Pack 00, tokens and components
  data/seed.ts       Seed data lifted from the design files
  data/purchaseRequests.ts  Requisitions, lines generated from a fixed seed (1–100 lines)
  data/nfaScenarios.ts      Notes with history — a return, a recall, a rejection, an approval
  store/store.tsx    Reducer over the domain; components never mutate directly
  admin/             Packs 01–09, 13–18, 20–23, 25–28
    nfa/                 Pack 28's surfaces: revision drawer and diff, amendment
                         banner, chain history, recall, scope change, tolerance,
                         errata, and the open-decision sheet
  portal/            Packs 10–12, 19, 24
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
6. **Award and approve** — scenarios, the twelve-section NFA populated from the
   event, DoA resolution with an uplift on rank override, then the approval
   decision view.
7. **Configuration Studio** — change the feedback policy at category scope and
   watch the event-scope value still win; try to change `blind_technical`, which
   is locked at tenant.
8. **Open a purchase request** — Procurement → Purchase Request. Click a request
   number to expand it into its items. RQ-TGRANL-00108 carries 100 lines, and
   00115, 00119, 00122, 00124 and 00033 sit at 76, 57, 38, 24 and 20, so the
   expansion is exercised across the range rather than at one point. The amount
   on the row is the sum of the lines in the panel — the same array, so the two
   cannot disagree — and a line already out in an event is not offered for
   sourcing again.
9. **Consolidate demand and source it** — the *Requested* tab is the basket: every
   requisition line across every requisition, each against its own RQ id. Tick
   lines from several requisitions and the rest of the list greys out, because
   category binds a basket — it drives the questionnaire, the shortlist, the
   evaluation model and the DoA chain, so one event cannot carry two. *Initiate
   sourcing* assigns a **PRD** number mapping the demand to its RQ ids, and opens
   the wizard with basics and lines populated. Publishing marks exactly those
   lines as out in the event, in the same dispatch that creates it.
10. **Configure a questionnaire** — Configuration Studio → Questionnaire. *Journey
   weighting* is the point: pick a journey pattern and the six vendor input points
   show what each asking contributes to the technical score, renormalised over the
   points that journey actually runs — JP-06 runs RFP alone, so RFP takes 100%.
   Weights are relative, never percentages, and the effective share is shown
   beside each. *Template library* holds the question sets; QT-RFI-COMBINED is
   deliberately broken so the three rules have something real to catch.
11. **Compose a journey** — the Journey patterns domain shows the thirteen-pattern
   master and composes new journeys from stage components. Pick components and the
   wizard, the workspace tabs, the supplier task labels and the duration estimate
   all recompute, because every one of them is derived from the stage set rather
   than entered. Enablement resolves narrowest-wins like every other setting;
   custom journeys deliberately do not — they **accumulate** down the chain, so
   the tenant's `CJ-01` stays available inside Indirect alongside the category's
   own `CJ-02`.
12. **Put an award through a second run** — Approvals, on RFQ-2026-0142. Seed a
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
13. **Hit the wall after the award** — Items & Lots or the award scenario grid,
   once the event is at Award Recommended or later. *Add a line* does not fail
   silently and is not a greyed control: it opens the panel that says an award
   line must trace to a bid and this item was never quoted, then offers the
   routes that are legitimate — a new event carrying the lineage and the
   shortlist, a call-off with its remaining ceiling headroom where the award
   established a contract that covers the category, and the corrigendum flow
   while responses are still open. OD-06 switches the panel between listing,
   recommending and pre-selecting.
14. **Settle nine open decisions by pointing** — *Open the sheet* in the
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
