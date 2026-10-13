/**
 * FolderResizeController — keeps EXPANDED folder compounds behaving like boxes
 * the user owns, a sibling concern to the chip strip in FolderHandleService.
 *
 * Frames. A cytoscape compound's box is derived from its children, so by default
 * it shifts whenever a child moves. Once the user touches a folder (drags a node
 * in it, drags one of its edges, or moves it), the folder's body rectangle is
 * pinned as its FRAME, and every child move re-solves the compound's min-size +
 * bias so the body is drawn at exactly that frame (folderResize.ts has the
 * maths). A frame only changes when the user resizes or moves the folder, or
 * pushes a child through an edge — it then grows to keep containing it.
 *
 * Grips. One overlay per expanded folder; eight invisible hit zones (four edges +
 * four corners) anchored to the folder body, each with its directional cursor.
 * Grip thickness is constant screen px so the target stays easy to hit at any
 * zoom. Dragging a grip moves only that grip's edges, 1:1 with the pointer; on
 * mouseup the size is persisted keyed by the folder's DIRECTORY id via the
 * unified write-node-layout channel.
 *
 * Moving. beginMove drags the whole folder: its nodes and its frame (and the
 * frames of the folders inside it) translate together.
 *
 * Collapsed pills are fixed-size and never get a frame.
 */
import type {Core, EventObject, NodeCollection, NodeSingular} from 'cytoscape';
import type cytoscape from 'cytoscape';

import {
    ALL_RESIZE_HANDLES,
    compoundSizingForFrame,
    growFrameToContain,
    resizeFrame,
    type FrameRect,
    type ResizeHandle,
} from '@/shell/UI/cytoscape-graph-ui/services/folder-handle/folderResize';
import {loadFolderFrames, saveFolderFrames} from '@/shell/UI/cytoscape-graph-ui/services/folder-handle/folderFrameStore';

const RESIZE_STYLE_TAG_ID = 'vt-folder-resize-style';
const FRAME_CLASS = 'vt-folder-resize-frame';
const GRIP_CLASS = 'vt-folder-resize-grip';
const GRIP_PX = 12;

// Folder BODY box (no label, no overlays) — same convention as the chip strip
// and the folder-handle e2e specs, so the frame hugs the drawn folder body.
const BODY_BBOX_OPTIONS: cytoscape.BoundingBoxOptions = {
    includeLabels: false,
    includeOverlays: false,
};

// What cytoscape sizes a compound around: its children's bodies, labels excluded
// (the folder rule sets compound-sizing-wrt-labels: exclude).
const CONTENT_BBOX_OPTIONS: cytoscape.BoundingBoxOptions = {
    includeLabels: false,
    includeOverlays: false,
    includeUnderlays: false,
};

const FRAME_STYLE_PROPERTIES: string =
    'min-width min-height min-width-bias-left min-width-bias-right min-height-bias-top min-height-bias-bottom';

const GRIP_CURSOR: Record<ResizeHandle, string> = {
    n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
    ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize',
};

export interface FolderResizeController {
    /** Create a frame for an expanded folder, or remove it if the folder is collapsed/gone. */
    ensure(folderId: string): void;
    position(folderId: string): void;
    positionAll(): void;
    destroy(folderId: string): void;
    /** Drag the whole folder — its nodes move with it — following the pointer from `startEvent`. */
    beginMove(folderId: string, startEvent: MouseEvent): void;
}

interface FrameEntry {
    readonly el: HTMLDivElement;
    readonly grips: ReadonlyMap<ResizeHandle, HTMLDivElement>;
}

/** A folder's children bbox plus the padding + border between it and the body edge. */
interface FolderGeometry {
    readonly content: FrameRect;
    readonly inset: number;
}

