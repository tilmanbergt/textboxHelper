/**
 * The Notes tab's flows (technical-design-comments-images.md §5.2): every action writes at once
 * (one entry update, through the review, which reads the page again); ‹ › choose the paragraph
 * above or below, reading the page beside it first when they step past the page edge.
 */
import {useCallback, useMemo, useState} from 'react';
import {chooseNoteParagraph, dropNote, readPageParagraphs, setCommentDone, setImagePlace, updateNoteImage} from '../../actions/noteEdit';
import {convertSidemark} from '../../actions/sidemarkConvert';
import {stepParagraph, type NoteRow, type PageParagraph} from '../../domain/notes/noteRows';
import type {ManuscriptReview} from './useManuscriptReview';

/** A note as the flows need it: its id, page and paragraph. */
export type NoteRef = Pick<NoteRow, 'id' | 'page' | 'at'>;

export interface Notes {
  /** The paragraphs of each page known (read by the review, or read for ‹ ›), for the page map. */
  paragraphs: (page: number) => PageParagraph[];
  step: (note: NoteRef, direction: 'above' | 'below') => void;
  setDone: (note: NoteRef, done: boolean) => void;
  setPlace: (note: NoteRef, place: 'before' | 'after') => void;
  useAsText: (note: NoteRef) => void;
  drop: (note: NoteRef) => void;
  updateImage: (note: NoteRef) => void;
}

export function useNotes(review: ManuscriptReview): Notes {
  const {note: info, pages, writeNote} = review;
  const notePath = info?.notePath ?? null;
  const pageCount = info?.pageCount ?? 0;
  const [loaded, setLoaded] = useState<Map<number, PageParagraph[]>>(new Map());

  const known = useMemo(() => {
    const map = new Map(loaded);
    Object.entries(pages).forEach(([page, pageReview]) => {
      if (pageReview.state === 'read' && pageReview.preview.base?.paragraphs) {
        map.set(Number(page), pageReview.preview.base.paragraphs);
      }
    });
    return map;
  }, [loaded, pages]);

  const choose = useCallback(
    (note: NoteRef, target: PageParagraph) =>
      writeNote(
        note.page,
        () => chooseNoteParagraph(note.id, {page: target.page, numInPage: target.numInPage, text: target.text, blockId: target.blockId}),
        'Could not store the paragraph. Please try again.',
      ),
    [writeNote],
  );

  const step = useCallback(
    (note: NoteRef, direction: 'above' | 'below') => {
      if (!notePath) {
        return;
      }
      const run = (map: Map<number, PageParagraph[]>) => {
        // The paragraph as read now: found by its place when it was read apart (another page).
        const page = note.at?.page ?? note.page;
        const current = note.at
          ? (map.get(page) ?? []).find(
              item => item.uuid === note.at?.uuid || (item.rect.top === note.at?.rect.top && item.rect.left === note.at?.rect.left),
            )
          : undefined;
        const next = stepParagraph({page, uuid: current?.uuid ?? null}, direction, map, pageCount);
        if ('target' in next) {
          choose(note, next.target);
        } else if ('load' in next) {
          readPageParagraphs(notePath, next.load)
            .then(list => {
              const more = new Map(map).set(next.load, list);
              setLoaded(before => new Map(before).set(next.load, list));
              run(more);
            })
            .catch(caught => console.warn('[Notes] page not read', JSON.stringify({page: next.load, error: String(caught)})));
        }
      };
      run(known);
    },
    [choose, known, notePath, pageCount],
  );

  const write = useCallback(
    (note: NoteRef, action: () => Promise<void>, failure: string) => writeNote(note.page, action, failure),
    [writeNote],
  );

  return {
    paragraphs: page => known.get(page) ?? [],
    step,
    setDone: (note, done) => write(note, () => setCommentDone(note.id, done), 'Could not store Done. Please try again.'),
    setPlace: (note, place) => write(note, () => setImagePlace(note.id, place), 'Could not store the place. Please try again.'),
    useAsText: note => write(note, () => convertSidemark(note.id, 'unpaired'), 'Could not change the sign on the page. Please try again.'),
    drop: note => write(note, () => dropNote(note.id), 'Could not drop it from the page. Please try again.'),
    updateImage: note => write(note, () => updateNoteImage(note.id), 'Could not update the image. Please try again.'),
  };
}
