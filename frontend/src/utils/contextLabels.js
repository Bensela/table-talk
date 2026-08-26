export const CONTEXT_LABELS = {
  Exploring: 'Keep It Light',
  Established: 'Go Deeper',
  Mature: 'Stay Awhile',
  All: 'All',
  Unassigned: 'Unassigned',
  Unknown: 'Unknown'
};

export function contextLabel(ctx) {
  if (!ctx) return ctx || '\u2014';
  if (Object.prototype.hasOwnProperty.call(CONTEXT_LABELS, ctx)) {
    return CONTEXT_LABELS[ctx];
  }
  return ctx;
}
