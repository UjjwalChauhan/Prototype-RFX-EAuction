/**
 * How a supplier actually bids, which is different in every mechanism.
 *
 * The console used to be an English auction with a one-line caption that
 * changed for the other formats. That caption was the whole difference: a
 * Japanese bidder saw a free price box when their real choice was stay or
 * leave, and a Dutch bidder saw a box when there was nothing to type. In a
 * format where not acting eliminates you permanently, a screen that shows the
 * wrong control is not a usability problem — it is the reason a supplier loses.
 *
 * So the control is chosen by `MECHANISM_PROFILE[...].bidEntry`, the same
 * attribute the buyer's cockpit reads to decide what the controller may do.
 * One rule, two screens, no chance of them describing different auctions.
 *
 * Portal rules apply throughout: plain language, the deadline loudest, the bid
 * control in a fixed position, nothing shown as placed until the server says so.
 */
import React from 'react';
import { color, money, radius } from '../design-system/tokens';
import { Button, Chip, Field, NumberInput } from '../design-system/components/primitives';
import { Countdown, Modal, ValidationBanner } from '../design-system/components/domain';
import {
  MECHANISM_PROFILE, compositeScore, dutchClock, indexedPrice, japaneseClockPrice,
  windowOpenedAt,
} from '../domain/auctionMechanics';
import { improvementLabel } from '../domain/comparator';
import { serverNow } from '../server/clock';
import { boolParam, numberParam } from '../domain/auctionRules';
import { MULTI_ATTRIBUTE_SCHEME, SEED_INDEX } from '../data/seed';
import { PortalCard } from './PortalShell';
import type { BidderView, AuctionState } from '../server/auctionService';
import type { AuctionLot, Lot } from '../domain/types';

export interface BidControlProps {
  held: AuctionState;
  view: BidderView;
  lot: AuctionLot | undefined;
  lotDetail: Lot | undefined;
  bidderId: string;
  currency: string;
  /** Places a bid. `confirmed` answers the over-large-bid guard. */
  place: (value: number, confirmed?: boolean) => void;
  /** False while offline or paused — the control must never look operable. */
  enabled: boolean;
  disabledReason: string | null;
}

/** The control this mechanism actually needs. */
export function BidControl(props: BidControlProps) {
  switch (MECHANISM_PROFILE[props.held.auction.mechanism].bidEntry) {
    case 'STAY_IN': return <StayInControl {...props} />;
    case 'ACCEPT_CLOCK': return <AcceptClockControl {...props} />;
    case 'ONE_SHOT': return <OneShotControl {...props} />;
    case 'TURN_BASED': return <TurnControl {...props} />;
    case 'MULTI_FIELD': return <MultiFieldControl {...props} />;
    default: return <FreeFormControl {...props} />;
  }
}

const bigNumber: React.CSSProperties = {
  fontSize: 36, fontWeight: 700, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1,
};
const label: React.CSSProperties = { fontSize: 13, color: color.textSecondary };

/**
 * The portal's primary action is deliberately larger than the admin's.
 *
 * It is pressed under time pressure, often on a phone, often with a thumb, and
 * often by somebody who has never seen this screen before.
 */
const PRIMARY_ACTION: React.CSSProperties = {
  fontSize: 16, padding: '14px 22px', minHeight: 48,
};

