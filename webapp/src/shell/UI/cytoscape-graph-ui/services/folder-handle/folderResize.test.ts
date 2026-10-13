// Black-box contract for folder-box geometry: a frame stays where the user put it
// while its children move, grows only to keep containing them, and a grip moves
// only its own edges, 1:1 with the pointer.
import { describe, it, expect } from 'vitest'
import {
    compoundSizingForFrame,
    growFrameToContain,
    resizeFrame,
    type FrameRect,
} from './folderResize'

type CompoundSizing = ReturnType<typeof compoundSizingForFrame>

// The smallest a folder can be shrunk to, in graph units.
const MIN_FOLDER_WIDTH = 120
const MIN_FOLDER_HEIGHT = 80

const INSET = 25
const FRAME: FrameRect = { x1: 0, y1: 0, x2: 400, y2: 300 }
const CONTENT: FrameRect = { x1: 100, y1: 100, x2: 200, y2: 150 }

/**
 * What cytoscape draws for a compound, per its bounds update: the children bbox
 * widened to the min-* floor, the slack split by bias, then padded by `inset`.
 */
function drawnFrame(content: FrameRect, sizing: CompoundSizing, inset: number): FrameRect {
    const axis = (lo: number, hi: number, min: number, biasBefore: number, biasAfter: number): [number, number] => {
        const slack: number = Math.max(0, min - (hi - lo))
        const total: number = biasBefore + biasAfter
        const before: number = total > 0 ? slack * biasBefore / total : 0
        const after: number = total > 0 ? slack * biasAfter / total : 0
        return [lo - before - inset, hi + after + inset]
    }
    const [x1, x2] = axis(content.x1, content.x2, sizing['min-width'], sizing['min-width-bias-left'], sizing['min-width-bias-right'])
    const [y1, y2] = axis(content.y1, content.y2, sizing['min-height'], sizing['min-height-bias-top'], sizing['min-height-bias-bottom'])
    return { x1, y1, x2, y2 }
}

function expectFrameClose(actual: FrameRect, expected: FrameRect): void {
    for (const key of ['x1', 'y1', 'x2', 'y2'] as const) expect(actual[key]).toBeCloseTo(expected[key], 6)
}

describe('compoundSizingForFrame', () => {
    it('reproduces the frame for children anywhere inside it', () => {
        expectFrameClose(drawnFrame(CONTENT, compoundSizingForFrame(FRAME, CONTENT, INSET), INSET), FRAME)
    })

    it('keeps the frame fixed when the children move inside it', () => {
        const moved: FrameRect = { x1: 230, y1: 60, x2: 330, y2: 110 }
        expectFrameClose(drawnFrame(moved, compoundSizingForFrame(FRAME, moved, INSET), INSET), FRAME)
    })

    it('reproduces a frame its children fill exactly', () => {
        const tight: FrameRect = { x1: 75, y1: 75, x2: 225, y2: 175 }
        expectFrameClose(drawnFrame(CONTENT, compoundSizingForFrame(tight, CONTENT, INSET), INSET), tight)
    })
})

describe('growFrameToContain', () => {
    it('leaves a frame that already contains its children unchanged', () => {
        expect(growFrameToContain(FRAME, CONTENT, INSET)).toEqual(FRAME)
    })

    it('pushes out only the edge a child crossed', () => {
        const pushedEast: FrameRect = { x1: 350, y1: 100, x2: 450, y2: 150 }
        expect(growFrameToContain(FRAME, pushedEast, INSET)).toEqual({ ...FRAME, x2: 475 })
    })
})

describe('resizeFrame', () => {
    it('moves only the dragged edge, by exactly the pointer travel', () => {
        expect(resizeFrame(FRAME, 'e', 60, 999, CONTENT, INSET)).toEqual({ ...FRAME, x2: 460 })
        expect(resizeFrame(FRAME, 'n', 999, -30, CONTENT, INSET)).toEqual({ ...FRAME, y1: -30 })
    })

    it('a corner moves both of its edges and neither opposite edge', () => {
        expect(resizeFrame(FRAME, 'nw', -20, -10, CONTENT, INSET)).toEqual({ x1: -20, y1: -10, x2: 400, y2: 300 })
    })

    it('zero travel leaves the frame exactly where it was', () => {
        for (const handle of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const) {
            expect(resizeFrame(FRAME, handle, 0, 0, CONTENT, INSET)).toEqual(FRAME)
        }
    })

    it('an edge stops at the children instead of passing through them', () => {
        expect(resizeFrame(FRAME, 'e', -1000, 0, CONTENT, INSET).x2).toBe(CONTENT.x2 + INSET)
        expect(resizeFrame(FRAME, 'w', 1000, 0, CONTENT, INSET).x1).toBe(CONTENT.x1 - INSET)
    })

    it('grabbing an edge of a folder smaller than the minimum does not jump it to the minimum', () => {
        const tiny: FrameRect = { x1: 0, y1: 0, x2: 90, y2: 60 }
        const inside: FrameRect = { x1: 30, y1: 26, x2: 60, y2: 34 }
        for (const handle of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const) {
            expect(resizeFrame(tiny, handle, 0, 0, inside, INSET)).toEqual(tiny)
        }
    })

    it('an edge stops at the minimum folder size', () => {
        const small: FrameRect = { x1: 10, y1: 10, x2: 20, y2: 20 }
        const shrunk: FrameRect = resizeFrame(FRAME, 'se', -1000, -1000, small, 0)
        expect(shrunk.x2 - shrunk.x1).toBe(MIN_FOLDER_WIDTH)
        expect(shrunk.y2 - shrunk.y1).toBe(MIN_FOLDER_HEIGHT)
    })
})
