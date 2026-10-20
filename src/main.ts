import './styles.css';
import { embeddingConfig } from './config';
import { createProvider } from './embeddings';
import { Engine } from './game/engine';
import { App } from './ui/app';
import { $, h } from './ui/dom';

async function main(): Promise<void> {
  const fill = $('#progress-fill');
  const detail = $('#loading-detail');
  try {
    const provider = await createProvider(embeddingConfig(), {
      onProgress(loaded, total) {
        fill.style.width = `${total ? (loaded / total) * 100 : 0}%`;
        detail.textContent = `${(loaded / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB`;
      },
    });
    await new App(new Engine(provider)).start();
  } catch (error) {
    console.error(error);
    $('#loading-title').textContent = 'Could not load the word vectors.';
    const retry = h('button', { class: 'btn btn-primary', type: 'button' }, 'Try again');
    retry.addEventListener('click', () => location.reload());
    detail.replaceChildren(h('span', { class: 'error-text' }, String((error as Error)?.message ?? error)), h('br'), retry);
  }
}

void main();
