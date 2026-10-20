import { StaticVectorProvider, type ProgressCallback } from './staticVectorProvider';
import type { EmbeddingProvider } from './types';

export type { EmbeddingProvider, EmbeddingInfo, Neighbor, NearestOptions } from './types';

/**
 * Describes where word vectors come from. To add a new kind of source (say, a
 * server that does the nearest-neighbour search), implement EmbeddingProvider
 * in a new file, add a variant here, and handle it in createProvider().
 */
export type EmbeddingConfig = {
  type: 'static';
  /** Folder containing manifest.json, words.txt and vectors.bin. */
  url: string;
};

export interface CreateProviderOptions {
  onProgress?: ProgressCallback;
}

export async function createProvider(
  config: EmbeddingConfig,
  options: CreateProviderOptions = {},
): Promise<EmbeddingProvider> {
  switch (config.type) {
    case 'static':
      return StaticVectorProvider.load(config.url, options.onProgress);
  }
}
