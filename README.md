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

The second load-bearing idea: **`side` (BUY or SELL) is set once at creation and
is immutable**, and every comparison in the product routes through
`src/domain/comparator.ts`. Nothing anywhere hard-codes "lowest wins".

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
    config.ts            Four-scope resolution with locking
    doa.ts               Delegation of authority + the simulator
    agents.ts            The sixteen agents and their eight hard limits
    permissions.ts       Roles and the hard separation rules
    statusMachine.ts     Legal transitions and status presentation
    __tests__/           ~200 assertions over the above

  server/            The boundary a client talks to. Owns the clock and the seal.
    clock.ts             Server-authoritative time
    audit.ts             Append-only ledger
    envelopeGuard.ts     Envelope separation, enforced at the data layer
    auctionService.ts    Bid submission, controller actions, buyer/bidder views

  design-system/     Pack 00, tokens and components
  data/seed.ts       Seed data lifted from the design files
  store/store.tsx    Reducer over the domain; components never mutate directly
  admin/             Packs 01–09, 13–18, 20–23, 25–27
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
  template library and analytics (Pack 27) are not built.
- **Four of the ten auction mechanisms run end to end** — English, sealed bid,
  and the single-shot path — the rest are configurable and their rules render,
  but the engine's round handling for Japanese and Dutch clocks is not driven by
  a live system clock in this build.
