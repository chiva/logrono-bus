/** App-wide services: the data source for a configuration, and in-app navigation. */
import { type BoardConfig, type DataSource, selectSource } from '@logrono-bus/core';

import { browserStore } from './preferences.ts';

const sources = new Map<string, Promise<DataSource>>();

/** One data source per (source, api) pair, shared by every view so the catalogue loads once. */
/** Boards with the same key share one data source. */
export function sourceKey(config: Pick<BoardConfig, 'source' | 'api'>): string {
  return `${config.source}|${config.api ?? ''}`;
}

export function sourceFor(config: Pick<BoardConfig, 'source' | 'api'>): Promise<DataSource> {
  const key = sourceKey(config);
  let source = sources.get(key);
  if (!source) {
    source = selectSource(config, { store: browserStore(), pageProtocol: location.protocol });
    source.catch(() => sources.delete(key));
    sources.set(key, source);
  }
  return source;
}

export const NAVIGATE_EVENT = 'lb-navigate';

/** Client-side navigation: the app listens for this event and re-routes without a reload. */
export function navigate(href: string): void {
  const url = new URL(href, location.href);
  history.pushState(null, '', url);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
  window.scrollTo({ top: 0 });
}

/** Absolute URL of a board, for sharing and QR codes. */
export function boardUrl(query: string, base: string = location.href): string {
  const url = new URL('./', base);
  url.search = query;
  url.hash = '';
  return url.href;
}

export const WIZARD_HASH = '#asistente';
export const ABOUT_HASH = '#acerca';

/** `#asistente/<board query>` opens the wizard pre-filled to edit that board. */
export function wizardHref(query?: string): string {
  return `./${WIZARD_HASH}${query ? `/${query}` : ''}`;
}
