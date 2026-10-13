import type {Core} from 'cytoscape';
import type cytoscape from 'cytoscape';
import * as O from 'fp-ts/lib/Option.js';

import { getFolderNotePath } from '@vt/graph-model';
import { getLayout } from '@vt/graph-state/state/layoutStore';

import type {NodeIdAndFilePath} from '@vt/graph-model/graph';
import {applyAnchoredEditorOpenStyle, applyAnchoredEditorCloseStyle} from './anchoredEditorVisualStyle';
import type {EditorData} from '@/shell/edge/UI-edge/state/stores/UIAppState';
import {addToAutoPinQueue, getEditorByNodeId} from '@/shell/edge/UI-edge/state/stores/EditorStore';
import {setPendingEditorFocusPan} from '@/shell/edge/UI-edge/state/stores/PendingPanStore';
import {updateWindowFromZoom} from '@/shell/edge/UI-edge/floating-windows/chrome/update-window-from-zoom';
import {updateShadowNodeDimensions} from '@/shell/edge/UI-edge/floating-windows/chrome/setup-resize-observer';
import {cleanupRegistry} from '@/shell/edge/UI-edge/floating-windows/anchoring/cytoscape-floating-windows';
import {attachWindowDrag, moveNodeDragBehaviour, type WindowDragBehaviour} from '@/shell/edge/UI-edge/floating-windows/anchoring/anchor-to-node';
import {removeEditorTether} from '@/shell/edge/UI-edge/floating-windows/chrome/editor-tether';
import {markNodeDirty} from '@/shell/UI/cytoscape-graph-ui/graphviz/layout/auto/autoLayout';
import {cySmartCenter} from '@/utils/responsivePadding';
import {closeEditor, createFloatingEditor} from './FloatingEditorCRUD';

// =============================================================================
// Create Anchored Floating Editor
// =============================================================================

/**
 * Create a floating editor window anchored to the real Cy node.
 * Hides the node circle and positions the editor DOM on top of it.
 *
 * @param cy - Cytoscape instance
 * @param nodeId - ID of the node to edit
 * @param focusAtEnd - If true, focus editor with cursor at end of content (for new nodes)
 * @param isAutoPin - If true, this is an auto-pinned editor (for new nodes) that will be
 *                    auto-closed when the next new node is created
 * @param isAgentNode - If true, node was created by an agent. Agent nodes bypass the
 *                      auto-pin queue and remain open until manually closed.
 */
export async function createAnchoredFloatingEditor(
    cy: Core,
    nodeId: NodeIdAndFilePath,
    focusAtEnd: boolean = false,
    isAutoPin: boolean = false,
    isAgentNode: boolean = false
): Promise<void> {
    try {
        // If editor already exists, center viewport on it and return
        const existingEditor: O.Option<EditorData> = getEditorByNodeId(nodeId);
        if (O.isSome(existingEditor)) {
            navigateToEditorNeighborhood(cy, nodeId);
            return;
        }

        let editorContentNodeId: NodeIdAndFilePath = nodeId;
        if (nodeId.endsWith('/')) {
            const graph = await window.hostAPI?.main.getGraph();
            const folderNoteId: NodeIdAndFilePath | undefined = graph
                ? getFolderNotePath(graph, nodeId)
                : undefined;
            if (folderNoteId) {
                editorContentNodeId = folderNoteId;
            }
        }

        const existingResolvedEditor: O.Option<EditorData> = getEditorByNodeId(editorContentNodeId);
        if (O.isSome(existingResolvedEditor)) {
            navigateToEditorNeighborhood(cy, nodeId);
            return;
        }

        // Create floating editor window with anchoredToNodeId set
        const editor: EditorData | undefined = await createFloatingEditor(
            cy,
            editorContentNodeId,
            nodeId, // Anchor to the clicked node, including folder cy nodes
            focusAtEnd
        );

        // Return early if editor already exists
        if (!editor) {
            //console.log('[FloatingEditorManager-v2] Editor already exists');
            return;
        }

        // FIFO auto-pin: add to queue, close oldest if over limit
        // Agent nodes bypass the queue entirely - they remain open until manually closed
        if (isAutoPin && !isAgentNode) {
            const oldestToClose: NodeIdAndFilePath | null = addToAutoPinQueue(editorContentNodeId);
            if (oldestToClose !== null) {
                const oldestEditor: O.Option<EditorData> = getEditorByNodeId(oldestToClose);
                if (O.isSome(oldestEditor)) {
                    closeEditor(cy, oldestEditor.value);
                }
            }
        }

        // Anchor editor to the real Cy node (hide circle, sync dimensions)
        anchorEditorToRealNode(cy, editor, nodeId);

        // Pan to real node after layout completes (center on node only, not neighbors)
        setPendingEditorFocusPan(nodeId);

    } catch (error) {
        console.error('[FloatingEditorManager-v2] Error creating floating editor:', error);
    }
}