/** The bid control never moves, so a blocked one says why in its own place. */
function Blocked({ reason }: { reason: string }) {
  return (
    <div
      style={{
        background: color.dangerSoft, border: `1px solid ${color.danger}`,
        borderRadius: radius.card, padding: '14px 16px', fontSize: 14.5, color: color.dangerText,
      }}
    >
      {reason}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Japanese — stay in, or leave for good
// ---------------------------------------------------------------------------

/**
 * One decision, one consequence, stated every round.
 *
 * The consequence is on screen at every step rather than in a help panel,
 * because the failure mode here is a supplier who did not realise that doing
 * nothing takes them out — and they only find out when it is irreversible.
 */
function StayInControl({ held, lot, currency, bidderId, place, enabled, disabledReason }: BidControlProps) {
  const [leaveOpen, setLeaveOpen] = React.useState(false);
  const rounds = held.controlEvents.filter((e) => e.kind === 'ROUND_ADVANCED').length;
  const round = rounds + 1;
  const clockPrice = japaneseClockPrice(held.auction, lot?.startingPrice ?? 0, round);
  const nextPrice = japaneseClockPrice(held.auction, lot?.startingPrice ?? 0, round + 1);
  /**
   * How long is left to confirm.
   *
   * Elimination in this format is permanent, so the one thing a bidder must
   * never have to guess is how much time they have. The length is the buyer's
   * setting; the moment the round opened is in the control log.
   */
  const roundClosesAt =
    windowOpenedAt(held.auction, held.controlEvents, 'ROUND_ADVANCED')
    + numberParam(held.auction, 'japanese.roundSeconds') * 1000;

  const mine = held.bids.filter(
    (b) => b.bidderId === bidderId && b.auctionLotId === lot?.id && b.isValid,
  );
  const confirmedThisRound = mine.some((b) => Math.round(b.bidValue) === Math.round(clockPrice));
  /**
   * The round they most recently accepted — the latest, not the largest.
   *
   * Taking the largest looked equivalent and was not: on a buy-side clock the
   * largest price is the *first* round, so a bidder who had confirmed every
   * round was compared against round one and told they were eliminated.
   */
  const lastHeld = mine.length === 0
    ? null
    : mine.reduce((a, b) => (b.sequenceNumber > a.sequenceNumber ? b : a)).bidValue;
  const previousPrice = round === 1 ? null : japaneseClockPrice(held.auction, lot?.startingPrice ?? 0, round - 1);
  // Out: a round has passed and their last acceptance is not the one before it.
  const eliminated = round > 1 && previousPrice !== null
    && (lastHeld === null || Math.round(lastHeld) !== Math.round(previousPrice))
    && !confirmedThisRound;

  if (eliminated) {
    return (
      <PortalCard title="You are out of this auction">
        <div className="rfx-stack" style={{ gap: 12 }}>
          <div>
            <div style={label}>You exited at</div>
            <div style={{ ...bigNumber, color: color.textSecondary }}>
              {lastHeld === null ? 'no round accepted' : money(lastHeld, currency)}
            </div>
            <div style={{ fontSize: 13.5, color: color.textSecondary, marginTop: 6 }}>
              in round {Math.max(1, round - 1)}
            </div>
          </div>
          <ValidationBanner tone="info" title="You cannot rejoin">
            That is how this format works — leaving is final, for everyone. Your exit price is on the
            buyer's record and nothing further is expected from you. The result will be sent to you
            when the auction ends.
          </ValidationBanner>
        </div>
      </PortalCard>
    );
  }

  return (
    <PortalCard
      title={`Round ${round}`}
      hint="You are not bidding a price. You are deciding whether to stay in at the price the clock is showing."
    >
      <div className="rfx-stack" style={{ gap: 16 }}>
        <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 220px' }}>
            <div style={label}>The price this round</div>
            <div style={{ ...bigNumber, color: color.brandPrimary }}>{money(clockPrice, currency)}</div>
            <div style={{ fontSize: 13.5, color: color.textSecondary, marginTop: 6 }}>
              If you stay in and the round advances, the next price will be{' '}
              <strong>{money(nextPrice, currency)}</strong>.
            </div>
          </div>
          {!confirmedThisRound && (
            <Countdown closesAt={roundClosesAt} size={30} label="This round closes in" />
          )}
        </div>

        {!enabled && disabledReason ? (
          <Blocked reason={disabledReason} />
        ) : confirmedThisRound ? (
          <ValidationBanner tone="success" title={`You are in at ${money(clockPrice, currency)}`}>
            Confirmed for round {round}. Nothing more to do until the buyer advances the clock — we
            will tell you the moment they do.
          </ValidationBanner>
        ) : (
          <>
            <ValidationBanner tone="warning" title="If you do nothing, you are out">
              Not confirming before this round closes takes you out of the auction permanently. You
              cannot rejoin and you cannot be reinstated.
            </ValidationBanner>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Button variant="primary" style={PRIMARY_ACTION} onClick={() => place(clockPrice, true)}>
                Stay in at {money(clockPrice, currency)}
              </Button>
              <Button variant="secondary" onClick={() => setLeaveOpen(true)}>
                Leave the auction
              </Button>
            </div>
          </>
        )}
      </div>

      <Modal
        open={leaveOpen}
        title="Leave this auction?"
        confirmLabel="Yes, leave for good"
        onClose={() => setLeaveOpen(false)}
        onConfirm={() => setLeaveOpen(false)}
      >
        <p style={{ margin: 0 }}>
          Leaving is final. You will not be able to rejoin, and the last price you accepted
          {lastHeld === null ? ' — none so far — ' : ` (${money(lastHeld, currency)}) `}
          becomes your position on the buyer's record.
        </p>
      </Modal>
    </PortalCard>
  );
}

// ---------------------------------------------------------------------------
// Dutch — one button, and the cost of waiting
// ---------------------------------------------------------------------------

function AcceptClockControl({
  held, lot, lotDetail, currency, bidderId, place, enabled, disabledReason,
}: BidControlProps) {
  const [now, setNow] = React.useState(() => serverNow());
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  React.useEffect(() => {
    const timer = setInterval(() => setNow(serverNow()), 1000);
    return () => clearInterval(timer);
  }, []);

  const buy = held.auction.side === 'BUY';
  // The same two numbers the cockpit reads. A clock that ticked at a different
  // rate on the two screens would hand the lot to whoever's page was right.
  const tickSeconds = numberParam(held.auction, 'dutch.tickSeconds');
  const limitPct = numberParam(held.auction, 'dutch.limitPct');
  const opening = lot?.startingPrice ?? 0;
  const limit = buy
    ? lotDetail?.ceilingPrice ?? opening * (1 + limitPct / 100)
    : lotDetail?.floorPrice ?? opening * Math.max(0, 1 - limitPct / 100);
  const clock = dutchClock(held.auction, opening, limit, tickSeconds, now);
  const taken = held.bids.some((b) => b.auctionLotId === lot?.id && b.isValid);
  const mine = held.bids.some((b) => b.auctionLotId === lot?.id && b.isValid && b.bidderId === bidderId);

  if (taken) {
    return (
      <PortalCard title="This auction has ended">
        <ValidationBanner
          tone={mine ? 'success' : 'info'}
          title={mine ? 'You accepted first' : 'Someone accepted before you'}
        >
          {mine
            ? `You took the price at ${money(clock.price, currency)}. The buyer has it and will come back to you with next steps.`
            : 'The first acceptance ends the auction for everyone. Nothing further is taken on this lot.'}
        </ValidationBanner>
      </PortalCard>
    );
  }

  return (
    <PortalCard
      title="The price is moving"
      hint="There is nothing to type. One button, and the first company to press it wins."
    >
      <div className="rfx-stack" style={{ gap: 16 }}>
        <div>
          <div style={label}>Right now</div>
          <div style={{ ...bigNumber, fontSize: 46, color: color.brandPrimary }}>
            {money(clock.price, currency)}
          </div>
          <div style={{ fontSize: 13.5, color: color.textSecondary, marginTop: 8, lineHeight: 1.6 }}>
            It moves every {tickSeconds} seconds and gets {buy ? 'worse for you' : 'better for you'} each time.
            Waiting {buy ? 'costs you money' : 'gets you a better price'} and risks losing the lot
            entirely to somebody who presses first.
          </div>
        </div>

        {clock.atLimit && (
          <ValidationBanner tone="warning" title="The clock has stopped moving">
            It has reached the buyer's limit of {money(limit, currency)}. It will not move again — if
            you want this lot, now is the moment.
          </ValidationBanner>
        )}

        {!enabled && disabledReason ? (
          <Blocked reason={disabledReason} />
        ) : (
          <Button variant="primary" style={PRIMARY_ACTION} onClick={() => setConfirmOpen(true)}>
            Accept at {money(clock.price, currency)}
          </Button>
        )}
      </div>

      <Modal
        open={confirmOpen}
        title="Accept this price?"
        confirmLabel={`Accept ${money(clock.price, currency)}`}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => { place(clock.price, true); setConfirmOpen(false); }}
      >
        <p style={{ margin: 0 }}>
          This ends the auction immediately and commits you at{' '}
          <strong>{money(clock.price, currency)}</strong>. There is no withdrawing it and no second
          round.
        </p>
      </Modal>
    </PortalCard>
  );
}

// ---------------------------------------------------------------------------
// Sealed — one submission, then a wait
// ---------------------------------------------------------------------------

function OneShotControl({
  held, lot, currency, bidderId, place, enabled, disabledReason,
}: BidControlProps) {
  const [value, setValue] = React.useState('');
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const mine = held.bids.find(
    (b) => b.bidderId === bidderId && b.auctionLotId === lot?.id && b.isValid,
  );
  const vickrey = held.auction.mechanism === 'VICKREY';

  if (mine) {
    return (
      <PortalCard title="Your submission is in">
        <div className="rfx-stack" style={{ gap: 12 }}>
          <div>
            <div style={label}>You submitted</div>
            <div style={bigNumber}>{money(mine.bidValue, currency)}</div>
            <div style={{ fontSize: 12.5, color: color.textSecondary, marginTop: 6 }}>
              Received {new Date(mine.submittedAt).toLocaleString()} — this is our clock, and it is
              the one that counts.
            </div>
          </div>
          <ValidationBanner tone="info" title="Nothing happens now until the reveal">
            You cannot change it and you cannot submit again. Nobody — including the buyer — can read
            any submission until every envelope is opened together at{' '}
            {held.auction.endsAt ? new Date(held.auction.endsAt).toLocaleString() : 'the reveal time'}.
          </ValidationBanner>
        </div>
      </PortalCard>
    );
  }

  return (
    <PortalCard
      title="Your one submission"
      hint="One price, once. You will not see anyone else and nobody will see you until the reveal."
    >
      <div className="rfx-stack" style={{ gap: 14 }}>
        {vickrey && (
          <ValidationBanner tone="warning" title="The winner pays the second-best price">
            If yours is the best bid you win, but the price you are awarded is the next-best bid, not
            yours. Bid the most you are genuinely willing to accept — bidding above that is what
            costs you here, not bidding close to it.
          </ValidationBanner>
        )}
        <Field label="Your price" hint="You cannot revise this. Check it before you send it.">
          <NumberInput
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={String(lot?.startingPrice ?? '')}
            style={{ fontSize: 22, padding: '12px 14px' }}
          />
        </Field>
        {!enabled && disabledReason ? (
          <Blocked reason={disabledReason} />
        ) : (
          <Button
            variant="primary"
            style={PRIMARY_ACTION}
            disabled={value.trim() === '' || Number(value) <= 0}
            onClick={() => setConfirmOpen(true)}
          >
            Submit {value ? money(Number(value), currency) : 'your price'}
          </Button>
        )}
      </div>

      <Modal
        open={confirmOpen}
        title="Send this submission?"
        confirmLabel="Send it"
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => { place(Number(value), true); setConfirmOpen(false); }}
      >
        <p style={{ margin: 0 }}>
          You are submitting <strong>{value ? money(Number(value), currency) : ''}</strong>. There is
          one submission per company and no way to change it afterwards.
        </p>
      </Modal>
    </PortalCard>
  );
}

