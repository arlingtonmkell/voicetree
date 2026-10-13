/**
 * Brief Notice
 *
 * A short, self-dismissing line of feedback above the voice bar, for actions
 * that would otherwise fail silently (e.g. a spoken command with nothing selected).
 */

const NOTICE_ID: string = 'brief-notice';
const NOTICE_VISIBLE_MS: number = 4000;

let hideTimer: ReturnType<typeof setTimeout> | null = null;

/** Show `message`, replacing any notice already on screen. */
export function showBriefNotice(message: string): void {
  document.getElementById(NOTICE_ID)?.remove();
  if (hideTimer) clearTimeout(hideTimer);

  const notice: HTMLDivElement = document.createElement('div');
  notice.id = NOTICE_ID;
  notice.setAttribute('role', 'status');
  notice.textContent = message;
  notice.style.cssText = `
    position: fixed;
    bottom: 130px;
    left: 50%;
    transform: translateX(-50%);
    max-width: min(520px, 90vw);
    padding: 10px 16px;
    background: var(--foreground);
    color: var(--background);
    border-radius: var(--radius);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
    z-index: 1300;
    font-size: 0.85rem;
  `;
  document.body.appendChild(notice);

  hideTimer = setTimeout(() => {
    notice.remove();
    hideTimer = null;
  }, NOTICE_VISIBLE_MS);
}
