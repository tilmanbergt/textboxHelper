import {buildProblemReport, redactText, reportFileName, versionLine, type ProblemReportInput} from '../../src/domain/problemReport';

const INPUT: ProblemReportInput = {
  createdAt: '2026-11-25T20:00:00.000Z',
  build: {label: '0.3.0-alpha+a1b2c3d', version: '0.2.2', versionCode: 473462, commit: 'a1b2c3d', snPluginLib: '0.2.3'},
  device: {model: 'A5 X', manufacturer: 'Ratta', os: null, screen: null},
  note: {name: 'Draft.note', pageCount: 4, currentPage: 2, pageSize: {width: 1404, height: 1872}, linked: null},
  settings: {layout: {margins: [100, 100, 280, 625]}},
  markers: {
    pages: [2],
    droppedCount: 0,
    entries: [
      {
        atMs: 1,
        stage: 'previewContext',
        payload: {
          notePath: '/storage/emulated/0/Note/Private/Draft.note',
          textboxes: [{uuid: 'u1', textPreview: 'my secret words', textLength: 15, textAlign: 0, fontPath: '/x/f.ttf'}],
          words: ['secret', 'words'],
          rect: {left: 1},
        },
      },
    ],
  },
  timings: {entryCount: 0, droppedCount: 0, summary: [], events: {}},
  errors: {entries: [], droppedCount: 0},
  pageText: null,
};

describe('problemReport', () => {
  it('without text: previews emptied, paths cut to the file name, no text field', () => {
    const report = buildProblemReport(INPUT) as any;
    expect(report.kind).toBe('manuscript-report');
    expect(report.includesText).toBe(false);
    expect(report.text).toBeUndefined();
    const payload = report.markers.entries[0].payload;
    expect(payload.notePath).toBe('Draft.note');
    expect(payload.textboxes[0].textPreview).toBe('[15 characters]');
    expect(payload.textboxes[0].textLength).toBe(15);
    expect(payload.textboxes[0].fontPath).toBe('f.ttf');
    expect(payload.words).toEqual(['[6 characters]', '[5 characters]']);
    expect(JSON.stringify(report)).not.toContain('secret');
  });

  it('with text: the page text and the previews are kept', () => {
    const report = buildProblemReport({...INPUT, pageText: ['Hello world']}) as any;
    expect(report.includesText).toBe(true);
    expect(report.text).toEqual(['Hello world']);
    expect(report.markers.entries[0].payload.textboxes[0].textPreview).toBe('my secret words');
  });

  it('a note that could not be read is null with the reason', () => {
    const report = buildProblemReport({...INPUT, note: null, noteError: 'no note open'}) as any;
    expect(report.note).toBeNull();
    expect(report.noteError).toBe('no note open');
  });

  it('redactText leaves numbers, booleans and empty strings alone', () => {
    expect(redactText({text: '', textBold: 1, n: 2, flag: true, list: [{title: 'Ch 1'}]})).toEqual({
      text: '',
      textBold: 1,
      n: 2,
      flag: true,
      list: [{title: '[4 characters]'}],
    });
  });

  it('file name and version line', () => {
    expect(reportFileName('2026-11-25T20:00:00.000Z')).toBe('manuscript-report-2026-11-25T20-00-00-000Z.json');
    expect(versionLine(INPUT.build, {...INPUT.device, os: 'Android 8.1'})).toBe(
      'Manuscript 0.3.0-alpha+a1b2c3d · build 473462 · Ratta A5 X · Android 8.1',
    );
    expect(versionLine({...INPUT.build, versionCode: 0}, {model: null, manufacturer: null, os: null, screen: null})).toBe(
      'Manuscript 0.3.0-alpha+a1b2c3d',
    );
  });
});
