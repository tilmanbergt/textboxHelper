/**
 * The README lists the edit marks as the help's "Marks at a glance" does: every mark's icon, name,
 * "+ text" where it takes new words, and its line - so the two can't drift apart.
 */
import {readFileSync} from 'fs';
import {join} from 'path';
import {MARK_HELP, MARK_HELP_KEYS} from '../src/domain/markHelp';

const README = readFileSync(join(__dirname, '..', 'README.md'), 'utf8');

describe('README marks at a glance', () => {
  it.each(MARK_HELP.map(entry => [entry.id, entry] as const))('%s: icon, name, + text and line', (_id, entry) => {
    const row = README.split('\n').find(line => line.includes(`docs/user/images/marks/${entry.id}-icon.png`));
    expect(row).toBeDefined();
    expect(row).toContain(`**${entry.name}**${entry.needsText ? ' · + text' : ''} |`);
    expect(row).toContain(`| ${entry.glance} |`);
  });

  it('the rows are in the help order and the keys are there', () => {
    const order = MARK_HELP.map(entry => README.indexOf(`docs/user/images/marks/${entry.id}-icon.png`));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(README).toContain(MARK_HELP_KEYS.text);
    expect(README).toContain(MARK_HELP_KEYS.numbers);
  });
});
