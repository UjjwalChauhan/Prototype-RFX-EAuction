/**
 * Uploading a questionnaire that was written in Excel.
 *
 * Almost no questionnaire starts life in a product. It starts in a sheet that
 * has been round the category team, the technical lead and whoever owns the
 * budget, and by the time anyone opens the sourcing tool it is thirty rows
 * long and settled. Retyping it is where the structure gets abandoned and the
 * sheet gets attached to the RFI as a document instead — same questions, no
 * comparability, nothing scoreable.
 *
 * The drawer is built around one rule: **say what will happen before it
 * happens.** The file is read, the result is shown in full — sections, their
 * weights, every question and anything that had to be adjusted — and only
 * then is there a button that changes the template. An import that silently
 * drops four rows of thirty is worse than one that refuses the file.
 */
import React from 'react';
import { color, radius } from '../design-system/tokens';
import { Button, Chip, Segmented } from '../design-system/components/primitives';
import { Card, Table, type Column } from '../design-system/components/layout';
import { Drawer, ValidationBanner } from '../design-system/components/domain';
import {
  IMPORT_COLUMNS, importCsv, importQuestionnaire, importWorkbook,
  type ImportIssue, type ImportMode, type QuestionnaireImport,
} from '../domain/questionnaireImport';
import {
  QUESTION_SCOPE_LABEL, errorsByQuestion, validateTemplate, type TemplateIssue,
} from '../domain/questionnaireTemplates';
import { typeLabel } from '../domain/questionTypes';
import { readSpreadsheet, type Sheet } from '../domain/spreadsheet';
import type { QuestionnaireTemplate, TemplateQuestion, TemplateSection } from '../domain/types';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Hand the browser a file.
 *
 * Guarded because the same component renders on the server for tests, where
 * there is no document to hang an anchor off and no URL to revoke.
 */
