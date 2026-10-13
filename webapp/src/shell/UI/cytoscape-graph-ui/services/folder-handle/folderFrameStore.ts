/**
 * Where the user's folder frames are remembered between sessions.
 *
 * graphd's node-layout sidecar stores a folder's SIZE but not where its box sits
 * (a compound has no position of its own), so the frame rectangles are kept in
 * this browser's localStorage, keyed by folder id (an absolute path, so frames
 * from different projects never collide).
 */
import type {FrameRect} from '@/shell/UI/cytoscape-graph-ui/services/folder-handle/folderResize';

const STORAGE_KEY: string = 'voicetree-folder-frames';

function isFrameRect(value: unknown): value is FrameRect {
    if (typeof value !== 'object' || value === null) return false;
    const rect: Record<string, unknown> = value as Record<string, unknown>;
    return ['x1', 'y1', 'x2', 'y2'].every((key: string): boolean => Number.isFinite(rect[key]));
}

/** Every remembered frame; empty if nothing is stored or the stored value is unreadable. */
export function loadFolderFrames(): Map<string, FrameRect> {
    const frames: Map<string, FrameRect> = new Map();
    try {
        const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
        if (typeof parsed !== 'object' || parsed === null) return frames;
        for (const [folderId, rect] of Object.entries(parsed)) {
            if (isFrameRect(rect)) frames.set(folderId, {x1: rect.x1, y1: rect.y1, x2: rect.x2, y2: rect.y2});
        }
    } catch (error) {
        console.warn('[folderFrameStore] Ignoring unreadable saved folder frames:', error);
    }
    return frames;
}

export function saveFolderFrames(frames: ReadonlyMap<string, FrameRect>): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(frames)));
}
