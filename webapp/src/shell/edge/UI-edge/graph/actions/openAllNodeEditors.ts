/**
 * "Open all notes": open every note on the canvas in its text box — or, when they
 * are all open already, close them all again.
 */
import type {Core, NodeSingular} from 'cytoscape';
import * as O from 'fp-ts/lib/Option.js';
import type {NodeIdAndFilePath} from '@vt/graph-model/graph';
import type {EditorData} from '@/shell/edge/UI-edge/state/stores/UIAppState';
import {getEditorByNodeId} from '@/shell/edge/UI-edge/state/stores/EditorStore';
import {clearPendingPan} from '@/shell/edge/UI-edge/state/stores/PendingPanStore';
import {closeEditor, createAnchoredFloatingEditor} from '@/shell/edge/UI-edge/floating-windows/editors/FloatingEditorCRUD';
import {showBriefNotice} from '@/shell/UI/views/components/overlays/briefNotice';
import {cyFitIntoVisibleViewport, getResponsivePadding} from '@/utils/responsivePadding';

/** Each open box is a live editor; past this many at once the canvas gets slow. */
const MAX_OPENED_AT_ONCE: number = 40;

/** Notes shown on the canvas: markdown file nodes, not folders, context nodes or window anchors. */
function visibleNoteIds(cy: Core): NodeIdAndFilePath[] {
    return cy.nodes()
        .filter((node: NodeSingular): boolean =>
            !node.isParent()
            && node.data('isFolderNode') !== true
            && node.data('isContextNode') !== true
            && node.id().endsWith('.md')
            && node.visible())
        .map((node: NodeSingular): NodeIdAndFilePath => node.id() as NodeIdAndFilePath);
}

export async function toggleAllNodeEditors(cy: Core): Promise<void> {
    const noteIds: NodeIdAndFilePath[] = visibleNoteIds(cy);
    const closedIds: NodeIdAndFilePath[] = noteIds.filter((id: NodeIdAndFilePath): boolean => O.isNone(getEditorByNodeId(id)));

    if (noteIds.length > 0 && closedIds.length === 0) {
        for (const id of noteIds) {
            const editor: O.Option<EditorData> = getEditorByNodeId(id);
            if (O.isSome(editor)) closeEditor(cy, editor.value);
        }
        showBriefNotice(`Closed ${noteIds.length} notes`);
        return;
    }

    const toOpen: NodeIdAndFilePath[] = closedIds.slice(0, MAX_OPENED_AT_ONCE);
    for (const id of toOpen) await createAnchoredFloatingEditor(cy, id);
    // Each open asks to pan to its own node; show them all instead.
    clearPendingPan();
    cyFitIntoVisibleViewport(cy, undefined, getResponsivePadding(cy));

    showBriefNotice(closedIds.length > toOpen.length
        ? `Opened ${toOpen.length} of ${closedIds.length} notes (at most ${MAX_OPENED_AT_ONCE} at once). Press again for more.`
        : `Opened ${toOpen.length} notes. Use "Tidy around boxes" if they overlap.`);
}