export function download(name: string, data: BlobPart, type: string): void {
  if (typeof document === 'undefined') return;
  const url = URL.createObjectURL(new Blob([data], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

const SEVERITY_TONE: Record<ImportIssue['severity'], { icon: string; fg: string }> = {
  error: { icon: '✕', fg: color.dangerText },
  warning: { icon: '●', fg: color.warningText },
  info: { icon: 'ⓘ', fg: color.infoText },
};

export function QuestionnaireImportDrawer({
  open, template, takenNames = [], onClose, onApply,
}: {
  open: boolean;
  /** What the import is read against — ids, existing codes, existing sections. */
  template: QuestionnaireTemplate;
  /**
   * The other template names at this scope. Passed so the drawer's "still to
   * fix" list is the same list the builder's Save button is reading, rather
   * than a near-miss that omits a name collision.
   */
  takenNames?: string[];
  onClose: () => void;
  onApply: (next: QuestionnaireTemplate) => void;
}) {
  const [sheets, setSheets] = React.useState<Sheet[] | null>(null);
  const [fileName, setFileName] = React.useState('');
  const [failure, setFailure] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [mode, setMode] = React.useState<ImportMode>('replace');
  const inputRef = React.useRef<HTMLInputElement>(null);

  const hasContent = template.questions.length > 0;

  /**
   * The import is derived, not stored. Switching between replacing and adding
   * re-reads the same file rather than asking for it again — and a file read
   * once can be looked at both ways before anything is committed.
   */
  const result: QuestionnaireImport | null = React.useMemo(
    () => (sheets === null ? null : importQuestionnaire(sheets, { template, mode, fileName })),
    [sheets, template, mode, fileName],
  );

  const reset = () => {
    setSheets(null);
    setFileName('');
    setFailure(null);
  };

  const readFile = async (file: File) => {
    setBusy(true);
    setFailure(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      setSheets(await readSpreadsheet(file.name, bytes));
      setFileName(file.name);
    } catch (error) {
      setSheets(null);
      setFileName(file.name);
      setFailure(error instanceof Error ? error.message : String(error));
    }
    setBusy(false);
  };

  const close = () => { reset(); onClose(); };

  return (
    <Drawer
      open={open}
      title="Upload a questionnaire"
      subtitle={
        fileName === ''
          ? 'Excel or CSV — one row per question'
          : `${fileName}${result ? ` · ${result.questionsRead} question(s) across ${result.sectionsRead} section(s)` : ''}`
      }
      onClose={close}
      width={880}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="tertiary" onClick={reset} disabled={sheets === null && failure === null}>
            Choose a different file
          </Button>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!result?.ok}
              onClick={() => {
                if (!result?.ok) return;
                onApply(result.next);
                reset();
              }}
            >
              {/* "Replace with" on a template that holds nothing is a warning
                  about something that cannot happen, so it only appears once
                  there is something to lose. */}
              {result?.ok
                ? !hasContent
                  ? `Bring in ${result.questionsRead} question(s)`
                  : mode === 'replace'
                    ? `Replace with these ${result.questionsRead} question(s)`
                    : `Add these ${result.questionsRead} question(s)`
                : 'Bring it in'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="rfx-stack" style={{ gap: 14 }}>
        <GetTheTemplate />

        <FilePicker
          inputRef={inputRef}
          busy={busy}
          fileName={fileName}
          onFile={readFile}
        />

        {failure && (
          <ValidationBanner tone="error" title="That file could not be read">
            {failure}
          </ValidationBanner>
        )}

        {hasContent && sheets !== null && (
          <Card
            title="What to do with what is already here"
            hint={`This template already holds ${template.questions.length} question(s) in ${template.sections.length} section(s).`}
          >
            <Segmented
              value={mode}
              onChange={setMode}
              options={[
                { value: 'replace' as const, label: 'Replace all of it' },
                { value: 'append' as const, label: 'Add the file to it' },
              ]}
            />
            <div style={{ fontSize: 11.5, color: color.textSecondary, marginTop: 8, lineHeight: 1.6 }}>
              {mode === 'replace'
                ? 'Every section and question on this template is discarded and the file becomes the questionnaire. Nothing is saved until you save the template, so this is still reversible by cancelling.'
                : 'The file is added underneath. A section whose name already exists takes the new questions rather than being created twice, and a question code already in use is given a suffix so answers do not collide.'}
            </div>
          </Card>
        )}

        {result && <ImportReport result={result} takenNames={takenNames} />}
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Getting the file in the first place
// ---------------------------------------------------------------------------

/**
 * The template download sits above the upload, not beside it.
 *
 * A buyer arriving here with no file needs the template; a buyer arriving with
 * one scrolls past this in a second. Putting the upload first would optimise
 * for the second visit at the cost of the first, which is the one where
 * people give up.
 */
function GetTheTemplate() {
  return (
    <Card
      title="Start from the template"
      hint="The Excel file carries the response types as dropdowns, a worked example of each column, and a sheet explaining what goes where. The CSV is the same columns without the dropdowns."
      action={
        <div style={{ display: 'flex', gap: 6 }}>
          <Button
            variant="primary"
            size="small"
            onClick={() => download('questionnaire-template.xlsx', importWorkbook() as BlobPart, XLSX_MIME)}
          >
            ⬇ Excel template
          </Button>
          <Button
            variant="secondary"
            size="small"
            onClick={() => download('questionnaire-template.csv', importCsv(), 'text/csv;charset=utf-8')}
          >
            ⬇ CSV
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        {IMPORT_COLUMNS.map((column) => (
          <Chip key={column.field} tone="neutral" title={column.guidance}>{column.header}</Chip>
        ))}
      </div>
      <div style={{ fontSize: 11.5, color: color.textSecondary, marginTop: 10, lineHeight: 1.6 }}>
        One row per question. Repeat the section name and its weight down the rows of that section —
        a blank Section continues the one above it. Only <strong>Question</strong> has to be filled
        in; everything else has a default, and every default taken is reported back to you before
        anything changes.
      </div>
    </Card>
  );
}

function FilePicker({
  inputRef, busy, fileName, onFile,
}: {
  inputRef: React.RefObject<HTMLInputElement>;
  busy: boolean;
  fileName: string;
  onFile: (file: File) => void;
}) {
  const [over, setOver] = React.useState(false);

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file) onFile(file);
      }}
      style={{
        border: `1.5px dashed ${over ? color.brandPrimary : color.borderStrong}`,
        background: over ? color.brandPrimarySoft : color.surfacePage,
        borderRadius: radius.card,
        padding: '22px 18px',
        textAlign: 'center',
      }}
    >
      <div aria-hidden style={{ fontSize: 22 }}>⬆</div>
      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 6 }}>
        {busy ? 'Reading the file…' : fileName === '' ? 'Drop the filled-in sheet here' : fileName}
      </div>
      <div style={{ fontSize: 11.5, color: color.textSecondary, marginTop: 5 }}>
        .xlsx or .csv · nothing is written to the template until you confirm what it found
      </div>
      <div style={{ marginTop: 10 }}>
        <Button variant="secondary" size="small" onClick={() => inputRef.current?.click()}>
          Choose a file
        </Button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.csv,.txt"
        aria-label="Questionnaire file"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          // Cleared so choosing the same file twice fires again — the obvious
          // thing to do after fixing a row is to re-pick the file you just had.
          e.target.value = '';
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// What the file turned out to say
// ---------------------------------------------------------------------------

function ImportReport({
  result, takenNames,
}: { result: QuestionnaireImport; takenNames: string[] }) {
  /**
   * Severity first, then the row.
   *
   * Grouped by severity because a buyer reads the refusals and then decides
   * whether to care about the rest; ordered by row inside each group because
   * the point of the list is to work down the spreadsheet with it open. Two
   * adjustments to the same row sit together, which is also where they belong.
   */
  const inRowOrder = (issues: ImportIssue[]) =>
    [...issues].sort((a, b) => (a.row ?? Number.MAX_SAFE_INTEGER) - (b.row ?? Number.MAX_SAFE_INTEGER));

  const errors = inRowOrder(result.issues.filter((i) => i.severity === 'error'));
  const warnings = inRowOrder(result.issues.filter((i) => i.severity === 'warning'));
  const notes = inRowOrder(result.issues.filter((i) => i.severity === 'info'));

  if (!result.ok) {
    return (
      <ValidationBanner tone="error" title="Nothing could be brought in from this file">
        <div className="rfx-stack" style={{ gap: 6, marginTop: 4 }}>
          {result.issues.map((issue, i) => <IssueLine key={i} issue={issue} />)}
        </div>
      </ValidationBanner>
    );
  }

  const clean = result.issues.length === 0;

  return (
    <div className="rfx-stack" style={{ gap: 12 }}>
      <ValidationBanner
        tone={errors.length > 0 ? 'warning' : clean ? 'success' : 'info'}
        title={
          clean
            ? `${result.questionsRead} question(s) across ${result.sectionsRead} section(s), read exactly as written`
            : `${result.questionsRead} of ${result.rowsRead} row(s) read · ${errors.length} refused, ${warnings.length} adjusted`
        }
      >
        {clean
          ? 'Every row was understood and nothing had to be changed. Review it below and bring it in.'
          : 'Everything below is what will happen if you bring this in. Close this, fix the sheet and upload it again if any of it is wrong.'}
        {/* Said here rather than discovered afterwards: the sheet is a
            starting point, not a commitment. Nothing about it is locked by
            having arrived in a file. */}
        <div style={{ marginTop: 6 }}>
          It arrives as a <strong>draft</strong>. Every section and every question stays
          editable — rename them, reweight them, reorder them, change a response type, add
          or remove whichever you like — and the template is only published when you say so.
        </div>
      </ValidationBanner>

      {result.issues.length > 0 && (
        <Card
          title="What happened to each row"
          hint="Row numbers are the ones in the spreadsheet, so they point straight at the cell to fix."
        >
          <div className="rfx-stack" style={{ gap: 7 }}>
            {[...errors, ...warnings, ...notes].map((issue, i) => (
              <IssueLine key={i} issue={issue} />
            ))}
          </div>
        </Card>
      )}

      <StillToFix template={result.next} takenNames={takenNames} />

      <SectionSummary sections={result.next.sections} questions={result.next.questions} />
      <QuestionSummary
        questions={result.next.questions}
        sections={result.next.sections}
        faults={errorsByQuestion(validateTemplate(result.next, takenNames).errors)}
      />
    </div>
  );
}

/**
 * What will still be blocking Save after this import.
 *
 * The import and the template's own validation answer different questions —
 * "could the file be read?" and "is this askable?" — and a buyer does not
 * care about the distinction. Without this, a sheet that imported cleanly
 * could still land on a greyed-out Save button with the reason at the top of
 * a form they have just scrolled past.
 */
function StillToFix({
  template, takenNames,
}: { template: QuestionnaireTemplate; takenNames: string[] }) {
  const { errors } = validateTemplate(template, takenNames);
  if (errors.length === 0) return null;

  return (
    <ValidationBanner
      tone="warning"
      title={`${errors.length} thing${errors.length === 1 ? '' : 's'} to fix before this template can be saved`}
    >
      <div className="rfx-stack" style={{ gap: 6, marginTop: 4 }}>
        {errors.map((error, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <span aria-hidden style={{ color: color.warningText, fontWeight: 700 }}>•</span>
            <span style={{ lineHeight: 1.55 }}>{error.message}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 8, color: color.textSecondary }}>
        None of this stops the import — bring it in and fix it in the builder, where the
        questions are in front of you.
      </div>
    </ValidationBanner>
  );
}

function IssueLine({ issue }: { issue: ImportIssue }) {
  const tone = SEVERITY_TONE[issue.severity];
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12 }}>
      <span aria-hidden style={{ color: tone.fg, fontWeight: 700, lineHeight: 1.55 }}>
        {tone.icon}
      </span>
      <span style={{ lineHeight: 1.55, color: color.textBody }}>
        {issue.row !== null && (
          <strong style={{ color: tone.fg }}>Row {issue.row} — </strong>
        )}
        {issue.message}
      </span>
    </div>
  );
}

