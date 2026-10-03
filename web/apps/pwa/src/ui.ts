/** Shared styles for the app's own components (buttons, chips, surfaces). */
import { css } from 'lit';

export const uiStyles = css`
  :host {
    font-family: var(--lb-font);
    color: var(--lb-fg);
  }
  h1,
  h2,
  h3 {
    line-height: 1.2;
    margin: 0 0 0.5em;
  }
  p {
    margin: 0 0 0.75em;
  }
  a {
    color: var(--lb-accent);
  }
  .surface {
    background: var(--lb-surface);
    border: 1px solid var(--lb-border);
    border-radius: var(--lb-radius);
    padding: 20px;
    box-shadow: var(--lb-shadow);
  }
  .stack {
    display: grid;
    gap: var(--lb-gap);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
  }
  .muted {
    color: var(--lb-muted);
  }
  button,
  .button {
    font: inherit;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5em;
    min-height: 44px;
    padding: 0.55em 1.1em;
    border-radius: 999px;
    border: 1px solid var(--lb-border);
    background: var(--lb-surface);
    color: var(--lb-fg);
    cursor: pointer;
    text-decoration: none;
    transition:
      transform 120ms ease,
      background 120ms ease;
  }
  button:hover,
  .button:hover {
    background: var(--lb-surface-2);
  }
  button:active,
  .button:active {
    transform: scale(0.98);
  }
  button[disabled] {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .primary {
    background: var(--lb-accent);
    border-color: var(--lb-accent);
    color: var(--lb-accent-fg);
  }
  .primary:hover {
    background: var(--lb-accent);
    filter: brightness(1.08);
  }
  .ghost {
    background: transparent;
    border-color: transparent;
  }
  input,
  select {
    font: inherit;
    min-height: 44px;
    padding: 0.5em 0.9em;
    border-radius: 12px;
    border: 1px solid var(--lb-border);
    background: var(--lb-surface);
    color: var(--lb-fg);
    width: 100%;
  }
  label {
    display: grid;
    gap: 6px;
    font-weight: 600;
  }
  .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 2.2em;
    padding: 0.15em 0.5em;
    border-radius: 10px;
    font-weight: 800;
    background: var(--line-colour);
    color: var(--line-text);
    outline: var(--lb-badge-outline, none);
  }
  .visually-hidden {
    position: absolute !important;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  .error {
    padding: 12px 16px;
    border-radius: 12px;
    background: var(--lb-warning-bg);
    color: var(--lb-warning-fg);
    font-weight: 600;
  }
`;
