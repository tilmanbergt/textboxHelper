import {createErrorRing, errorEntryFromCrash, errorEntryFromLog, MAX_MESSAGE} from '../../src/domain/errorRing';

const AT = '2026-11-25T20:00:00.000Z';

describe('errorRing', () => {
  it('keeps the newest entries in order and counts the dropped ones', () => {
    const ring = createErrorRing(3);
    for (let i = 1; i <= 5; i++) {
      ring.add({at: AT, level: 'error', module: 'M', message: `e${i}`});
    }
    expect(ring.entries().map(e => e.message)).toEqual(['e3', 'e4', 'e5']);
    expect(ring.droppedCount()).toBe(2);
  });

  it('a log line: module from the [Module] prefix, the rest joined, an Error gives its stack', () => {
    const error = new Error('boom');
    const entry = errorEntryFromLog('warn', ['[Manuscript] page not read', error, {page: 3}], AT);
    expect(entry.module).toBe('Manuscript');
    expect(entry.message).toBe('page not read Error: boom {"page":3}');
    expect(entry.level).toBe('warn');
    expect(entry.stack).toContain('boom');
  });

  it('never throws on odd arguments and cuts long messages', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => errorEntryFromLog('error', [cyclic, undefined, null, Symbol('x')], AT)).not.toThrow();
    expect(errorEntryFromLog('error', [], AT)).toEqual({at: AT, level: 'error', module: '', message: ''});
    const long = errorEntryFromLog('error', ['x'.repeat(MAX_MESSAGE + 50)], AT);
    expect(long.message.length).toBe(MAX_MESSAGE + 1);
  });

  it('a crash: module "screen", message and the component stack', () => {
    const entry = errorEntryFromCrash(new TypeError('undefined is not a function'), '\n    in OutlineTab', AT);
    expect(entry.module).toBe('screen');
    expect(entry.message).toBe('TypeError: undefined is not a function');
    expect(entry.stack).toContain('in OutlineTab');
    const longStack = new Error('x');
    longStack.stack = 'at f\n'.repeat(1000);
    expect(errorEntryFromCrash(longStack, 'in ReviewTab', AT).stack!.startsWith('in ReviewTab')).toBe(true);
  });
});
