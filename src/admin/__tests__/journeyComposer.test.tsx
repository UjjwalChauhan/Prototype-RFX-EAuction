/**
 * The composer, painted.
 *
 * Two claims are being made on screen and both are checkable without a DOM:
 * that evaluation, clarifications and negotiation are no longer offered as
 * stages to sequence, and that the stages that remain are presented as an
 * order the buyer sets rather than one the system fixes.
 */
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StoreProvider } from '../../store/store';
import { ComposerDrawer } from '../JourneyPatternsPanel';
import { validateJourney, type JourneyDraft } from '../../domain/journeyComposer';

const BASE: JourneyDraft = {
  name: 'Bespoke tender',
  description: '',
  side: 'BUY',
  stages: ['INTAKE', 'RFQ', 'AUCTION', 'AWARD', 'APPROVAL'],
  vendorInputPoints: ['RFQ', 'AUCTION'],
  evaluateAt: ['RFQ'],
  negotiateAt: ['AUCTION'],
  clarifications: true,
};

function paint(draft: JourneyDraft = BASE): string {
  return renderToString(
    <StoreProvider>
      <ComposerDrawer
        open
        editing={false}
        scope="TENANT"
        draft={draft}
        basedOn=""
        validation={validateJourney(draft, [])}
        onBasedOn={() => {}}
        onDraft={() => {}}
        onClose={() => {}}
        onSave={() => {}}
      />
    </StoreProvider>,
  ).replace(/<!-- -->/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
}

describe('what the composer offers as a stage', () => {
  it('offers the seven stages that are genuinely sequential', () => {
    const html = paint();
    for (const label of ['Intake', 'RFI', 'RFP', 'RFQ', 'Auction', 'Award', 'Approval']) {
      expect(html, label).toContain(label);
    }
  });

  it('does not put the three activities in the sequence', () => {
    const html = paint({ ...BASE, stages: ['INTAKE', 'RFQ', 'AUCTION', 'AWARD', 'APPROVAL'] });
    const sequence = html.slice(html.indexOf('Put them in order'), html.indexOf('Supplier touchpoints'));
    expect(sequence).toContain('RFQ');
    expect(sequence).not.toContain('Evaluation');
    expect(sequence).not.toContain('Negotiation');
    expect(sequence).not.toContain('Clarifications');
  });

  it('hangs scoring off the solicitation whose responses it scores', () => {
    const html = paint();
    const inside = html.slice(html.indexOf('Runs inside RFQ'));
    expect(inside).toContain('Evaluation');
    expect(html).toContain('Score the responses that solicitation brought in');
  });

  it('offers a negotiation on the auction, and never on an RFI', () => {
    const html = paint();
    expect(html).toContain('Runs inside Auction');
    // RFI is not in this journey, so no host block for it is rendered at all;
    // the catalogue is what holds the rule, and it is checked in the domain.
    expect(html).toContain('counter-offer rounds against what was submitted here');
  });

  it('puts clarifications across the journey rather than at a stage', () => {
    const html = paint();
    expect(html).toContain('Runs across the whole journey');
    expect(html).toContain('Open at every stage the journey runs');
  });
});

describe('the sequence step', () => {
  it('numbers the stages in the order the draft holds them', () => {
    const html = paint({ ...BASE, stages: ['INTAKE', 'AUCTION', 'RFQ', 'AWARD', 'APPROVAL'] });
    const sequence = html.slice(html.indexOf('Put them in order'), html.indexOf('Supplier touchpoints'));
    expect(sequence.indexOf('Auction')).toBeLessThan(sequence.indexOf('RFQ'));
  });

  it('offers a keyboard path as well as a drag handle', () => {
    const html = paint();
    expect(html).toContain('Move RFQ earlier');
    expect(html).toContain('Move RFQ later');
    expect(html).toContain('draggable="true"');
  });

  it('marks the anchors as fixed rather than hiding them', () => {
    const html = paint();
    const sequence = html.slice(html.indexOf('Put them in order'), html.indexOf('Supplier touchpoints'));
    expect(sequence).toContain('Intake');
    expect(sequence).toContain('fixed');
  });

  it('says what the buyer is allowed to rearrange', () => {
    expect(paint()).toContain('everything between is yours to arrange');
  });
});

describe('what the composed journey produces', () => {
  it('shows the evaluation tab for a scored solicitation with no evaluation stage', () => {
    const html = paint();
    const produces = html.slice(html.indexOf('What this produces'));
    expect(produces).toContain('Evaluation');
    expect(produces).toContain('Negotiation');
  });

  it('names the activities rather than leaving them implied', () => {
    expect(paint()).toContain('Scored at RFQ');
    expect(paint()).toContain('Negotiated inside Auction');
    expect(paint()).toContain('Clarifications open throughout');
  });

  it('warns when responses arrive and nothing scores them', () => {
    const html = paint({ ...BASE, evaluateAt: [], negotiateAt: [] });
    expect(html).toContain('nothing scores them');
  });
});