/**
 * Navigate to editor neighborhood - pans if zoom is comfortable, zooms to 1.0 if not
 */
function navigateToEditorNeighborhood(cy: Core, nodeId: NodeIdAndFilePath): void {
    // [L2-seam-residual] cy-only: cy graph traversal (closedNeighborhood) not in layoutStore
    const contextNode: cytoscape.CollectionReturnValue = cy.getElementById(nodeId);
    if (contextNode.length === 0) return;
    const nodesToCenter: cytoscape.CollectionReturnValue = contextNode
        .closedNeighborhood().filter(ele => !ele.data('isFolderNode')) as cytoscape.CollectionReturnValue;
    cySmartCenter(cy, nodesToCenter);
}

// =============================================================================
// Real-Node Anchoring
// =============================================================================

/** Where an editor box sits relative to its node, in graph units. */
type BoxOffset = { readonly x: number; readonly y: number };

type BoxOrNodeDragStart =
    | { readonly kind: 'box'; readonly offset: BoxOffset }
    | { readonly kind: 'node'; readonly position: cytoscape.Position };

/** A box dropped within this distance of its node snaps back on top of it. */
const REATTACH_DISTANCE: number = 40;

function readBoxOffset(windowElement: HTMLElement): BoxOffset {
    return {
        x: parseFloat(windowElement.dataset.graphOffsetX ?? '0'),
        y: parseFloat(windowElement.dataset.graphOffsetY ?? '0'),
    };
}

/**
 * Anchor an editor to the real Cy node instead of creating a shadow child node.
 * Hides the Cy circle (opacity 0, keeps ellipse shape for edges), syncs DOM size
 * to Cy node dimensions via ResizeObserver, and registers cleanup to restore the
 * node on editor close.
 */
