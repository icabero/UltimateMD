/**
 * Where a reader is in a note, in terms of the note's own text so that every
 * view can find it again: the line at the top of the screen, and how far
 * down that line (0 to 1) the screen starts.
 */
export interface Place {
  line: number;
  frac: number;
}

/** The last place seen in each open note, by tab key. */
export const places = new Map<string, Place>();
