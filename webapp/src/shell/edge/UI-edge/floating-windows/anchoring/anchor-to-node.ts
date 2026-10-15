import type cytoscape from "cytoscape";
import {
    type EditorId,
    type FloatingWindowData,
    getFloatingWindowId,
    getShadowNodeId,
    type ImageViewerId,
    type ShadowNodeId,
    type TerminalId
} from "@/shell/edge/UI-edge/floating-windows/anchoring/types";
import * as O from "fp-ts/lib/Option.js";
import type {NodeIdAndFilePath} from "@vt/graph-model/graph";
import {
    readStoredStrategy,
    getWindowTransform,
    graphToScreenPosition,
    type ScalingStrategy
} from "@vt/graph-model/floating-windows";
import {cleanupRegistry} from "@/shell/edge/UI-edge/floating-windows/anchoring/cytoscape-floating-windows";
import {setupResizeObserver, updateShadowNodeDimensions} from "@/shell/edge/UI-edge/floating-windows/chrome/setup-resize-observer";
import {getEdgeDistance} from "@/shell/UI/cytoscape-graph-ui/graphviz/layout/viewport/cytoscape-graph-constants";
import {findBestPosition} from "@vt/graph-model/spatial";
import type {Obstacle} from "@vt/graph-model/spatial";
import {extractAllObstaclesFromCytoscape} from "@/shell/edge/UI-edge/floating-windows/anchoring/extractObstaclesFromCytoscape";
import type {SpatialIndex} from "@vt/graph-model/spatial";
import {extractFromSpatialIndex} from "@vt/graph-model/spatial";
import { getLayout } from '@vt/graph-state/state/layoutStore';
import { resolveVisibleAnchorNodeId } from "@/shell/edge/UI-edge/floating-windows/anchoring/resolve-visible-anchor-node-id";
import type {} from '@/shell/hostApi';

/**
 * Anchor a floating window to a parent node
 * Creates an invisible shadow node and sets up bidirectional position sync
 *
 * Requires: fw.ui must be populated (call createWindowChrome first)
 */
