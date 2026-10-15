/**
 * Gentle tidy: the manual "Tidy layout" action.
 *
 * It keeps the arrangement the user built. Within each group of siblings it does
 * two things, and nothing else:
 *   1. Compact: if the siblings are spread far wider than they need to be (see
 *      compactionFactor), draw them in toward their centre by one uniform factor.
 *      Directions and relative order are unchanged; a group that is already
 *      reasonably close never moves.
 *   2. Separate: push apart siblings that overlap, by the least distance that
 *      separates them.
 * It works folder by folder, innermost first: a folder's nodes are tidied among
 * themselves, then the folder moves as one block among its siblings, so a
 * folder's contents always stay together and inside it.
 */

/** Siblings spread wider than this typical gap (graph units) allows are drawn together... */
const MAX_TYPICAL_GAP: number = 300;
/** ...to the spread this typical gap gives. */
const COMPACTED_TYPICAL_GAP: number = 150;

import { removeRectangularOverlaps, type OverlapRect } from '@/shell/UI/cytoscape-graph-ui/graphviz/layout/engine/removeRectangularOverlaps';

/** A node to lay out: a leaf with a centre and size, or a folder holding more nodes. */
export type TidyNode =
    | { readonly kind: 'leaf'; readonly id: string; readonly x: number; readonly y: number; readonly width: number; readonly height: number }
    | { readonly kind: 'folder'; readonly id: string; readonly padding: number; readonly children: readonly TidyNode[] };

interface TidyMove { readonly dx: number; readonly dy: number }

interface Box { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number }

interface TidiedGroup {
    /** Leaf id → how far the tidy moves it. */
    readonly moves: ReadonlyMap<string, TidyMove>;
    /** The group's bounding box after the tidy, or null for an empty group. */
    readonly box: Box | null;
}

function union(boxes: readonly Box[]): Box | null {
    if (boxes.length === 0) return null;
    return {
        x1: Math.min(...boxes.map((b: Box): number => b.x1)),
        y1: Math.min(...boxes.map((b: Box): number => b.y1)),
        x2: Math.max(...boxes.map((b: Box): number => b.x2)),
        y2: Math.max(...boxes.map((b: Box): number => b.y2)),
    };
}

function median(values: readonly number[]): number {
    const sorted: number[] = [...values].sort((a: number, b: number): number => a - b);
    return sorted[Math.floor(sorted.length / 2)];
}

/**
 * The uniform factor (≤ 1) to draw a group's boxes toward their centre by.
 *
 * A group of n boxes of typical size s, with typical gap g between neighbours,
 * fits within a radius of about √n·(s + g). The group's spread is measured as
 * the median distance of its boxes from their centre — not the gap to the
 * nearest neighbour, which stays small when boxes sit in tight clusters that are
 * themselves far apart. Past the radius for MAX_TYPICAL_GAP the group is drawn
 * in to the radius for COMPACTED_TYPICAL_GAP; otherwise it is left alone.
 */
function compactionFactor(centres: readonly {readonly x: number; readonly y: number}[], boxes: readonly Box[]): number {
    if (boxes.length < 2) return 1;
    const cx: number = centres.reduce((sum, c) => sum + c.x, 0) / centres.length;
    const cy: number = centres.reduce((sum, c) => sum + c.y, 0) / centres.length;
    const spread: number = median(centres.map((c) => Math.hypot(c.x - cx, c.y - cy)));
    const typicalSize: number = median(boxes.map((b: Box): number => Math.max(b.x2 - b.x1, b.y2 - b.y1)));
    const root: number = Math.sqrt(boxes.length);
    if (spread <= root * (typicalSize + MAX_TYPICAL_GAP)) return 1;
    return (root * (typicalSize + COMPACTED_TYPICAL_GAP)) / spread;
}

function tidyGroup(nodes: readonly TidyNode[], spacing: number): TidiedGroup {
    // Tidy each folder's contents first; the folder then takes part as one box.
    const items: {readonly node: TidyNode; readonly box: Box; readonly inner: ReadonlyMap<string, TidyMove>}[] = [];
    for (const node of nodes) {
        if (node.kind === 'leaf') {
            items.push({
                node,
                box: {x1: node.x - node.width / 2, y1: node.y - node.height / 2, x2: node.x + node.width / 2, y2: node.y + node.height / 2},
                inner: new Map([[node.id, {dx: 0, dy: 0}]]),
            });
            continue;
        }
        const tidied: TidiedGroup = tidyGroup(node.children, spacing);
        if (tidied.box === null) continue;
        const p: number = node.padding;
        items.push({
            node,
            box: {x1: tidied.box.x1 - p, y1: tidied.box.y1 - p, x2: tidied.box.x2 + p, y2: tidied.box.y2 + p},
            inner: tidied.moves,
        });
    }

    const centres: readonly {readonly x: number; readonly y: number}[] = items.map((item) => ({
        x: (item.box.x1 + item.box.x2) / 2,
        y: (item.box.y1 + item.box.y2) / 2,
    }));
    const factor: number = compactionFactor(centres, items.map((item) => item.box));
    const centroidX: number = centres.reduce((sum, c) => sum + c.x, 0) / Math.max(1, centres.length);
    const centroidY: number = centres.reduce((sum, c) => sum + c.y, 0) / Math.max(1, centres.length);

    const rects: OverlapRect[] = items.map((item, index): OverlapRect => ({
        id: String(index),
        x: centroidX + (centres[index].x - centroidX) * factor,
        y: centroidY + (centres[index].y - centroidY) * factor,
        width: item.box.x2 - item.box.x1,
        height: item.box.y2 - item.box.y1,
        movable: true,
    }));
    const resolved = removeRectangularOverlaps(rects, spacing);

    const moves: Map<string, TidyMove> = new Map();
    const boxes: Box[] = [];
    items.forEach((item, index): void => {
        const placed = resolved.find((position): boolean => position.id === String(index));
        const dx: number = (placed ? placed.x : rects[index].x) - centres[index].x;
        const dy: number = (placed ? placed.y : rects[index].y) - centres[index].y;
        for (const [leafId, inner] of item.inner) moves.set(leafId, {dx: inner.dx + dx, dy: inner.dy + dy});
        boxes.push({x1: item.box.x1 + dx, y1: item.box.y1 + dy, x2: item.box.x2 + dx, y2: item.box.y2 + dy});
    });
    return {moves, box: union(boxes)};
}

/**
 * How far to move each leaf so that no two siblings overlap (with `spacing`
 * between them), at every folder level, moving things as little as possible.
 */
export function computeGentleTidy(roots: readonly TidyNode[], spacing: number): ReadonlyMap<string, TidyMove> {
    return tidyGroup(roots, spacing).moves;
}
