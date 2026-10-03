/** `<lb-share>`: a board's link as text, copy button and QR code (to move it to another screen). */
import qrcode from 'qrcode-generator';
import { LitElement, type PropertyDeclarations, css, html } from 'lit';
import { unsafeSVG } from 'lit/directives/unsafe-svg.js';

import { uiStyles } from '../ui.ts';

const QR_CELL_SIZE = 6;
const QR_MARGIN = 2;

/** SVG markup of a QR code for `text`, built locally (the link never leaves the device). */
export function qrSvg(text: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: QR_CELL_SIZE, margin: QR_MARGIN, scalable: true });
}

export class LbShare extends LitElement {
  static override properties: PropertyDeclarations = {
    url: { type: String },
    copied: { state: true },
  };

  declare url: string;
  declare copied: boolean;

  constructor() {
    super();
    this.url = '';
    this.copied = false;
  }

  static override styles = [
    uiStyles,
    css`
      .qr {
        width: min(240px, 70vw);
        aspect-ratio: 1;
        padding: 8px;
        background: #fff;
        border-radius: 12px;
      }
      .qr svg {
        width: 100%;
        height: 100%;
        display: block;
      }
      .link {
        display: flex;
        gap: 8px;
      }
      input {
        font-family: ui-monospace, monospace;
        font-size: 0.85rem;
      }
    `,
  ];

  async #copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.url);
      this.copied = true;
    } catch {
      const input = this.renderRoot.querySelector('input');
      input?.select();
    }
  }

  override render() {
    return html`
      <div class="stack">
        <div class="qr" role="img" aria-label="Código QR con el enlace del panel">
          ${unsafeSVG(qrSvg(this.url))}
        </div>
        <p class="muted">
          Escanéalo con la cámara del móvil para abrir este panel, o copia el enlace para abrirlo en
          otra pantalla (Echo Show, tablet, Home Assistant).
        </p>
        <div class="link">
          <input
            readonly
            .value=${this.url}
            aria-label="Enlace del panel"
            @focus=${(e: Event) => (e.target as HTMLInputElement).select()}
          />
          <button @click=${this.#copy}>${this.copied ? 'Copiado ✓' : 'Copiar'}</button>
        </div>
      </div>
    `;
  }
}

if (!customElements.get('lb-share')) customElements.define('lb-share', LbShare);

declare global {
  interface HTMLElementTagNameMap {
    'lb-share': LbShare;
  }
}