// ---------------------------------------------------------------------------
// Rank compression — only on your turn
// ---------------------------------------------------------------------------

function TurnControl({
  held, view, lot, currency, bidderId, place, enabled, disabledReason,
}: BidControlProps) {
  const [value, setValue] = React.useState('');
  const handovers = held.controlEvents.filter(
    (e) => e.kind === 'TURN_CALLED' || e.kind === 'TURN_SKIPPED',
  );
  // Order is worst-position-first, which the buyer's cockpit computes the same way.
  const order = held.bidders.map((b) => b.id);
  const activeId = order[handovers.length % Math.max(1, order.length)] ?? null;
  const mine = activeId === bidderId;
  const turnEndsAt = (handovers[0]?.at ?? serverNow())
    + numberParam(held.auction, 'turn.turnSeconds') * 1000;

  if (!mine) {
    const position = order.indexOf(bidderId);
    const active = order.indexOf(activeId ?? '');
    const away = position < 0 ? null : (position - active + order.length) % order.length;
    return (
      <PortalCard title="Waiting for your turn">
        <div className="rfx-stack" style={{ gap: 12 }}>
          <div>
            <div style={label}>Turns before yours</div>
            <div style={bigNumber}>{away ?? '—'}</div>
          </div>
          <div style={{ fontSize: 14, color: color.textSecondary, lineHeight: 1.6 }}>
            The bid box is closed until it is your turn. We will tell you loudly — on screen and by
            sound if you allow it — the moment it opens, so you do not have to watch this page.
          </div>
          <ValidationBanner tone="info" title="Your price stands while you wait">
            Nothing happens to your position between turns. If you pass when your turn comes you stay
            in the auction at the price you already gave.
          </ValidationBanner>
        </div>
      </PortalCard>
    );
  }

  return (
    <PortalCard title="It is your turn" hint="Improve your price, or pass. Both keep you in.">
      <div className="rfx-stack" style={{ gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <Countdown closesAt={turnEndsAt} size={30} label="Your turn ends in" />
          {view.bidToBeat !== null && (
            <div>
              <div style={label}>To take the lead</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{money(view.bidToBeat, currency)}</div>
            </div>
          )}
        </div>
        <Field label="Your new price">
          <NumberInput
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={String(view.myBestBid ?? lot?.startingPrice ?? '')}
            style={{ fontSize: 22, padding: '12px 14px' }}
          />
        </Field>
        {!enabled && disabledReason ? (
          <Blocked reason={disabledReason} />
        ) : (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Button
              variant="primary"
              style={PRIMARY_ACTION}
              disabled={value.trim() === ''}
              onClick={() => place(Number(value))}
            >
              Place {value ? money(Number(value), currency) : 'bid'}
            </Button>
            <Button variant="secondary" onClick={() => setValue('')}>Pass this turn</Button>
          </div>
        )}
      </div>
    </PortalCard>
  );
}

// ---------------------------------------------------------------------------
// Multi-attribute — the trade-off, shown while they type
// ---------------------------------------------------------------------------

function MultiFieldControl({
  held, view, lot, place, enabled, disabledReason,
}: BidControlProps) {
  const [values, setValues] = React.useState<Record<string, number>>({
    price: view.myBestBid ?? lot?.startingPrice ?? 0,
    leadTime: 14,
    warranty: 24,
    paymentDays: 45,
  });
  const published = boolParam(held.auction, 'multiAttribute.publishWeights');
  const score = compositeScore(values, MULTI_ATTRIBUTE_SCHEME);

  return (
    <PortalCard
      title="Your offer"
      hint="Price is one part of four. The weights are published — improving lead time really can beat cutting price."
    >
      <div className="rfx-stack" style={{ gap: 14 }}>
        <div
          style={{
            display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap',
            background: color.brandPrimarySoft, borderRadius: radius.card, padding: '14px 16px',
          }}
        >
          <div>
            <div style={label}>Your score as it stands</div>
            <div style={{ ...bigNumber, color: color.brandPrimary }}>{score.total.toFixed(1)}</div>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {score.contributions.map((c) => (
              <div key={c.key}>
                <div style={{ fontSize: 11, color: color.textSecondary }}>
                  {c.label} · {c.weight.toFixed(0)}%
                </div>
                <div style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  +{c.contribution.toFixed(1)}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(190px, 100%), 1fr))', gap: 12,
          }}
        >
          {MULTI_ATTRIBUTE_SCHEME.map((attribute) => (
            <Field
              key={attribute.key}
              label={`${attribute.label} (${attribute.unit})`}
              // The weight is shown only where the buyer published it. A
              // bidder who cannot see the trade-off optimises the wrong thing,
              // which is the buyer's loss — but it is the buyer's call.
              hint={published
                ? `${attribute.betterIs === 'LOWER' ? 'Lower' : 'Higher'} scores better · worth ${attribute.weight}%`
                : `${attribute.betterIs === 'LOWER' ? 'Lower' : 'Higher'} scores better · the weighting is not published`}
            >
              <NumberInput
                value={values[attribute.key]}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [attribute.key]: Number(e.target.value) }))}
              />
            </Field>
          ))}
        </div>

        {!enabled && disabledReason ? (
          <Blocked reason={disabledReason} />
        ) : (
          <Button variant="primary" style={PRIMARY_ACTION} onClick={() => place(values.price)}>
            Submit this offer
          </Button>
        )}
      </div>
    </PortalCard>
  );
}

