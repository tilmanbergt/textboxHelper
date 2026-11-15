import {createDiagnosticLog} from '../src/shared/diagnosticLog';

describe('diagnostic log', () => {
  it('keeps entries in order with their time since the last clear', () => {
    let clock = 1000;
    const log = createDiagnosticLog(10, () => clock);
    clock = 1005;
    log.add('first', {a: 1});
    clock = 1012;
    log.add('second');
    expect(log.snapshot()).toEqual({
      entries: [
        {atMs: 5, stage: 'first', payload: {a: 1}},
        {atMs: 12, stage: 'second'},
      ],
      droppedCount: 0,
    });
  });

  it('keeps the first entries and counts the rest once the limit is reached', () => {
    const log = createDiagnosticLog(2, () => 0);
    log.add('one');
    log.add('two');
    log.add('three');
    log.add('four');
    const snapshot = log.snapshot();
    expect(snapshot.entries.map(entry => entry.stage)).toEqual(['one', 'two']);
    expect(snapshot.droppedCount).toBe(2);
  });

  it('starts empty again after clear', () => {
    const log = createDiagnosticLog(2, () => 0);
    log.add('one');
    log.add('two');
    log.add('three');
    log.clear();
    log.add('fresh');
    expect(log.snapshot()).toEqual({entries: [{atMs: 0, stage: 'fresh'}], droppedCount: 0});
  });

  it('returns a copy that later entries do not change', () => {
    const log = createDiagnosticLog(5, () => 0);
    log.add('one');
    const snapshot = log.snapshot();
    log.add('two');
    expect(snapshot.entries).toHaveLength(1);
  });
});