function injectResizeStylesheet(): void {
    if (document.getElementById(RESIZE_STYLE_TAG_ID) !== null) return;
    const style: HTMLStyleElement = document.createElement('style');
    style.id = RESIZE_STYLE_TAG_ID;
    style.textContent = `
.${FRAME_CLASS} { position: absolute; pointer-events: none; z-index: 5; }
.${GRIP_CLASS} { position: absolute; pointer-events: auto; background: transparent; -webkit-app-region: no-drag; }
`;
    document.head.appendChild(style);
}

// Lay a grip out within the frame (frame is sized to the folder body box, so
// offsets are relative to its top-left). Edges span their side minus the corner
// gutters; corners sit on top at the four extremities.
function layoutGrip(grip: HTMLDivElement, handle: ResizeHandle): void {
    const s: string = `${GRIP_PX}px`;
    const half: string = `-${GRIP_PX / 2}px`;
    grip.style.cursor = GRIP_CURSOR[handle];
    for (const prop of ['left', 'right', 'top', 'bottom', 'width', 'height'] as const) grip.style[prop] = '';
    if (handle.length === 2) {
        grip.style.width = s;
        grip.style.height = s;
        grip.style.zIndex = '1';
        grip.style[handle.includes('n') ? 'top' : 'bottom'] = half;
        grip.style[handle.includes('w') ? 'left' : 'right'] = half;
        return;
    }
    if (handle === 'n' || handle === 's') {
        grip.style.left = s;
        grip.style.right = s;
        grip.style.height = s;
        grip.style[handle === 'n' ? 'top' : 'bottom'] = half;
    } else {
        grip.style.top = s;
        grip.style.bottom = s;
        grip.style.width = s;
        grip.style[handle === 'w' ? 'left' : 'right'] = half;
    }
}

function isExpandedFolder(node: cytoscape.CollectionReturnValue): boolean {
    return node.length > 0 && node.data('isFolderNode') === true && node.data('collapsed') !== true;
}

function toFrameRect(bbox: cytoscape.BoundingBox12): FrameRect {
    return {x1: bbox.x1, y1: bbox.y1, x2: bbox.x2, y2: bbox.y2};
}

/** Follow the pointer from `startEvent` until mouseup, reporting its travel in graph units. */
function trackPointerDrag(
    cy: Core,
    startEvent: MouseEvent,
    onDrag: (graphDx: number, graphDy: number) => void,
    onEnd: () => void,
): void {
    // Coalesce mousemoves to one rAF tick: raw mousemove can fire faster than the
    // display refresh, and each step restyles the folder, its descendants and its
    // parents.
    let pending: {readonly dx: number; readonly dy: number} | null = null;
    let rafId: number | null = null;

    const flush = (): void => {
        rafId = null;
        if (pending === null) return;
        const travel: {readonly dx: number; readonly dy: number} = pending;
        pending = null;
        onDrag(travel.dx, travel.dy);
    };

    const onMove = (evt: MouseEvent): void => {
        const zoom: number = cy.zoom() > 0 ? cy.zoom() : 1;
        pending = {
            dx: (evt.clientX - startEvent.clientX) / zoom,
            dy: (evt.clientY - startEvent.clientY) / zoom,
        };
        rafId ??= window.requestAnimationFrame(flush);
    };

    const onUp = (): void => {
        window.removeEventListener('mousemove', onMove, {capture: true});
        if (rafId !== null) {
            window.cancelAnimationFrame(rafId);
            flush();
        }
        onEnd();
    };

    window.addEventListener('mousemove', onMove, {capture: true});
    window.addEventListener('mouseup', onUp, {capture: true, once: true});
    startEvent.preventDefault();
    startEvent.stopPropagation();
}

