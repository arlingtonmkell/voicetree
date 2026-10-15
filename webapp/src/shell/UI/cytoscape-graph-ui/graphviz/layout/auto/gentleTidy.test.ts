// Black-box contract for the gentle tidy: overlapping siblings come apart, nodes
// with room stay exactly where they are, and a folder's contents move as one.
import { describe, it, expect } from 'vitest'
import { computeGentleTidy, type TidyNode } from './gentleTidy'

type TidyMove = { readonly dx: number; readonly dy: number }

const leaf = (id: string, x: number, y: number, size: number = 40): TidyNode =>
    ({ kind: 'leaf', id, x, y, width: size, height: size })

const moveOf = (moves: ReadonlyMap<string, TidyMove>, id: string): TidyMove => moves.get(id) ?? { dx: 0, dy: 0 }

const separated = (a: { x: number; y: number }, b: { x: number; y: number }, size: number, spacing: number): boolean =>
    Math.abs(a.x - b.x) >= size + spacing - 1e-6 || Math.abs(a.y - b.y) >= size + spacing - 1e-6

describe('computeGentleTidy', () => {
    it('leaves nodes that already have room, and are not spread out, exactly where they are', () => {
        const moves = computeGentleTidy([leaf('a', 0, 0), leaf('b', 200, 0), leaf('c', 0, 200)], 20)
        for (const id of ['a', 'b', 'c']) expect(moveOf(moves, id)).toEqual({ dx: 0, dy: 0 })
    })

    it('pushes overlapping nodes apart by just enough', () => {
        const moves = computeGentleTidy([leaf('a', 0, 0), leaf('b', 10, 0)], 20)
        const a = { x: 0 + moveOf(moves, 'a').dx, y: 0 + moveOf(moves, 'a').dy }
        const b = { x: 10 + moveOf(moves, 'b').dx, y: 0 + moveOf(moves, 'b').dy }
        expect(separated(a, b, 40, 20)).toBe(true)
        // Minimal: the pair needed 50 more units of separation; neither travels far.
        expect(Math.abs(moveOf(moves, 'a').dx) + Math.abs(moveOf(moves, 'b').dx)).toBeLessThanOrEqual(51)
    })

    it('moves a folder\'s contents together when the folder is pushed', () => {
        const folder: TidyNode = { kind: 'folder', id: 'f', padding: 25, children: [leaf('in1', 0, 0), leaf('in2', 200, 0)] }
        const moves = computeGentleTidy([folder, leaf('outside', 100, 10)], 20)
        expect(moveOf(moves, 'in1')).toEqual(moveOf(moves, 'in2'))
        // ...and the outside node ends up clear of the folder box (x -45..245, y -45..45).
        const o = { x: 100 + moveOf(moves, 'outside').dx, y: 10 + moveOf(moves, 'outside').dy }
        const shift = moveOf(moves, 'in1')
        const clearX = o.x + 20 <= -45 + shift.dx - 20 || o.x - 20 >= 245 + shift.dx + 20
        const clearY = o.y + 20 <= -45 + shift.dy - 20 || o.y - 20 >= 45 + shift.dy + 20
        expect(clearX || clearY).toBe(true)
    })

    it('separates overlapping nodes inside a folder without moving the folder\'s neighbours', () => {
        const folder: TidyNode = { kind: 'folder', id: 'f', padding: 25, children: [leaf('in1', 0, 0), leaf('in2', 5, 0)] }
        const moves = computeGentleTidy([folder, leaf('far', 300, 0)], 20)
        expect(moveOf(moves, 'far')).toEqual({ dx: 0, dy: 0 })
        const a = { x: moveOf(moves, 'in1').dx, y: moveOf(moves, 'in1').dy }
        const b = { x: 5 + moveOf(moves, 'in2').dx, y: moveOf(moves, 'in2').dy }
        expect(separated(a, b, 40, 20)).toBe(true)
    })

    it('draws a spread-out group together without changing its arrangement', () => {
        // Three nodes 5000 apart in an L: far beyond a comfortable gap.
        const moves = computeGentleTidy([leaf('a', 0, 0), leaf('b', 5000, 0), leaf('c', 0, 5000)], 20)
        const at = (id: string, x: number, y: number) => ({ x: x + moveOf(moves, id).dx, y: y + moveOf(moves, id).dy })
        const a = at('a', 0, 0), b = at('b', 5000, 0), c = at('c', 0, 5000)
        // Much closer...
        expect(b.x - a.x).toBeLessThan(1000)
        expect(c.y - a.y).toBeLessThan(1000)
        // ...same shape: b still due east of a, c still due south of a, same proportions.
        expect(b.y).toBeCloseTo(a.y, 6)
        expect(c.x).toBeCloseTo(a.x, 6)
        expect((b.x - a.x) / (c.y - a.y)).toBeCloseTo(1, 6)
        // ...and still clear of one another.
        expect(separated(a, b, 40, 20)).toBe(true)
    })

    it('draws in tight clusters that sit far apart from each other', () => {
        // Two close pairs, 10000 apart: each node has a near neighbour, the group is still sprawling.
        const moves = computeGentleTidy([leaf('a1', 0, 0), leaf('a2', 80, 0), leaf('b1', 10000, 0), leaf('b2', 10080, 0)], 20)
        const x = (id: string, x0: number): number => x0 + moveOf(moves, id).dx
        expect(x('b1', 10000) - x('a1', 0)).toBeLessThan(1500)
        expect(x('a2', 80)).toBeGreaterThan(x('a1', 0))
        expect(x('b1', 10000)).toBeGreaterThan(x('a2', 80))
    })

    it('ignores empty folders', () => {
        expect(computeGentleTidy([{ kind: 'folder', id: 'empty', padding: 25, children: [] }], 20).size).toBe(0)
    })
})
