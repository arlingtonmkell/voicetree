/**
 * Quick Start Guide
 *
 * A one-screen cheat sheet for the gestures that are not discoverable from the
 * canvas itself. Opened from the toolbar's "?" button, and shown once
 * automatically the first time the app is opened in a browser profile.
 */

const GUIDE_ID: string = 'quick-start-guide';
const SEEN_KEY: string = 'voicetree-quick-start-seen';

const SECTIONS: readonly { readonly title: string; readonly rows: readonly (readonly [string, string])[] }[] = [
  {
    title: 'Nodes',
    rows: [
      ['New node', 'Ctrl+N'],
      ['Open / edit a node', 'Hover or click it'],
      ['Move an open box off its node', 'Drag the strip along the box\'s top edge'],
      ['Move an open node, leaving its box', 'Drag the coloured dot at the strip\'s left end'],
      ['Put a box back on its node', 'Drag it back onto the node'],
      ['Select several', 'Shift+drag a box around them'],
      ['Delete selected', 'Ctrl+Backspace'],
      ['Search', 'Ctrl+F'],
    ],
  },
  {
    title: 'Agents',
    rows: [
      ['Run an agent on a node', 'Select it, then Ctrl+Enter'],
      ['By voice', 'Select a node, say "spin up an agent to …", then pause'],
      ['Watch it work', 'Its terminal opens on the node and is listed under Terminals'],
      ['Result', 'Appears as new nodes linked under the one you started from'],
    ],
  },
  {
    title: 'Voice',
    rows: [
      ['Mic on / off', 'Alt+R, or the mic button'],
      ['Dictate into a node or terminal', 'Focus it and speak; Enter inserts, Esc discards'],
    ],
  },
  {
    title: 'Getting around',
    rows: [
      ['Pan / zoom', 'Drag the canvas / scroll'],
      ['Lost the graph', 'Space fits to the last node; the minimap is bottom-right'],
      ['Settings', 'Ctrl+,'],
    ],
  },
];

function buildGuide(): HTMLDivElement {
  const backdrop: HTMLDivElement = document.createElement('div');
  backdrop.id = GUIDE_ID;
  backdrop.style.cssText = `
    position: fixed; inset: 0; z-index: 1400;
    display: flex; align-items: center; justify-content: center;
    background: rgba(0, 0, 0, 0.35);
  `;

  const panel: HTMLDivElement = document.createElement('div');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Quick start');
  panel.style.cssText = `
    width: min(560px, 92vw); max-height: 86vh; overflow-y: auto;
    padding: 20px 24px; background: var(--background); color: var(--foreground);
    border: 1px solid var(--border); border-radius: var(--radius);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25); font-size: 0.85rem;
  `;

  const heading: HTMLHeadingElement = document.createElement('h2');
  heading.textContent = 'How to use VoiceTree';
  heading.style.cssText = 'font-size: 1.05rem; font-weight: 600; margin: 0 0 12px;';
  panel.appendChild(heading);

  for (const section of SECTIONS) {
    const title: HTMLHeadingElement = document.createElement('h3');
    title.textContent = section.title;
    title.style.cssText = 'font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted-foreground); margin: 14px 0 6px;';
    panel.appendChild(title);

    for (const [action, how] of section.rows) {
      const row: HTMLDivElement = document.createElement('div');
      row.style.cssText = 'display: flex; gap: 12px; padding: 3px 0;';
      const actionCell: HTMLSpanElement = document.createElement('span');
      actionCell.textContent = action;
      actionCell.style.cssText = 'flex: 0 0 42%; font-weight: 500;';
      const howCell: HTMLSpanElement = document.createElement('span');
      howCell.textContent = how;
      howCell.style.cssText = 'color: var(--muted-foreground);';
      row.append(actionCell, howCell);
      panel.appendChild(row);
    }
  }

  const footer: HTMLParagraphElement = document.createElement('p');
  footer.textContent = 'Reopen this any time from the ? button, top right. Esc closes it.';
  footer.style.cssText = 'margin: 16px 0 0; color: var(--muted-foreground); font-size: 0.8rem;';
  panel.appendChild(footer);

  backdrop.appendChild(panel);
  backdrop.addEventListener('mousedown', (e: MouseEvent) => {
    if (e.target === backdrop) hideQuickStartGuide();
  });
  return backdrop;
}

function closeOnEscape(e: KeyboardEvent): void {
  if (e.key === 'Escape') hideQuickStartGuide();
}

function hideQuickStartGuide(): void {
  document.getElementById(GUIDE_ID)?.remove();
  document.removeEventListener('keydown', closeOnEscape);
}

export function toggleQuickStartGuide(): void {
  if (document.getElementById(GUIDE_ID)) {
    hideQuickStartGuide();
    return;
  }
  document.body.appendChild(buildGuide());
  document.addEventListener('keydown', closeOnEscape);
  localStorage.setItem(SEEN_KEY, 'true');
}

/** Open the guide the first time this browser profile sees the app. */
export function showQuickStartGuideOnFirstOpen(): void {
  if (localStorage.getItem(SEEN_KEY) === null) toggleQuickStartGuide();
}
