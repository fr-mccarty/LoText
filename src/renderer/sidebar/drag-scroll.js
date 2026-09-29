// Scrolling the sidebar while a row is dragged near its top or bottom edge, so a row can be
// dropped into a folder that is out of view. The same as Finder's list: the nearer the edge, the
// faster, and fastest with the pointer past it.

/** How far in from the top or bottom edge the list starts to scroll, in pixels. */
export const EDGE = 36
/** The most it scrolls in one frame, reached at the edge and beyond it. */
export const MAX_STEP = 10

/**
 * How far to scroll the list this frame for a pointer at `y`, with the list's visible top and
 * bottom at `top` and `bottom`: negative is up, 0 is not at all. A list too short to have two
 * edge zones never scrolls from its middle.
 */
export function scrollStep (y, top, bottom, edge = Math.min(EDGE, (bottom - top) / 3)) {
  if (edge <= 0) return 0
  const speed = (depth) => -Math.ceil(MAX_STEP * Math.min(1, depth / edge))
  if (y < top + edge) return speed(top + edge - y)
  if (y > bottom - edge) return -speed(y - (bottom - edge))
  return 0
}
