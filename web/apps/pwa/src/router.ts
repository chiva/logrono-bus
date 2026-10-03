/** Which view a URL shows. Pure, so routing rules are unit-tested without a DOM. */
import {
  type BoardConfig,
  type DisplayPreferences,
  LogronoBusError,
  parseBoardConfig,
} from '@logrono-bus/core';

import { ABOUT_HASH, WIZARD_HASH } from './context.ts';

export type Route =
  | { readonly view: 'home' }
  | { readonly view: 'about' }
  | { readonly view: 'wizard'; readonly initial: BoardConfig | null }
  | { readonly view: 'panel'; readonly config: BoardConfig }
  | { readonly view: 'kiosk'; readonly config: BoardConfig }
  | { readonly view: 'invalid'; readonly message: string };

/** `preferences`: this device's display defaults, used where the URL does not say. */
export function route(
  search: string,
  hash: string,
  preferences: Partial<DisplayPreferences> = {},
): Route {
  try {
    if (hash.startsWith(WIZARD_HASH)) {
      const query = hash.slice(WIZARD_HASH.length).replace(/^\//, '');
      return { view: 'wizard', initial: query ? parseBoardConfig(query, preferences) : null };
    }
    if (hash === ABOUT_HASH) return { view: 'about' };
    const config = parseBoardConfig(search, preferences);
    if (!config) return { view: 'home' };
    return config.mode === 'kiosko' ? { view: 'kiosk', config } : { view: 'panel', config };
  } catch (error) {
    if (error instanceof LogronoBusError) return { view: 'invalid', message: error.message };
    throw error;
  }
}
