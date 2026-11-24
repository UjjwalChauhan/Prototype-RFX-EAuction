/**
 * Everything the buyer has asked this supplier for.
 *
 * Organised the way a supplier thinks rather than the way the buyer's journey
 * runs: by the kind of ask (information, proposal, quotation, auction), and
 * inside each, by whether it is still waiting on them. Two piles, never more —
 * *do I owe you something* is the only question a supplier opens this page to
 * answer, and every extra tab is one more place for an unanswered RFQ to hide.
 *
 * Language throughout is the supplier's. No stage names, no envelope modes, no
 * event numbers where a title will do.
 */
import React from 'react';
import { color, radius } from '../design-system/tokens';
import { Button, Chip } from '../design-system/components/primitives';
import { lineItemsForEvent, lotsForEvent, termsForEvent, useStore } from '../store/store';
import { ACKNOWLEDGEMENT_LABEL, paymentSummary } from '../domain/terms';
import { serverNow } from '../server/clock';
import { rehearsalOpen } from '../domain/auctionRehearsal';
import {
  REQUEST_LABELS, REQUEST_PURPOSE, askableQuestions, draftFromResponse,
  missingRequired, questionnairesForBidder, submissionFor, supplierGroups, timeRemaining,
  toAnswers, vendorSections,
  type AnswerDraft, type VendorItem, type VendorSection,
} from '../domain/vendorPortal';
import { PortalPanel, SupplierQuestionnaire } from './SupplierForm';
import type { Answer, Response, VendorInputPoint } from '../domain/types';

