/** The slice of Home Assistant's frontend API this card uses. */

export interface HassEntity {
  readonly entity_id: string;
  readonly state: string;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly last_updated: string;
}

export interface HomeAssistant {
  readonly states: Readonly<Record<string, HassEntity | undefined>>;
  readonly language?: string;
}

/** Fire the event Home Assistant's card editor listens to. */
export function fireConfigChanged(element: HTMLElement, config: unknown): void {
  element.dispatchEvent(
    new CustomEvent('config-changed', { detail: { config }, bubbles: true, composed: true }),
  );
}

declare global {
  interface Window {
    customCards?: { type: string; name: string; description: string; preview?: boolean }[];
  }
}
