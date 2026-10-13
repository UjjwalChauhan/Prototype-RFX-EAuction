/**
 * The Questionnaire step of Create Event — that the template reaches the page.
 *
 * The domain tests prove the editing rules. These prove a buyer opening the
 * step actually sees the template's questions, their weights, and the reason a
 * question is not carrying one — first-paint facts, so server rendering is
 * enough.
 */
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StoreProvider } from '../../store/store';
import { INITIAL_DRAFT, QuestionnaireStep, type Draft } from '../CreateEventWizard';
import {
  instantiateTemplate, seedQuestionnaires, setDraftScored,
} from '../../domain/questionnaireTemplates';
import { TENANT_TEMPLATES } from '../../data/questionnaireTemplates';
import type { QuestionnaireTemplate, VendorInputPoint } from '../../domain/types';

const RFI = TENANT_TEMPLATES.find((t) => t.code === 'QT-RFI-QUALIFICATION') as QuestionnaireTemplate;

function paint(draft: Draft, points: VendorInputPoint[] = ['RFI']): string {
  return renderToString(
    <StoreProvider>
      <QuestionnaireStep
        draft={draft}
        patch={() => {}}
        points={points}
        category={draft.category}
      />
    </StoreProvider>,
  )
    // React splits interpolated text with comment markers, and escapes
    // ampersands inside attribute values. Neither is what a reader sees.
    .replace(/<!-- -->/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'");
}

/** A draft already seeded at the given points, as the step itself would seed it. */
function seededDraft(points: VendorInputPoint[]): Draft {
  return {
    ...INITIAL_DRAFT,
    questionnaires: seedQuestionnaires({
      existing: [], points, library: TENANT_TEMPLATES, category: null, idSeed: 'test',
    }),
  };
}

describe('the template populates the page', () => {
  it('renders every question the template defines', () => {
    const html = paint(seededDraft(['RFI']));
    for (const question of RFI.questions) {
      expect(html).toContain(question.title);
    }
  });

  it('renders the template sections', () => {
    const html = paint(seededDraft(['RFI']));
    for (const section of RFI.sections) {
      expect(html).toContain(section.name);
    }
  });

  it('seeds from the library even before any effect runs', () => {
    // The step computes its questionnaire during render, so the first paint is
    // already populated rather than briefly empty.
    const html = paint({ ...INITIAL_DRAFT, questionnaires: [] });
    expect(html).toContain(RFI.questions[0].title);
  });

  it('counts the questions and the scored subset', () => {
    const html = paint(seededDraft(['RFI']));
    expect(html).toContain(`${RFI.questions.length} questions`);
    expect(html).toContain('scored');
  });
});

describe('weight is shown, and optional', () => {
  it('shows a normalised share for a weighted question', () => {
    const html = paint(seededDraft(['RFI']));
    expect(html).toMatch(/\d+\.\d%/);
  });

  it('says a question is not weighted rather than showing a silent zero', () => {
    const draft = seededDraft(['RFI']);
    const questionnaire = draft.questionnaires[0];
    const html = paint({
      ...draft,
      questionnaires: [setDraftScored(questionnaire, questionnaire.questions[0].id, false)],
    });
    expect(html).toContain('Not weighted');
  });

  it('reports a questionnaire that scores nothing as gathering only', () => {
    let questionnaire = instantiateTemplate(RFI, 'RFI', 'test');
    for (const question of questionnaire.questions) {
      questionnaire = setDraftScored(questionnaire, question.id, false);
    }
    const html = paint({ ...INITIAL_DRAFT, questionnaires: [questionnaire] });
    expect(html).toContain('gathers information only');
  });
});

describe('RFI best practice reaches the buyer', () => {
  it('states what the point is for', () => {
    const html = paint(seededDraft(['RFI']));
    expect(html).toContain('before anyone is asked for a price');
  });

  it('surfaces a commercial question set at RFI', () => {
    const questionnaire = instantiateTemplate(RFI, 'RFI', 'test');
    const html = paint({
      ...INITIAL_DRAFT,
      questionnaires: [{
        ...questionnaire,
        questions: questionnaire.questions.map((q, i) =>
          i === 0 ? { ...q, envelope: 'COMMERCIAL' as const } : q,
        ),
      }],
    });
    expect(html).toContain('RFI qualifies the market');
  });

  it('offers a point selector only when the journey asks more than once', () => {
    expect(paint(seededDraft(['RFI']), ['RFI'])).not.toContain('Asked at');
    expect(paint(seededDraft(['RFI', 'RFP']), ['RFI', 'RFP'])).toContain('Asked at');
  });

  it('says the auction takes no questionnaire', () => {
    const html = paint({ ...INITIAL_DRAFT, questionnaires: [] }, []);
    expect(html).toContain('takes a live bid');
  });
});