export function PortalRequests({
  counterpartyId, points, heading, blurb, onEnterAuction,
}: {
  counterpartyId: string;
  /** Which asks this screen covers — the three written ones, or the auction. */
  points: VendorInputPoint[];
  heading: string;
  blurb: string;
  /**
   * Take the supplier into the auction room.
   *
   * An auction is the one ask with nothing to fill in: there are no questions,
   * there is a clock and a price. Opening it as a form would show a supplier an
   * empty questionnaire for the event they are supposed to be bidding in.
   */
  onEnterAuction?: (eventId: string) => void;
}) {
  const { state } = useStore();
  const [point, setPoint] = React.useState<VendorInputPoint | null>(null);
  const [pile, setPile] = React.useState<'active' | 'past'>('active');
  const [openId, setOpenId] = React.useState<string | null>(null);

  // Re-read the clock on a timer so a deadline passing moves an item without
  // the supplier having to reload the page.
  const [now, setNow] = React.useState(() => serverNow());
  React.useEffect(() => {
    const timer = setInterval(() => setNow(serverNow()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const sections = vendorSections({
    events: state.events, bidders: state.bidders, responses: state.responses,
    counterpartyId, now,
  });

  /**
   * The asks this screen covers.
   *
   * The three named ones always show, so their tabs do not appear and vanish
   * as work arrives. Any other written ask the supplier actually has — a quote
   * request raised at intake, a negotiation round — is added rather than
   * dropped, because an invitation with nowhere to appear is an invitation the
   * supplier never sees.
   */
  const isAuctionScreen = points.includes('AUCTION');
  const visible = sections.filter(
    (s) =>
      points.includes(s.point)
      || (!isAuctionScreen
          && s.point !== 'AUCTION'
          && s.active.length + s.past.length > 0),
  );

  // Open on an ask that has something in it rather than on a fixed first tab —
  // otherwise a supplier with one RFQ waiting lands on an empty RFI and
  // concludes nothing was sent.
  const firstWithWork =
    visible.find((s) => s.active.length > 0)
    ?? visible.find((s) => s.past.length > 0)
    ?? visible[0];
  const chosen = point ?? firstWithWork?.point;
  const section = visible.find((s) => s.point === chosen) ?? firstWithWork;

  if (!section) return null;

  const open = visible
    .flatMap((s) => [...s.active, ...s.past])
    .find((i) => `${i.bidder.id}-${i.point}` === openId);
  if (open) {
    return <RequestDetail item={open} now={now} onBack={() => setOpenId(null)} />;
  }

  const items = pile === 'active' ? section.active : section.past;

  return (
    <div className="rfx-stack" style={{ gap: 18 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>{heading}</h1>
        <p style={{ margin: '6px 0 0', fontSize: 14.5, color: color.textSecondary }}>{blurb}</p>
      </div>

      {visible.length > 1 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {visible.map((s) => (
            <button
              key={s.point}
              onClick={() => { setPoint(s.point); setPile('active'); }}
              style={{
                border: `1px solid ${s.point === section.point ? color.brandPrimary : color.border}`,
                background: s.point === section.point ? color.brandPrimarySoft : '#fff',
                color: s.point === section.point ? color.brandPrimary : color.textBody,
                borderRadius: radius.card, padding: '10px 15px', cursor: 'pointer',
                fontSize: 14, fontWeight: s.point === section.point ? 600 : 400, textAlign: 'left',
              }}
            >
              <span style={{ display: 'block' }}>{s.point}</span>
              <span style={{ display: 'block', fontSize: 11.5, color: color.textSecondary, marginTop: 2 }}>
                {s.active.length} waiting on you
              </span>
            </button>
          ))}
        </div>
      )}

      <div
        style={{
          background: '#fff', border: `1px solid ${color.border}`,
          borderRadius: radius.card, overflow: 'hidden',
        }}
      >
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${color.border}` }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{REQUEST_LABELS[section.point]}</div>
          <div style={{ fontSize: 13, color: color.textSecondary, marginTop: 3 }}>
            {REQUEST_PURPOSE[section.point]}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 4, padding: '10px 14px', borderBottom: `1px solid ${color.border}` }}>
          {(['active', 'past'] as const).map((which) => (
            <button
              key={which}
              onClick={() => setPile(which)}
              style={{
                border: 'none', cursor: 'pointer', borderRadius: radius.control,
                padding: '7px 14px', fontSize: 13.5,
                fontWeight: pile === which ? 600 : 400,
                background: pile === which ? color.brandPrimarySoft : 'transparent',
                color: pile === which ? color.brandPrimary : color.textSecondary,
              }}
            >
              {which === 'active' ? 'Active' : 'Past'}
              {' '}
              ({which === 'active' ? section.active.length : section.past.length})
            </button>
          ))}
        </div>

        {items.length === 0 ? (
          <div style={{ padding: '28px 18px', fontSize: 14, color: color.textSecondary }}>
            {pile === 'active'
              ? `Nothing is waiting on you here. Anything new the buyer sends will appear in this list.`
              : `Nothing here yet — this is where an ask goes once you have answered it or it has closed.`}
          </div>
        ) : (
          items.map((item) => (
            <RequestRow
              key={`${item.bidder.id}-${item.point}`}
              item={item}
              now={now}
              // Only where there is a room to enter. An auction that has been
              // announced but not yet built opens as any other ask does.
              enterAuction={
                item.point === 'AUCTION'
                && onEnterAuction !== undefined
                && state.auctions[item.event.id] !== undefined
                  ? () => onEnterAuction(item.event.id)
                  : undefined
              }
              // A practice run is open on this one. Said on the row, because
              // a supplier who has never bid in this format is exactly the
              // one who will not go looking for it.
              practising={
                state.auctions[item.event.id] !== undefined
                && rehearsalOpen(state.auctions[item.event.id].controlEvents)
              }
              auctionNumber={state.auctions[item.event.id]?.auction.auctionNumber}
              onOpen={() => setOpenId(`${item.bidder.id}-${item.point}`)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function RequestRow({
  item, now, onOpen, enterAuction, practising = false, auctionNumber,
}: {
  item: VendorItem; now: number; onOpen: () => void; enterAuction?: () => void;
  /** The buyer has the practice run open on this auction. */
  practising?: boolean;
  /** The auction's own reference, where this row is an auction. */
  auctionNumber?: string;
}) {
  const urgent = item.active
    && item.closesAt !== null
    && item.closesAt - now < 24 * 3_600_000;

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
        padding: '16px 18px', borderTop: `1px solid ${color.border}`,
      }}
    >
      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 15.5, fontWeight: 600 }}>{item.event.title}</span>
          {item.bidder.isProvisional && (
            <Chip tone="gold" title="You can bid; onboarding must finish before an award">
              onboarding
            </Chip>
          )}
        </div>
        <div style={{ fontSize: 13, color: color.textSecondary, marginTop: 3 }}>
          {/* An auction is referred to by its own number, not by the ask that
              raised it — a supplier quoting the ask's reference for an
              auction query sends the buyer looking in the wrong place. */}
          {auctionNumber ?? item.event.eventNumber} · {item.event.category}
        </div>
        <div style={{ fontSize: 13, color: item.active ? color.textBody : color.textMuted, marginTop: 4 }}>
          {item.standing}
        </div>
      </div>

      <div style={{ textAlign: 'right', minWidth: 130 }}>
        <div
          style={{
            fontSize: 14, fontWeight: 600,
            color: urgent ? color.dangerText : item.active ? color.textPrimary : color.textMuted,
          }}
        >
          {item.active ? timeRemaining(item.closesAt, now) : ''}
        </div>
        {item.active && item.closesAt !== null && (
          <div style={{ fontSize: 12, color: color.textSecondary, marginTop: 2 }}>
            closes {new Date(item.closesAt).toLocaleDateString()}
          </div>
        )}
      </div>

      {enterAuction !== undefined ? (
        <Button variant={item.active || practising ? 'primary' : 'secondary'} onClick={enterAuction}>
          {practising ? 'Try it before it starts' : item.active ? 'Enter the auction room' : 'View the room'}
        </Button>
      ) : (
        <Button variant={item.active ? 'primary' : 'secondary'} onClick={onOpen}>
          {item.active ? 'Open and respond' : 'View'}
        </Button>
      )}
    </div>
  );
}

/**
 * One ask, opened.
 *
 * Deliberately shows the supplier only what they were sent — the questions,
 * what is being bought, and when it is due. Nothing about the buyer's
 * evaluation model, the other bidders, or the internal approval chain reaches
 * this screen, because none of it is theirs to see.
 */
/** Exported for the portal tests, which open an ask without a click. */
export function RequestDetail({
  item, now, onBack,
}: { item: VendorItem; now: number; onBack: () => void }) {
  const { state, dispatch } = useStore();
  /**
   * Every questionnaire this ask puts in front of *this* supplier.
   *
   * One ask can carry several: a consolidated event buys in more than one
   * category and asks each market its own questions. A supplier shortlisted
   * for part of the basket is asked only for their part — being handed the
   * pallet questionnaire because somebody else's lines are in the same event
   * is how a supplier concludes the buyer does not know what they sell.
   */
  const questionnaires = React.useMemo(
    () => questionnairesForBidder(
      state.questionnaires, item.event.id, item.point, item.bidder.categories,
    ),
    [state.questionnaires, item.event.id, item.point, item.bidder.categories],
  );
  // An ask answers against the basket of the sourcing event that raised it,
  // so this resolves through the family rather than matching on event id.
  const lots = lotsForEvent(state, item.event.id);
  /**
   * The basket, for the questions that are asked per line. Resolved through
   * the family for the same reason the lots are: an ask answers against the
   * sourcing event that raised it, not against itself.
   */
  const lines = lineItemsForEvent(state, item.event.id);
  const terms = termsForEvent(state, item.event.id);
  // Grouped for display, flat for validation and submission — an answer belongs
  // to a question, and which questionnaire carried it changes nothing about it.
  const groups = React.useMemo(
    () => questionnaires
      .map((q) => ({
        questionnaire: q,
        // Narrowed to this supplier: a question the buyer tagged to three of
        // six suppliers is not on the other three's form, and must not be
        // counted against them as unanswered either.
        questions: askableQuestions(q.questions, item.bidder.counterpartyId),
        sectionGroups: supplierGroups(
          q.questions, q.sections ?? [], lines, item.bidder.counterpartyId,
        ),
      }))
      .filter((group) => group.questions.length > 0),
    [questionnaires, lines, item.bidder.counterpartyId],
  );
  const questions = React.useMemo(() => groups.flatMap((g) => g.questions), [groups]);
  /**
   * Every box to fill in — one per vendor-level question, and one per line for
   * the questions asked per line. Validation and submission both work off
   * this rather than off the question list, so a lead time given for three of
   * six items is an incomplete submission here and not a gap the buyer finds
   * at comparison.
   */
  const cells = React.useMemo(
    () => groups.flatMap((group) => group.sectionGroups.flatMap((g) => g.cells)),
    [groups],
  );

  const submission = submissionFor(state.responses, item.event.id, item.bidder.id);

  /**
   * The working answers. Seeded from the last submission so a resubmission
   * starts from what was already sent rather than from an empty form.
   */
  const [draft, setDraft] = React.useState<AnswerDraft>(() => draftFromResponse(submission));
  const [showMissing, setShowMissing] = React.useState(false);

  const setAnswer = (key: string, value: Answer['value']) =>
    setDraft((d) => ({
      ...d,
      [key]: { value, attachmentName: d[key]?.attachmentName ?? null },
    }));

  const setAttachment = (key: string, attachmentName: string | null) =>
    setDraft((d) => ({
      ...d,
      [key]: { value: d[key]?.value ?? null, attachmentName },
    }));

  // Opening an ask is itself information the buyer should have.
  React.useEffect(() => {
    if (item.active && item.bidder.participationStatus === 'NOT_STARTED') {
      dispatch({ type: 'SET_PARTICIPATION', bidderId: item.bidder.id, status: 'IN_PROGRESS' });
    }
  }, [item.active, item.bidder.id, item.bidder.participationStatus, dispatch]);

  const missing = missingRequired(cells, draft);

  const submit = () => {
    // A required question left blank stops the submission and is pointed at,
    // rather than being accepted and rejected by the buyer days later.
    if (missing.length > 0) {
      setShowMissing(true);
      return;
    }
    const existing = state.responses.filter(
      (r) => r.eventId === item.event.id && r.bidderId === item.bidder.id,
    );
    const response: Response = {
      id: `resp-${item.event.id}-${item.bidder.id}`,
      eventId: item.event.id,
      bidderId: item.bidder.id,
      version: existing.length + 1,
      submittedAt: serverNow(),
      answers: toAnswers(cells, draft),
      priceLines: [],
    };
    dispatch({ type: 'SUBMIT_RESPONSE', response });
    onBack();
  };

  return (
    <div className="rfx-stack" style={{ gap: 18 }}>
      <div>
        <Button variant="tertiary" onClick={onBack}>‹ Back to {item.point}</Button>
      </div>

      <div>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>{item.event.title}</h1>
        <p style={{ margin: '6px 0 0', fontSize: 14.5, color: color.textSecondary }}>
          {REQUEST_LABELS[item.point]} · {item.event.eventNumber} · {item.event.category}
        </p>
      </div>

      <div
        style={{
          background: item.active ? color.brandPrimarySoft : color.neutralSoft,
          border: `1px solid ${item.active ? color.brandPrimary : color.border}`,
          borderRadius: radius.card, padding: '14px 18px', fontSize: 14,
        }}
      >
        <strong>{item.standing}</strong>
        {item.active && (
          <span style={{ marginLeft: 8, color: color.textSecondary }}>
            {timeRemaining(item.closesAt, now)}
          </span>
        )}
      </div>

      {item.event.description && (
        <PortalPanel title="What this is about">
          <div style={{ fontSize: 14.5, lineHeight: 1.65 }}>{item.event.description}</div>
        </PortalPanel>
      )}

      {questions.length === 0 ? (
        <PortalPanel title="What we are asking">
          <div style={{ fontSize: 14, color: color.textSecondary }}>
            No question set was attached to this ask. The buyer will be in touch with what they need.
          </div>
        </PortalPanel>
      ) : (
        groups.map((group) => {
          // The numbering runs across the whole submission rather than
          // restarting per section: the supplier is answering one form, and
          // "question 1" appearing three times is how an answer goes to the
          // wrong place when they discuss it on the phone.
          const offset = groups
            .slice(0, groups.indexOf(group))
            .reduce((sum, earlier) => sum + earlier.questions.length, 0);
          return (
            <PortalPanel
              key={group.questionnaire.id}
              title={
                groups.length === 1
                  ? `What we are asking (${group.questions.length})`
                  : `${group.questionnaire.category ?? 'This ask'} — what we are asking (${group.questions.length})`
              }
            >
              {groups.length > 1 && (
                <div style={{ fontSize: 13, color: color.textSecondary, marginBottom: 14, lineHeight: 1.6 }}>
                  This event buys in more than one category. These questions cover the
                  <strong> {group.questionnaire.category}</strong> lines you were shortlisted for.
                </div>
              )}
              <SupplierQuestionnaire
                groups={group.sectionGroups}
                draft={draft}
                readOnly={!item.active}
                missingKeys={showMissing ? missing.map((m) => m.key) : []}
                startIndex={offset}
                onValue={setAnswer}
                onAttachment={setAttachment}
              />
            </PortalPanel>
          );
        })
      )}

      {/*
        The terms this ask is sent under. A supplier is entitled to see what
        they are being asked to accept before they price anything, and payment
        terms in particular change the number they quote.
      */}
      {terms.length > 0 && (
        <PortalPanel title={`Terms you are asked to work under (${terms.length})`}>
          <div className="rfx-stack" style={{ gap: 12 }}>
            {terms.map((document) => (
              <div key={document.id}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 14 }}>{document.title}</strong>
                  <Chip tone="neutral">v{document.version}</Chip>
                  <span style={{ fontSize: 12.5, color: color.textSecondary }}>
                    {ACKNOWLEDGEMENT_LABEL[document.acknowledgement]}
                  </span>
                </div>
                {document.payment && (
                  <div style={{ fontSize: 13, marginTop: 4 }}>
                    {paymentSummary(document.payment)}
                  </div>
                )}
                {document.attachmentName && (
                  <div style={{ fontSize: 12.5, color: color.textSecondary, marginTop: 4 }}>
                    📎 {document.attachmentName}
                  </div>
                )}
                {document.clauses.length > 0 && (
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 13, lineHeight: 1.65 }}>
                    {document.clauses.map((clause) => (
                      <li key={clause.id}>
                        <strong>{clause.code}</strong> {clause.title}
                        {clause.nonNegotiable && (
                          <span style={{ color: color.dangerText }}> · not open to change</span>
                        )}
                        <div style={{ color: color.textSecondary }}>{clause.text}</div>
                      </li>
                    ))}
                  </ul>
                )}
                {!document.allowDeviation && (
                  <div style={{ fontSize: 12, color: color.textSecondary, marginTop: 4 }}>
                    These are accepted as written; a deviation cannot be proposed against them.
                  </div>
                )}
              </div>
            ))}
          </div>
        </PortalPanel>
      )}

      {lots.length > 0 && (
        <PortalPanel title={`What is being bought (${lots.length} ${lots.length === 1 ? 'lot' : 'lots'})`}>
          <div className="rfx-stack" style={{ gap: 12 }}>
            {lots.map((lot) => {
              // The buyer's own lines, as they were published. A supplier asked
              // to price a lot has to be able to see what is in it.
              const lotLines = state.lineItems.filter((l) => l.lotId === lot.id);
              return (
                <div key={lot.id}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <Chip tone="neutral">{lot.name}</Chip>
                    <span style={{ fontSize: 12.5, color: color.textSecondary }}>
                      {lotLines.length === 0
                        ? 'no lines listed'
                        : `${lotLines.length} ${lotLines.length === 1 ? 'line' : 'lines'}`}
                      {lot.awardMode === 'SPLIT' && ' · may be split between suppliers'}
                    </span>
                  </div>
                  {lotLines.length > 0 && (
                    <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 13, lineHeight: 1.65 }}>
                      {lotLines.map((line) => (
                        <li key={line.id}>
                          {line.description}
                          <span style={{ color: color.textSecondary }}>
                            {' '}— {line.quantity.toLocaleString()} {line.uom}
                            {line.deliveryLocation ? ` · ${line.deliveryLocation}` : ''}
                          </span>
                          {line.specification && (
                            <div style={{ fontSize: 12, color: color.textSecondary }}>
                              {line.specification}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </PortalPanel>
      )}

      {item.active && (
        <div className="rfx-stack" style={{ gap: 10 }}>
          {showMissing && missing.length > 0 && (
            <div
              role="alert"
              style={{
                background: color.dangerSoft, border: '1px solid #FCA5A5',
                borderRadius: radius.control, padding: '11px 14px',
                fontSize: 13.5, color: color.dangerText,
              }}
            >
              <strong>
                {missing.length} required {missing.length === 1 ? 'answer is' : 'answers are'} missing.
              </strong>{' '}
              {/* Named by line where the gap is on a line, so the supplier is
                  told which item is missing rather than which question. */}
              {missing
                .map((m) => (m.lineLabel === null ? m.question.title : `${m.question.title} — ${m.lineLabel}`))
                .join(' · ')}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <Button variant="primary" onClick={submit}>
              {submission ? 'Resubmit my response' : 'Submit my response'}
            </Button>
            <span style={{ fontSize: 13, color: color.textSecondary }}>
              You can resubmit until the deadline — the buyer sees the latest version.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * A question asked once per line.
 *
 * Rendered as one question with a row per item rather than as N questions,
 * because that is what it is: the supplier is being asked the same thing
 * about each line, and numbering it six times would make a six-line basket
 * look like a sixty-question form.
 *
 * The line is named by its code and description — the supplier's own
 * catalogue number is not in our system, so the buyer's reference is the only
 * thing both sides can point at.
 */

/** Counts for the shell's nav badges. */
export function activeCounts(
  sections: VendorSection[],
): { requests: number; auctions: number } {
  let requests = 0;
  let auctions = 0;
  for (const section of sections) {
    if (section.point === 'AUCTION') auctions += section.active.length;
    else requests += section.active.length;
  }
  return { requests, auctions };
}
