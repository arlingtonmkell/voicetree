/**
 * Pure geometry for folder boxes. The DOM/cytoscape wiring in folderResizeFrame is
 * a thin shell over this.
 *
 * A cytoscape compound has no size or position of its own: its box is its
 * children's bbox, grown to a min-width/min-height floor, with the extra slack
 * split between the two sides by min-*-bias. Left to itself the box therefore
 * shifts whenever a child moves, and re-splits its slack whenever a bias changes.
 *
 * To make a folder behave like a box the user owns, we keep its intended FRAME
 * (the outer body rectangle, in graph units) and, whenever the children move,
 * solve for the floor + bias that reproduce exactly that frame. The frame only
 * changes when the user drags an edge, moves the folder, or pushes a child
 * through an edge (the frame then grows to keep containing its children).
 */

/** Eight grips: four edges + four corners. */
export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export const ALL_RESIZE_HANDLES: readonly ResizeHandle[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

// Minimum folder dimensions in graph units. Large enough to keep the chip strip
// and a label legible; the children bbox is a separate, dynamic floor.
const MIN_FOLDER_WIDTH = 120
const MIN_FOLDER_HEIGHT = 80

/** An axis-aligned rectangle in graph units. */
export interface FrameRect {
    readonly x1: number
    readonly y1: number
    readonly x2: number
    readonly y2: number
}

/** The cytoscape compound style values that reproduce a frame. */
interface CompoundSizing {
    readonly 'min-width': number
    readonly 'min-height': number
    readonly 'min-width-bias-left': number
    readonly 'min-width-bias-right': number
    readonly 'min-height-bias-top': number
    readonly 'min-height-bias-bottom': number
}

// Which way each grip pushes its edge: +1 = the east/south edge, -1 = the
// west/north edge, 0 = the axis the grip does not touch.
const HORIZONTAL_EDGE: Record<ResizeHandle, number> = { e: 1, se: 1, ne: 1, w: -1, sw: -1, nw: -1, n: 0, s: 0 }
const VERTICAL_EDGE: Record<ResizeHandle, number> = { s: 1, se: 1, sw: 1, n: -1, ne: -1, nw: -1, e: 0, w: 0 }

/**
 * Grow `frame` just enough to contain `content` with `inset` (the folder's
 * padding + border) on every side. A frame that already contains it is returned
 * unchanged — a frame never shrinks on its own.
 */
export function growFrameToContain(frame: FrameRect, content: FrameRect, inset: number): FrameRect {
    return {
        x1: Math.min(frame.x1, content.x1 - inset),
        y1: Math.min(frame.y1, content.y1 - inset),
        x2: Math.max(frame.x2, content.x2 + inset),
        y2: Math.max(frame.y2, content.y2 + inset),
    }
}

// Split of one axis's slack between its two sides. With no slack the split is
// irrelevant; a fixed one keeps the output stable.
function biasPair(slackBefore: number, slackAfter: number): readonly [number, number] {
    const slack: number = slackBefore + slackAfter
    return slack > 0 ? [slackBefore / slack, slackAfter / slack] : [0, 1]
}

/**
 * The compound sizing that makes cytoscape draw the folder body exactly at
 * `frame`, given where its children currently are. `frame` must already contain
 * `content` + `inset` (see growFrameToContain).
 */
export function compoundSizingForFrame(frame: FrameRect, content: FrameRect, inset: number): CompoundSizing {
    const [left, right] = biasPair(content.x1 - inset - frame.x1, frame.x2 - (content.x2 + inset))
    const [top, bottom] = biasPair(content.y1 - inset - frame.y1, frame.y2 - (content.y2 + inset))
    return {
        'min-width': frame.x2 - frame.x1 - 2 * inset,
        'min-height': frame.y2 - frame.y1 - 2 * inset,
        'min-width-bias-left': left,
        'min-width-bias-right': right,
        'min-height-bias-top': top,
        'min-height-bias-bottom': bottom,
    }
}

/**
 * The frame after dragging a grip by (graphDx, graphDy) from `start`. Only the
 * edges the grip touches move, 1:1 with the pointer; each stops at the folder's
 * minimum size and at its children (an edge cannot be dragged through them).
 */
export function resizeFrame(
    start: FrameRect,
    handle: ResizeHandle,
    graphDx: number,
    graphDy: number,
    content: FrameRect,
    inset: number,
): FrameRect {
    const horizontal: number = HORIZONTAL_EDGE[handle]
    const vertical: number = VERTICAL_EDGE[handle]
    // The minimum only stops a folder being shrunk further: one that starts out
    // smaller than it must not jump to it the moment an edge is grabbed.
    const minWidth: number = Math.min(MIN_FOLDER_WIDTH, start.x2 - start.x1)
    const minHeight: number = Math.min(MIN_FOLDER_HEIGHT, start.y2 - start.y1)
    return {
        x1: horizontal < 0
            ? Math.min(start.x1 + graphDx, content.x1 - inset, start.x2 - minWidth)
            : start.x1,
        x2: horizontal > 0
            ? Math.max(start.x2 + graphDx, content.x2 + inset, start.x1 + minWidth)
            : start.x2,
        y1: vertical < 0
            ? Math.min(start.y1 + graphDy, content.y1 - inset, start.y2 - minHeight)
            : start.y1,
        y2: vertical > 0
            ? Math.max(start.y2 + graphDy, content.y2 + inset, start.y1 + minHeight)
            : start.y2,
    }
}
