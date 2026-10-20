import { $, h } from './dom';

/** Show a short message at the top of the screen, Wordle style. */
export function toast(message: string, durationMs = 1600): void {
  const container = $('#toasts');
  const el = h('div', { class: 'toast' }, message);
  container.prepend(el);
  window.setTimeout(() => {
    el.classList.add('is-leaving');
    el.addEventListener('transitionend', () => el.remove(), { once: true });
    window.setTimeout(() => el.remove(), 500); // in case transitions are disabled
  }, durationMs);
}