function SectionSummary({
  sections, questions,
}: { sections: TemplateSection[]; questions: TemplateQuestion[] }) {
  const total = sections.reduce((sum, s) => sum + Math.max(0, s.weight), 0);
  const scored = sections.some((s) => s.weight > 0);

  const columns: Column<TemplateSection>[] = [
    { key: 'name', header: 'Section', render: (s) => <strong style={{ fontSize: 12.5 }}>{s.name}</strong> },
    {
      key: 'asked', header: 'Asked', width: '130px',
      render: (s) => (
        <Chip tone={s.askedPer === 'LINE' ? 'gold' : 'neutral'}>
          {QUESTION_SCOPE_LABEL[s.askedPer]}
        </Chip>
      ),
    },
    {
      key: 'count', header: 'Questions', numeric: true, width: '96px',
      render: (s) => questions.filter((q) => q.sectionId === s.id).length,
    },
    {
      key: 'allocated', header: 'Allocated', numeric: true, width: '96px',
      render: (s) => questions
        .filter((q) => q.sectionId === s.id)
        .reduce((sum, q) => sum + q.weight, 0),
    },
    { key: 'weight', header: 'Section %', numeric: true, width: '96px', render: (s) => s.weight },
  ];

  return (
    <Card
      padded={false}
      title="Sections"
      hint={
        scored
          ? total === 100
            ? 'The sections total 100% of the technical score.'
            : `The sections total ${total}%. They have to make 100% before the template can be saved — the builder will keep saying so.`
          : 'Nothing here is weighted, so this questionnaire gathers rather than scores.'
      }
      action={
        <Chip tone={!scored ? 'neutral' : total === 100 ? 'success' : 'danger'}>
          {scored ? `${total}% of 100%` : 'not scored'}
        </Chip>
      }
    >
      <Table columns={columns} rows={sections} rowKey={(s) => s.id} />
    </Card>
  );
}

