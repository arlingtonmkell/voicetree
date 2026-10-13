/**
 * Editor tether: the line joining an editor box to its node once the box has been
 * dragged away from it. Lives in the floating overlay, so its endpoints are in the
 * same screen coordinates (graph * zoom) as the windows themselves.
 */

const TETHER_CLASS: string = 'cy-floating-window-tether';
const tethers: WeakMap<HTMLElement, HTMLDivElement> = new WeakMap<HTMLElement, HTMLDivElement>();

interface TetherPoint {
    readonly x: number
    readonly y: number
}

/** Draw (or redraw) the tether for `windowElement` between two overlay points. */
export function drawEditorTether(windowElement: HTMLElement, from: TetherPoint, to: TetherPoint): void {
    const overlay: HTMLElement | null = windowElement.parentElement;
    if (!overlay) return;

    let tether: HTMLDivElement | undefined = tethers.get(windowElement);
    if (!tether) {
        tether = document.createElement('div');
        tether.className = TETHER_CLASS;
        tether.style.setProperty('--tether-color', windowElement.style.getPropertyValue('--editor-accent-color') || '#4a9eff');
        tethers.set(windowElement, tether);
    }
    // Keep it before the window in DOM order so the box paints over the line's end.
    if (tether.parentElement !== overlay) overlay.insertBefore(tether, windowElement);

    const dx: number = to.x - from.x;
    const dy: number = to.y - from.y;
    tether.style.left = `${from.x}px`;
    tether.style.top = `${from.y}px`;
    tether.style.width = `${Math.hypot(dx, dy)}px`;
    tether.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
}

export function removeEditorTether(windowElement: HTMLElement): void {
    tethers.get(windowElement)?.remove();
    tethers.delete(windowElement);
}