// ---------------------------------------------------------------------------
// English and its relatives — a price, whenever you like
// ---------------------------------------------------------------------------

function FreeFormControl({
  held, view, lot, currency, place, enabled, disabledReason,
}: BidControlProps) {
  const [value, setValue] = React.useState('');
  const indexed = held.auction.mechanism === 'INDEX_LINKED';
  const side = held.auction.side;
  const current = view.myBestBid ?? lot?.startingPrice ?? 0;
  const steps = [0.5, 1, 2.5];

  return (
    <PortalCard
      title={indexed ? 'Your premium to the index' : 'Place a bid'}
      hint={
        indexed
          ? `Quote a percentage above or below ${SEED_INDEX.name}. We show you the money it comes to.`
          : `Each bid must ${improvementLabel(side)} the leading position.`
      }
    >
      <div className="rfx-stack" style={{ gap: 14 }}>
        {view.bidToBeat !== null && (
          <div
            style={{
              background: color.brandPrimarySoft, borderRadius: radius.card, padding: '14px 16px',
              display: 'flex', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap',
            }}
          >
            <div>
              <div style={label}>To take the lead, bid</div>
              <div style={{ ...bigNumber, fontSize: 26, color: color.brandPrimary }}>
                {money(view.bidToBeat, currency)} or better
              </div>
            </div>
            {view.requiredImprovement !== null && view.requiredImprovement > 0 && (
              <div style={{ textAlign: 'right' }}>
                <div style={label}>That is a move of</div>
                <div style={{ fontSize: 18, fontWeight: 600 }}>
                  {money(view.requiredImprovement, currency)}
                </div>
              </div>
            )}
          </div>
        )}

        {indexed && (
          <div style={{ fontSize: 13, color: color.textSecondary, lineHeight: 1.6 }}>
            {SEED_INDEX.name} stands at <strong>{money(SEED_INDEX.value, currency)}</strong>{' '}
            ({SEED_INDEX.source}, {new Date(SEED_INDEX.asOf).toLocaleDateString()}).
            {value !== '' && (
              <>
                {' '}A {Number(value) >= 0 ? 'premium' : 'discount'} of {value}% is{' '}
                <strong>{money(indexedPrice(SEED_INDEX, Number(value)), currency)}</strong>.
              </>
            )}
          </div>
        )}

        <Field label={indexed ? 'Premium or discount (%)' : 'Your bid'}>
          <NumberInput
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={indexed ? '0.0' : String(current)}
            style={{ fontSize: 22, padding: '12px 14px' }}
          />
        </Field>

        {!indexed && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {steps.map((step) => {
              const stepped = side === 'BUY'
                ? Math.round(current * (1 - step / 100))
                : Math.round(current * (1 + step / 100));
              return (
                <Button key={step} variant="secondary" onClick={() => setValue(String(stepped))}>
                  {side === 'BUY' ? '−' : '+'}{step}% · {money(stepped, currency)}
                </Button>
              );
            })}
          </div>
        )}

        {!enabled && disabledReason ? (
          <Blocked reason={disabledReason} />
        ) : (
          <Button
            variant="primary"
            style={PRIMARY_ACTION}
            disabled={value.trim() === ''}
            onClick={() =>
              place(indexed ? indexedPrice(SEED_INDEX, Number(value)) : Number(value))}
          >
            Place bid
          </Button>
        )}
      </div>
    </PortalCard>
  );
}

