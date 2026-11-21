import {parseTextboxImportBlocks, summarizeTextboxImportBlocks} from '../../src/domain/importParsing';
import type {TextboxImportStructureSettings} from '../../src/domain/importSettings';

const STRUCTURE: TextboxImportStructureSettings = {
  layoutMode: 'paragraphTextboxes',
  paragraphSeparator: 'blankLine',
  detectMarkdownHeadings: true,
  paragraph: {fontSize: 36, bold: false},
  heading1: {fontSize: 60, bold: true},
  heading2: {fontSize: 48, bold: true},
  heading3: {fontSize: 40, bold: false},
};

const TEXT = '# Title\r\n\r\nFirst paragraph\nstill first.\n\n  \n## Part two \n\nSecond.\n\n#### Too deep\n\n#NoSpace';

describe('import parsing', () => {
  it('splits at blank lines and styles markdown headings up to level 3', () => {
    expect(parseTextboxImportBlocks({text: TEXT, structure: STRUCTURE})).toEqual([
      {role: 'heading1', text: '# Title', fontSize: 60, bold: true},
      {role: 'paragraph', text: 'First paragraph\nstill first.', fontSize: 36, bold: false},
      {role: 'heading2', text: '## Part two', fontSize: 48, bold: true},
      {role: 'paragraph', text: 'Second.', fontSize: 36, bold: false},
      {role: 'paragraph', text: '#### Too deep', fontSize: 36, bold: false},
      {role: 'paragraph', text: '#NoSpace', fontSize: 36, bold: false},
    ]);
  });

  it('makes every non-empty line a block with the line separator', () => {
    const blocks = parseTextboxImportBlocks({
      text: 'one\n\n two \nthree',
      structure: {...STRUCTURE, paragraphSeparator: 'line'},
    });
    expect(blocks.map(block => block.text)).toEqual(['one', 'two', 'three']);
  });

  it('keeps headings as paragraphs when heading detection is off', () => {
    const blocks = parseTextboxImportBlocks({text: '# Title', structure: {...STRUCTURE, detectMarkdownHeadings: false}});
    expect(blocks).toEqual([{role: 'paragraph', text: '# Title', fontSize: 36, bold: false}]);
  });

  it('counts blocks by role', () => {
    expect(summarizeTextboxImportBlocks(parseTextboxImportBlocks({text: TEXT, structure: STRUCTURE}))).toEqual({
      blockCount: 6,
      paragraphCount: 4,
      headingCount: 2,
      h1Count: 1,
      h2Count: 1,
      h3Count: 0,
    });
  });
});