export function setupFolderResize(
    cy: Core,
    overlay: HTMLElement,
): FolderResizeController {
    injectResizeStylesheet();
    const frames: Map<string, FrameEntry> = new Map();

    // ---- Pinned frames -------------------------------------------------
    /** Folder id → the body rectangle the user has given it (graph units). */
    const pinnedFrames: Map<string, FrameRect> = new Map();
    /** Frames from earlier sessions, restored as each folder (and its children) appears. */
    const savedFrames: Map<string, FrameRect> = loadFolderFrames();
    /** True while frames are being moved wholesale; child moves must not re-solve them mid-way. */
    let framesSuspended: boolean = false;

    function measure(folder: NodeSingular): FolderGeometry | null {
        const children: NodeCollection = folder.children();
        if (children.length === 0) return null;
        const content: cytoscape.BoundingBox12 & cytoscape.BoundingBoxWH = children.boundingBox(CONTENT_BBOX_OPTIONS);
        const body: cytoscape.BoundingBoxWH = folder.boundingBox(BODY_BBOX_OPTIONS);
        // The body is the children bbox, widened to the min-width floor, plus
        // padding + border on each side; recover that per-side inset.
        const minWidth: number = parseFloat(folder.style('min-width') as string) || 0;
        return {content: toFrameRect(content), inset: (body.w - Math.max(content.w, minWidth)) / 2};
    }

    /** Draw the folder at its pinned frame, growing the frame if a child has left it. */
    function applyPinnedFrame(folderId: string): void {
        const pinned: FrameRect | undefined = pinnedFrames.get(folderId);
        if (pinned === undefined) return;
        const node: cytoscape.CollectionReturnValue = cy.getElementById(folderId);
        if (!isExpandedFolder(node)) return;
        const geometry: FolderGeometry | null = measure(node as NodeSingular);
        if (geometry === null) return;

        const frame: FrameRect = growFrameToContain(pinned, geometry.content, geometry.inset);
        pinnedFrames.set(folderId, frame);
        node.style(compoundSizingForFrame(frame, geometry.content, geometry.inset));
        position(folderId);
    }

    /** Pin a folder at the rectangle it is currently drawn at (no-op if already pinned). */
    function pin(folderId: string): void {
        if (pinnedFrames.has(folderId)) return;
        const node: cytoscape.CollectionReturnValue = cy.getElementById(folderId);
        if (!isExpandedFolder(node) || node.children().length === 0) return;
        pinnedFrames.set(folderId, toFrameRect((node as NodeSingular).boundingBox(BODY_BBOX_OPTIONS)));
    }

    /** Re-pin a folder at the frame the user gave it in an earlier session. */
    function restoreSavedFrame(folderId: string): void {
        if (pinnedFrames.has(folderId)) return;
        const saved: FrameRect | undefined = savedFrames.get(folderId);
        if (saved === undefined) return;
        const node: cytoscape.CollectionReturnValue = cy.getElementById(folderId);
        // A folder is added before its children; wait until they are in.
        if (!isExpandedFolder(node) || node.children().length === 0) return;
        pinnedFrames.set(folderId, saved);
        applyPinnedFrame(folderId);
    }

    /** Remember the current frames of these folders for the next session. */
    function rememberFrames(folderIds: readonly string[]): void {
        for (const id of folderIds) {
            const frame: FrameRect | undefined = pinnedFrames.get(id);
            if (frame !== undefined) savedFrames.set(id, frame);
        }
        saveFolderFrames(savedFrames);
    }

    function unpin(folderId: string): void {
        if (!pinnedFrames.delete(folderId)) return;
        const node: cytoscape.CollectionReturnValue = cy.getElementById(folderId);
        if (node.length > 0) node.removeStyle(FRAME_STYLE_PROPERTIES);
    }

    /** Expanded folders containing `node`, nearest first. */
    function enclosingFolderIds(node: NodeSingular): string[] {
        const ids: string[] = [];
        for (let parent: NodeCollection = node.parent(); parent.length > 0; parent = parent.parent()) {
            if (isExpandedFolder(parent)) ids.push(parent.id());
        }
        return ids;
    }

    // Grabbing a node pins every folder around it, so the boxes hold still for
    // the drag instead of sliding with the node.
    cy.on('grab', 'node', (evt: EventObject): void => {
        for (const folderId of enclosingFolderIds(evt.target as NodeSingular)) pin(folderId);
    });

    // A node moved: re-solve each enclosing pinned folder, innermost first, since
    // an outer folder's content includes the inner folder's box.
    cy.on('position', 'node', (evt: EventObject): void => {
        if (framesSuspended) return;
        // Restyling a folder must not re-enter through any event it raises.
        framesSuspended = true;
        try {
            for (const folderId of enclosingFolderIds(evt.target as NodeSingular)) applyPinnedFrame(folderId);
        } finally {
            framesSuspended = false;
        }
    });

    function position(folderId: string): void {
        const entry: FrameEntry | undefined = frames.get(folderId);
        if (entry === undefined) return;
        const node: cytoscape.CollectionReturnValue = cy.getElementById(folderId);
        if (node.length === 0) return;
        const bbox: cytoscape.BoundingBox12 & cytoscape.BoundingBoxWH =
            (node as NodeSingular).renderedBoundingBox(BODY_BBOX_OPTIONS);
        entry.el.style.left = `${bbox.x1}px`;
        entry.el.style.top = `${bbox.y1}px`;
        entry.el.style.width = `${bbox.w}px`;
        entry.el.style.height = `${bbox.h}px`;
    }

    function beginResize(folderId: string, handle: ResizeHandle, startEvent: MouseEvent): void {
        const node: cytoscape.CollectionReturnValue = cy.getElementById(folderId);
        if (!isExpandedFolder(node)) return;
        pin(folderId);
        const startFrame: FrameRect | undefined = pinnedFrames.get(folderId);
        if (startFrame === undefined) return;
        // The folders around this one hold still while it grows inside them.
        for (const enclosingId of enclosingFolderIds(node as NodeSingular)) pin(enclosingId);

        trackPointerDrag(
            cy,
            startEvent,
            (graphDx: number, graphDy: number): void => {
                const geometry: FolderGeometry | null = measure(node as NodeSingular);
                if (geometry === null) return;
                pinnedFrames.set(
                    folderId,
                    resizeFrame(startFrame, handle, graphDx, graphDy, geometry.content, geometry.inset),
                );
                applyPinnedFrame(folderId);
                for (const enclosingId of enclosingFolderIds(node as NodeSingular)) applyPinnedFrame(enclosingId);
            },
            (): void => { persistLayout([folderId, ...enclosingFolderIds(node as NodeSingular)]); },
        );
    }

    /** Save the given folders' frames and sizes, and every node position. */
    function persistLayout(folderIds: readonly string[]): void {
        rememberFrames(folderIds);
        for (const id of folderIds) void persistSize(id);
        void window.hostAPI?.main.saveNodePositions(cy.nodes().jsons() as cytoscape.NodeDefinition[]);
    }

    function beginMove(folderId: string, startEvent: MouseEvent): void {
        const node: cytoscape.CollectionReturnValue = cy.getElementById(folderId);
        if (node.length === 0) return;
        const folder: NodeSingular = node as NodeSingular;

        // Everything with a position of its own: the folder's leaf descendants
        // (compounds are positioned by their children), or the pill itself.
        const descendants: NodeCollection = folder.descendants();
        const movers: NodeCollection = descendants.length > 0
            ? descendants.filter((n: NodeSingular): boolean => !n.isParent())
            : folder;
        const startPositions: Map<string, cytoscape.Position> = new Map();
        movers.forEach((n: NodeSingular): void => { startPositions.set(n.id(), {...n.position()}); });

        // The folder and the folders inside it travel as one; the folders around
        // it hold still. Deepest first, since each box contains the ones inside it.
        const travellingIds: string[] = [folderId, ...descendants.filter((n: NodeSingular): boolean => n.isParent()).map((n: NodeSingular): string => n.id())]
            .filter((id: string): boolean => isExpandedFolder(cy.getElementById(id)))
            .sort((a: string, b: string): number => b.length - a.length);
        for (const id of travellingIds) pin(id);
        const startFrames: Map<string, FrameRect> = new Map();
        for (const id of travellingIds) {
            const frame: FrameRect | undefined = pinnedFrames.get(id);
            if (frame !== undefined) startFrames.set(id, frame);
        }
        const enclosingIds: string[] = enclosingFolderIds(folder);
        for (const id of enclosingIds) pin(id);

        trackPointerDrag(
            cy,
            startEvent,
            (graphDx: number, graphDy: number): void => {
                framesSuspended = true;
                cy.batch((): void => {
                    movers.forEach((n: NodeSingular): void => {
                        const start: cytoscape.Position | undefined = startPositions.get(n.id());
                        if (start !== undefined) n.position({x: start.x + graphDx, y: start.y + graphDy});
                    });
                });
                framesSuspended = false;
                for (const [id, frame] of startFrames) {
                    pinnedFrames.set(id, {
                        x1: frame.x1 + graphDx, y1: frame.y1 + graphDy,
                        x2: frame.x2 + graphDx, y2: frame.y2 + graphDy,
                    });
                }
                for (const id of travellingIds) applyPinnedFrame(id);
                for (const id of enclosingIds) applyPinnedFrame(id);
            },
            (): void => { persistLayout([...travellingIds, ...enclosingIds]); },
        );
    }

    async function persistSize(folderId: string): Promise<void> {
        const node: cytoscape.CollectionReturnValue = cy.getElementById(folderId);
        if (node.length === 0) return;
        // Folder size is owned by the directory id (the compound is not a graph
        // node, and a folder need not have a note). It is persisted as the
        // compound's min-size — the same value the stylesheet reapplies on load —
        // through the unified spatial-layout channel.
        const width: number = parseFloat(node.style('min-width') as string) || 0;
        const height: number = parseFloat(node.style('min-height') as string) || 0;
        if (width <= 0 || height <= 0) return;
        await window.hostAPI?.main.saveNodeSize(folderId, {width, height});
    }

    function createFrame(folderId: string): void {
        if (frames.has(folderId)) return;
        const el: HTMLDivElement = document.createElement('div');
        el.className = FRAME_CLASS;
        el.dataset.folderId = folderId;
        const grips: Map<ResizeHandle, HTMLDivElement> = new Map();
        for (const handle of ALL_RESIZE_HANDLES) {
            const grip: HTMLDivElement = document.createElement('div');
            grip.className = GRIP_CLASS;
            layoutGrip(grip, handle);
            grip.addEventListener('mousedown', (evt: MouseEvent): void => {
                if (evt.button !== 0) return;
                beginResize(folderId, handle, evt);
            });
            el.appendChild(grip);
            grips.set(handle, grip);
        }
        overlay.appendChild(el);
        frames.set(folderId, {el, grips});
        position(folderId);
    }

    function destroy(folderId: string): void {
        unpin(folderId);
        const entry: FrameEntry | undefined = frames.get(folderId);
        if (entry === undefined) return;
        entry.el.remove();
        frames.delete(folderId);
    }

    function ensure(folderId: string): void {
        if (isExpandedFolder(cy.getElementById(folderId))) {
            createFrame(folderId);
            restoreSavedFrame(folderId);
        } else {
            destroy(folderId);
        }
    }

    function positionAll(): void {
        // Also the catch-up point for saved frames: a folder is added before its
        // children, and a frame can only be restored once they are in.
        for (const folderId of frames.keys()) {
            restoreSavedFrame(folderId);
            position(folderId);
        }
    }

    // A dropped node may have pushed a box edge out: save the boxes around it.
    cy.on('free', 'node', (evt: EventObject): void => {
        const folderIds: string[] = enclosingFolderIds(evt.target as NodeSingular);
        rememberFrames(folderIds);
        for (const folderId of folderIds) void persistSize(folderId);
    });

    return {ensure, position, positionAll, destroy, beginMove};
}