export function anchorToNode(
    cy: cytoscape.Core,
    fw: FloatingWindowData,
    spatialIndex?: SpatialIndex
): cytoscape.NodeSingular {
    // Validate ui is populated
    if (!fw.ui) {
        throw new Error('FloatingWindowData.ui must be populated before calling anchorToNode. Call createWindowChrome first.');
    }

    // Validate anchored
    if (!O.isSome(fw.anchoredToNodeId)) {
        throw new Error('Cannot anchor a floating window that has no anchoredToNodeId');
    }

    const logicalParentNodeId: NodeIdAndFilePath = fw.anchoredToNodeId.value;
    const parentNodeId: string = resolveVisibleAnchorNodeId(cy, logicalParentNodeId);
    const {windowElement} = fw.ui;

    //console.log('[anchorToNode-v2] Anchoring to parentNodeId:', parentNodeId);

    // [L2-seam-residual] cy-only: shadow-node parent lookup
    const parentNode: cytoscape.CollectionReturnValue = cy.getElementById(parentNodeId);
    if (parentNode.length === 0) {
        throw new Error(`Parent node "${logicalParentNodeId}" not found in graph. Cannot anchor floating window.`);
    }

    // Derive shadow node ID from the floating window data
    const fwId: EditorId | TerminalId | ImageViewerId = getFloatingWindowId(fw);
    const shadowNodeId: ShadowNodeId = getShadowNodeId(fwId);

    // Find best direction to spawn floating window based on available space and neighborhood
    const parentPos: cytoscape.Position = parentNode.position();
    const shadowDimensions: { width: number; height: number } = fw.shadowNodeDimensions;

    // Calculate desired angle using angle continuation heuristic:
    // Find the grandparent (task node) and continue the angle from task -> context -> terminal
    const incomingEdges: cytoscape.EdgeCollection = parentNode.incomers('edge').filter(
        (e: cytoscape.EdgeSingular) => !e.source().data('isShadowNode')
    );
    const desiredAngleDeg: number = incomingEdges.length > 0
        ? (Math.atan2(
            parentPos.y - incomingEdges[0].source().position().y,
            parentPos.x - incomingEdges[0].source().position().x
        ) * 180) / Math.PI
        : 0; // No grandparent (context node is root), default to right

    // Extract unified obstacles (nodes + edges) — spatial index (O(log n)) when available, otherwise cytoscape BFS (O(k))
    const obstacles: readonly Obstacle[] = spatialIndex
        ? extractFromSpatialIndex(spatialIndex, { x: parentPos.x, y: parentPos.y }, parentNodeId,
            getEdgeDistance(fw.type) * 3 + Math.max(shadowDimensions.width, shadowDimensions.height))
        : extractAllObstaclesFromCytoscape(cy, parentNodeId);
    const childPosition: import('@vt/graph-model/graph').Position = findBestPosition(
        { x: parentPos.x, y: parentPos.y },
        desiredAngleDeg,
        getEdgeDistance(fw.type),
        { width: shadowDimensions.width, height: shadowDimensions.height },
        obstacles,
        { parentWidth: parentNode.width(), parentHeight: parentNode.height(), gap: 20 },
    );

    // Create shadow node (follows parent position via listener below)
    // [L2-seam-residual] cy-only: shadow-node creation
    const shadowNode: cytoscape.CollectionReturnValue = cy.add({
        group: 'nodes',
        data: {
            id: shadowNodeId,
            parentId: parentNodeId,
            parentNodeId: parentNodeId,
            isFloatingWindow: true,
            isShadowNode: true,
            windowType: fw.type, // 'Terminal' or 'Editor' from V2 type system
            laidOut: false
        },
        position: childPosition
    });

    // Store shadow node ID on DOM element for drag handler
    windowElement.setAttribute('data-shadow-node-id', shadowNodeId);
    windowElement.dataset.shadowNodeId = shadowNodeId;

    // Shadow node dimensions come from fw.shadowNodeDimensions (already in graph coordinates)
    // Do NOT read from windowElement.offsetWidth/offsetHeight - the element may not be
    // in the DOM yet, causing a race condition where dimensions are 0.

    // Shadow node — invisible anchor for floating window positioning
    shadowNode.style({
        'opacity': 0,
        'background-color': '#333333',
        'border-width': 0,
        'border-color': 'transparent',
        'shape': 'rectangle',
        'events': 'yes',
        'width': shadowDimensions.width,
        'height': shadowDimensions.height
    });

    // Create edge from parent (task node) to shadow
    // [L2-seam-residual] cy-only: shadow-node edge creation
    cy.add({
        group: 'edges',
        data: {
            id: `edge-${parentNode.id()}-${shadowNode.id()}`,
            source: parentNode.id(),
            target: shadowNode.id(),
            // Note: NOT marked as isIndicatorEdge - this edge SHOULD affect Cola layout
            // to keep terminal positioned relative to its parent task node
        },
        classes: 'terminal-indicator'
    });

    // Force render to ensure edge appears immediately (not deferred until pan/zoom)
    // [L2-seam-residual] cy-only: shadow-node immediate render
    cy.forceRender();

    // Set up ResizeObserver (window resize → shadow dimensions)
    // Only triggers layout for user-initiated resizes, not zoom-induced resizes
    const resizeObserver: ResizeObserver | undefined = setupResizeObserver(cy, shadowNode, windowElement);

    // Set up position sync (shadow position → window position)
    const syncPosition: () => void = () => {
        updateWindowPosition(shadowNode, windowElement);
    };
    shadowNode.on('position', syncPosition);
    syncPosition(); // Initial sync

    // BUG: The code below was commented out because it introduced a bug where dragging the terminal
    // causes it to briefly teleport somewhere else. The feature was intended to make context nodes
    // attached to their terminal anchor/shadow node so that dragging the context node drags the terminal.
    // TODO: Fix and re-enable this feature
    /*
    // Track offset for parent sync (terminal follows context node when dragged)
    let currentOffset: { x: number; y: number } = {
        x: childPosition.x - parentPos.x,
        y: childPosition.y - parentPos.y
    };

    // Update offset when shadow node is dragged directly
    shadowNode.on('position', () => {
        const shadowPos: cytoscape.Position = shadowNode.position();
        const parentPosition: cytoscape.Position = parentNode.position();
        currentOffset = {
            x: shadowPos.x - parentPosition.x,
            y: shadowPos.y - parentPosition.y
        };
    });

    // Parent position sync: terminal follows context node at current offset
    const syncWithParent: () => void = () => {
        const newParentPos: cytoscape.Position = parentNode.position();
        shadowNode.position({
            x: newParentPos.x + currentOffset.x,
            y: newParentPos.y + currentOffset.y
        });
    };
    parentNode.on('position', syncWithParent);
    */

    // Attach drag handlers (only menu bar areas are draggable) and store cleanup references
    const {handleMouseMove, handleMouseUp} = attachDragHandlers(cy, windowElement, shadowNodeId);

    // Register cleanup functions
    cleanupRegistry.set(windowElement, {
        dragMouseMove: handleMouseMove,
        dragMouseUp: handleMouseUp,
        resizeObserver,
        // parentPositionHandler: syncWithParent, // BUG: commented out - see above
        menuCleanup: fw.ui?.menuCleanup,  // Destroys floating slider when editor closes
    });

    // Initial dimension sync
    requestAnimationFrame(() => {
        updateShadowNodeDimensions(shadowNode, windowElement);
    });

    return shadowNode;
}

// =============================================================================
// Position Sync Utilities
// =============================================================================

/**
 * Update window DOM element position based on shadow node position
 * Positions are scaled by zoom. Transform includes scale() when using CSS transform mode.
 */
