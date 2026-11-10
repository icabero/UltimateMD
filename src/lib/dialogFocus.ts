// Keyboard manners for every dialog of the app, in one place: when one opens
// the focus goes into it, Tab stays inside while it is open, and when it
// closes the focus returns to where it was. Dialogs are found by their role,
// so a new one needs nothing but `role="dialog"`.

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled):not([type=hidden]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"]), [contenteditable=true]';

const isDialog = (node: Node): node is HTMLElement => node instanceof HTMLElement && (node.getAttribute('role') === 'dialog' || (node.tagName === 'FORM' && node.classList.contains('dialog')));

const visible = (el: HTMLElement) => el.offsetParent !== null || el.getClientRects().length > 0;

const focusable = (dialog: HTMLElement) => [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);

/** Starts watching. Returns how to stop. */
export function manageDialogFocus() {
  /** Open dialogs in the order they opened, each with what had the focus before. */
  const open: { el: HTMLElement; before: Element | null }[] = [];
  const top = () => open.at(-1)?.el ?? null;

  function opened(el: HTMLElement) {
    if (open.some((d) => d.el === el)) return;
    open.push({ el, before: document.activeElement });
    el.setAttribute('aria-modal', 'true');
    // A dialog that focuses something of its own, such as a text field, keeps that.
    requestAnimationFrame(() => {
      if (!el.isConnected || el.contains(document.activeElement)) return;
      const first = focusable(el).find((f) => !f.matches('.icon, .x')) ?? focusable(el)[0];
      if (first) first.focus();
      else {
        el.tabIndex = -1;
        el.focus();
      }
    });
  }

  function closed(el: HTMLElement) {
    const at = open.findIndex((d) => d.el === el);
    if (at < 0) return;
    const [{ before }] = open.splice(at, 1);
    // Only when the focus was left nowhere: something else may have taken it on purpose.
    const lost = !document.activeElement || document.activeElement === document.body;
    if (lost && before instanceof HTMLElement && before.isConnected) before.focus();
  }

  const observer = new MutationObserver((changes) => {
    for (const change of changes) {
      for (const node of change.removedNodes) {
        if (isDialog(node)) closed(node);
        else if (node instanceof HTMLElement) node.querySelectorAll<HTMLElement>('[role=dialog], form.dialog').forEach(closed);
      }
      for (const node of change.addedNodes) {
        if (isDialog(node)) opened(node);
        else if (node instanceof HTMLElement) node.querySelectorAll<HTMLElement>('[role=dialog], form.dialog').forEach(opened);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  function onKey(e: KeyboardEvent) {
    const dialog = top();
    if (e.key !== 'Tab' || !dialog) return;
    const all = focusable(dialog);
    if (!all.length) return e.preventDefault();
    const at = all.indexOf(document.activeElement as HTMLElement);
    const outside = !dialog.contains(document.activeElement);
    if (e.shiftKey ? at <= 0 || outside : at === all.length - 1 || outside) {
      e.preventDefault();
      (e.shiftKey ? all.at(-1) : all[0])?.focus();
    }
  }
  addEventListener('keydown', onKey, true);

  return () => {
    observer.disconnect();
    removeEventListener('keydown', onKey, true);
  };
}