function QuestionSummary({
  questions, sections, faults,
}: {
  questions: TemplateQuestion[];
  sections: TemplateSection[];
  /** Blocking errors by question, so the table shows where as well as what. */
  faults: Map<string, TemplateIssue[]>;
}) {
  const columns: Column<TemplateQuestion>[] = [
    {
      key: 'code', header: 'ID', width: '86px',
      render: (q) => (
        <code style={{ fontSize: 11, color: faults.has(q.id) ? color.dangerText : undefined }}>
          {q.code}
        </code>
      ),
    },
    {
      key: 'title', header: 'Question',
      render: (q) => {
        const broken = faults.get(q.id) ?? [];
        return (
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>{q.title}</div>
            <div style={{ fontSize: 10.5, color: color.textMuted, marginTop: 2 }}>
              {sections.find((s) => s.id === q.sectionId)?.name ?? 'no section'}
            </div>
            {/* The reason sits on the row rather than only in the list above,
                so a thirty-question import does not turn into a hunt. */}
            {broken.map((fault, i) => (
              <div
                key={i}
                style={{
                  fontSize: 11, color: color.dangerText, lineHeight: 1.5, marginTop: 3,
                  display: 'flex', gap: 5,
                }}
              >
                <span aria-hidden style={{ fontWeight: 700 }}>✕</span>
                <span>{fault.message}</span>
              </div>
            ))}
          </div>
        );
      },
    },
    {
      key: 'type', header: 'Response type', width: '150px',
      render: (q) => <Chip tone="brand">{typeLabel(q.type)}</Chip>,
    },
    {
      key: 'flags', header: '', width: '130px',
      render: (q) => (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {faults.has(q.id) && <Chip tone="danger" icon="✕">needs fixing</Chip>}
          {q.isRequired && <Chip tone="neutral">required</Chip>}
          {q.isKnockout && <Chip tone="danger">knockout</Chip>}
          {q.allowAttachment && <Chip tone="neutral">file</Chip>}
        </div>
      ),
    },
    { key: 'weight', header: 'Weight', numeric: true, width: '82px', render: (q) => q.weight },
  ];

  return (
    <Card
      padded={false}
      title="Questions"
      hint={
        faults.size === 0
          ? 'In the order they will be asked. Anything that needs changing is quicker to change here once it is in than to re-upload.'
          : `In the order they will be asked. The ${faults.size} marked in red are the ones blocking Save — bring the file in and fix them in the builder, or correct the sheet and upload it again.`
      }
    >
      <Table
        columns={columns}
        rows={questions}
        rowKey={(q) => q.id}
        rowStyle={(q) => (faults.has(q.id)
          ? { background: color.dangerSoft, boxShadow: `inset 3px 0 0 ${color.dangerText}` }
          : undefined)}
      />
    </Card>
  );
}