function updateWindowPosition(shadowNode: cytoscape.NodeSingular, domElement: HTMLElement): void {
    const pos: cytoscape.Position = shadowNode.position();
    const zoom: number = shadowNode.cy().zoom();
    const strategy: ScalingStrategy = readStoredStrategy(domElement);

    // Convert graph coordinates to screen coordinates
    const screenPos: { readonly x: number; readonly y: number } = graphToScreenPosition({ x: pos.x, y: pos.y }, zoom);
    domElement.style.left = `${screenPos.x}px`;
    domElement.style.top = `${screenPos.y}px`;
    domElement.style.transform = getWindowTransform(strategy, zoom, 'center');
}

// =============================================================================
// Drag Handlers
// =============================================================================

/**
 * Attach drag-and-drop handlers to the window element
 * Dragging only initiates from menu bar areas (.cy-floating-window-horizontal-menu or .terminal-title-bar)
 * to preserve text selection in editor content
 * Returns the document-level handlers so they can be removed on dispose
 */
function attachDragHandlers(
    cy: cytoscape.Core,
    windowElement: HTMLElement,
    shadowNodeId: ShadowNodeId | NodeIdAndFilePath
): { handleMouseMove: (e: MouseEvent) => void; handleMouseUp: () => void } {
    return attachWindowDrag(windowElement, moveNodeDragBehaviour(cy, shadowNodeId));
}

/** Chrome areas a floating window can be dragged from (never its content, so text selection survives). */
const WINDOW_DRAG_HANDLE_SELECTOR: string =
    '.cy-floating-window-horizontal-menu, .terminal-title-bar, .cy-floating-window-move-grip';

/**
 * What a drag on a window's chrome does. `begin` receives the element the
 * pointer went down on and snapshots whatever the drag starts from (or returns
 * null to ignore the gesture); `move` receives that snapshot plus the pointer's
 * travel in graph units.
 */
interface WindowDragBehaviour<Start> {
    readonly begin: (pressed: Element) => Start | null
    readonly move: (start: Start, graphDx: number, graphDy: number) => void
    readonly end: () => void
}

/** Drag behaviour that moves a cy node (and whatever follows its position). */
export function moveNodeDragBehaviour(
    cy: cytoscape.Core,
    nodeId: ShadowNodeId | NodeIdAndFilePath
): WindowDragBehaviour<cytoscape.Position> {
    return {
        begin: () => {
            const node: cytoscape.CollectionReturnValue = cy.getElementById(nodeId);
            return node.length > 0 ? { ...node.position() } : null;
        },
        // [L2-seam-residual] cy-only: node drag update
        move: (start, graphDx, graphDy) => {
            cy.getElementById(nodeId).position({ x: start.x + graphDx, y: start.y + graphDy });
        },
        // A window drag moves the node without Cytoscape's grab/free cycle, so
        // persist positions here as the canvas does on 'free'.
        end: () => {
            void window.hostAPI?.main.saveNodePositions(cy.nodes().jsons() as cytoscape.NodeDefinition[]);
        },
    };
}

/**
 * Wire a drag gesture on the window's chrome to `behaviour`.
 *
 * The drag is measured as pointer travel from where it started, so it needs no
 * assumption about where the overlay sits in the viewport (it is offset by open
 * sidebars) or how the window element itself is positioned.
 */
export function attachWindowDrag<Start>(
    windowElement: HTMLElement,
    behaviour: WindowDragBehaviour<Start>
): { handleMouseMove: (e: MouseEvent) => void; handleMouseUp: () => void } {
    let active: { readonly pointer: { readonly x: number; readonly y: number }; readonly start: Start } | null = null;

    const handleMouseDown: (e: MouseEvent) => void = (e: MouseEvent) => {
        const target: HTMLElement = e.target as HTMLElement;

        // Don't drag when clicking buttons or children of buttons (e.g. icon/text spans inside inject badge)
        if (target.tagName === 'BUTTON' || target.closest('button') !== null) return;

        const handle: Element | null = target.closest(WINDOW_DRAG_HANDLE_SELECTOR);
        if (!handle) return;

        const start: Start | null = behaviour.begin(target);
        if (start === null) return;

        active = { pointer: { x: e.clientX, y: e.clientY }, start };
        windowElement.classList.add('dragging');
        e.preventDefault();
    };

    const handleMouseMove: (e: MouseEvent) => void = (e: MouseEvent) => {
        if (!active) return;
        const zoom: number = getLayout().zoom ?? 1;
        behaviour.move(active.start, (e.clientX - active.pointer.x) / zoom, (e.clientY - active.pointer.y) / zoom);
    };

    const handleMouseUp: () => void = () => {
        if (!active) return;
        active = null;
        windowElement.classList.remove('dragging');
        behaviour.end();
    };

    windowElement.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return { handleMouseMove, handleMouseUp };
}