function anchorEditorToRealNode(cy: Core, editor: EditorData, nodeId: NodeIdAndFilePath): void {
    const windowElement: HTMLElement | undefined = editor.ui?.windowElement;
    if (!windowElement) return;

    // Point the window at the real node (reuses the shadow node positioning system)
    windowElement.dataset.shadowNodeId = nodeId;

    // Initial position sync
    updateWindowFromZoom(cy, windowElement, getLayout().zoom ?? 1);

    // Hide the Cy circle — keep ellipse shape so edges stay rendered.
    // No-op for folder compound nodes (their bbox is the entire children area).
    const cyNode: cytoscape.CollectionReturnValue = cy.getElementById(nodeId);
    applyAnchoredEditorOpenStyle(cyNode);
    // A folder's "node" is the whole compound area, so its box is not detached from it.
    const isFolderAnchor: boolean = cyNode.data('isFolderNode') === true;
    if (!isFolderAnchor) windowElement.classList.add('covers-its-node');

    // The box starts on top of its node (the node takes the box's size and hides).
    // Dragging either one away detaches them: the node becomes a normal, draggable
    // circle again and the box stays where it was put, joined to the node by a
    // tether. Once detached the two move independently — moving the node (by hand
    // or by layout) leaves the box in place.
    const isDetached: () => boolean = (): boolean => windowElement.dataset.tethered === 'true';
    /** The detached box's own position in graph coordinates; null while it sits on its node. */
    let boxPosition: cytoscape.Position | null = null;
    const writeBoxOffset: (offset: BoxOffset) => void = (offset: BoxOffset): void => {
        windowElement.dataset.graphOffsetX = String(offset.x);
        windowElement.dataset.graphOffsetY = String(offset.y);
        updateWindowFromZoom(cy, windowElement, getLayout().zoom ?? 1);
    };
    const syncWindowToNode: () => void = (): void => {
        const nodePosition: cytoscape.Position = cyNode.position();
        writeBoxOffset(boxPosition === null
            ? {x: 0, y: 0}
            : {x: boxPosition.x - nodePosition.x, y: boxPosition.y - nodePosition.y});
    };
    /**
     * Put the box at `offset` from its node. With `snap`, an offset within
     * REATTACH_DISTANCE puts the box back on top of the node.
     */
    const setBoxOffset: (offset: BoxOffset, snap: boolean) => void = (offset: BoxOffset, snap: boolean): void => {
        const detach: boolean = !snap || Math.hypot(offset.x, offset.y) > REATTACH_DISTANCE;
        if (detach && !isDetached()) {
            windowElement.dataset.tethered = 'true';
            applyAnchoredEditorCloseStyle(cyNode);
        } else if (!detach && isDetached()) {
            delete windowElement.dataset.tethered;
            removeEditorTether(windowElement);
            applyAnchoredEditorOpenStyle(cyNode);
            updateShadowNodeDimensions(cyNode, windowElement);
        }
        const nodePosition: cytoscape.Position = cyNode.position();
        boxPosition = detach ? {x: nodePosition.x + offset.x, y: nodePosition.y + offset.y} : null;
        syncWindowToNode();
    };
    cyNode.on('position', syncWindowToNode);

    // ResizeObserver: sync DOM size → Cy node dimensions for Cola layout
    let resizeObserver: ResizeObserver | undefined;
    if (cyNode.length > 0 && typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver((): void => {
            // A detached box no longer stands in for its node, so the node keeps its own size.
            if (isDetached()) return;
            const oldW: number = cyNode.width();
            const oldH: number = cyNode.height();
            updateShadowNodeDimensions(cyNode, windowElement);
            const dimChanged: boolean = Math.abs(cyNode.width() - oldW) > 1 || Math.abs(cyNode.height() - oldH) > 1;
            if (dimChanged) {
                markNodeDirty(cy, nodeId);
            }
        });
        resizeObserver.observe(windowElement);
    }

    // Dragging the box's chrome moves the box alone. The node handle on the grip
    // pulls the node out from under the box instead, leaving the box where it is.
    // (A folder's box is never detached, so any drag moves the folder with its box.)
    const moveNode: WindowDragBehaviour<cytoscape.Position> = moveNodeDragBehaviour(cy, nodeId);
    let nodeWasPulledOut: boolean = false;
    const {handleMouseMove, handleMouseUp} = attachWindowDrag<BoxOrNodeDragStart>(windowElement, {
        begin: (pressed: Element) => {
            if (pressed.closest('.cy-floating-window-node-handle') === null && !isFolderAnchor) {
                return {kind: 'box', offset: readBoxOffset(windowElement)};
            }
            const nodeStart: cytoscape.Position | null = moveNode.begin(pressed);
            return nodeStart ? {kind: 'node', position: nodeStart} : null;
        },
        move: (start: BoxOrNodeDragStart, graphDx: number, graphDy: number) => {
            if (start.kind === 'box') {
                setBoxOffset({x: start.offset.x + graphDx, y: start.offset.y + graphDy}, true);
                return;
            }
            moveNode.move(start.position, graphDx, graphDy);
            if (!isFolderAnchor) {
                // The box holds its place: its offset is the node's travel, reversed.
                setBoxOffset({x: -graphDx, y: -graphDy}, false);
                nodeWasPulledOut = true;
            }
        },
        end: () => {
            // A node barely nudged out from under its box goes back under it.
            if (nodeWasPulledOut) setBoxOffset(readBoxOffset(windowElement), true);
            nodeWasPulledOut = false;
            moveNode.end();
        },
    });

    // Register cleanup in the shared registry so disposeFloatingWindow handles teardown
    const originalMenuCleanup: (() => void) | undefined = editor.ui?.menuCleanup;
    cleanupRegistry.set(windowElement, {
        dragMouseMove: handleMouseMove,
        dragMouseUp: handleMouseUp,
        resizeObserver,
        menuCleanup: (): void => {
            cyNode.off('position', syncWindowToNode);
            removeEditorTether(windowElement);
            // Restore Cy node to visible circle (no-op for folder compound nodes).
            const stillExists: boolean = cyNode.length > 0;
            const isFolder: boolean = stillExists && cyNode.data('isFolderNode') === true;
            applyAnchoredEditorCloseStyle(cyNode);
            if (stillExists && !isFolder) {
                markNodeDirty(cy, nodeId);
            }
            // Run original menu cleanup (floating slider)
            originalMenuCleanup?.();
        },
    });
}