/** A one-line reminder of the format, for the top of the console. */
export function MechanismCaption({ held }: { held: AuctionState }) {
  const profile = MECHANISM_PROFILE[held.auction.mechanism];
  switch (profile.bidEntry) {
    case 'STAY_IN': return <>Each round, confirm you are staying in — or you are out for good.</>;
    case 'ACCEPT_CLOCK': return <>The price moves on its own. The first company to accept it wins.</>;
    case 'ONE_SHOT': return <>One price, submitted once. Nothing is revealed until the reveal time.</>;
    case 'TURN_BASED': return <>You bid in turn. The box opens when it is your turn and closes after it.</>;
    case 'MULTI_FIELD': return <>Improve price and the other terms together — the score decides.</>;
    default: return <>Bid whenever you like. Each bid must beat the current leading position.</>;
  }
}

/** Chips naming what the format does to you, for the banner. */
export function MechanismFacts({ held }: { held: AuctionState }) {
  const profile = MECHANISM_PROFILE[held.auction.mechanism];
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {profile.elimination && <Chip tone="danger" icon="!">you can be knocked out</Chip>}
      {!profile.liveRanking && <Chip tone="neutral">no positions shown</Chip>}
      {profile.rounds === 'SINGLE' && <Chip tone="gold">one submission only</Chip>}
      {profile.clockOwner === 'SYSTEM' && <Chip tone="info">the price moves on a clock</Chip>}
    </div>
  );
}
