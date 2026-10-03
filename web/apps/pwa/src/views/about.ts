/** `<lb-about>`: the unofficial-project notice, data origin and privacy, in plain words. */
import { DEFAULTS, type SourceKind } from '@logrono-bus/core';
import { LitElement, type PropertyDeclarations, css, html } from 'lit';

import { sourceFor } from '../context.ts';

import { uiStyles } from '../ui.ts';

export const REPOSITORY_URL = 'https://github.com/chiva/logrono-bus';

export const SOURCE_NAMES: Readonly<Record<SourceKind, string>> = {
  directa: 'Directamente del servicio del Ayuntamiento',
  servidor: 'Tu servidor de Logroño Bus',
};

export class LbAbout extends LitElement {
  static override properties: PropertyDeclarations = {
    sourceKind: { state: true },
  };

  declare sourceKind: SourceKind | undefined;

  constructor() {
    super();
    this.sourceKind = undefined;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    void sourceFor(DEFAULTS)
      .then((source) => (this.sourceKind = source.kind))
      .catch(() => undefined);
  }

  static override styles = [
    uiStyles,
    css`
      :host {
        display: block;
        max-width: 70ch;
      }
      dl {
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: 6px 16px;
        margin: 0;
      }
      dt {
        font-weight: 700;
      }
      dd {
        margin: 0;
        overflow-wrap: anywhere;
      }
    `,
  ];

  override render() {
    return html`
      <article class="stack">
        <h1>Acerca de Logroño Bus</h1>
        <section class="surface">
          <h2>Proyecto no oficial</h2>
          <p>
            Esta web <strong>no es del Ayuntamiento de Logroño</strong> ni de la empresa que presta
            el servicio de autobuses. Es un proyecto personal y de código abierto.
          </p>
          <p>
            Los datos de llegadas salen del servicio web público del Ayuntamiento (<a
              href="https://transporteurbano.logrono.es/"
              rel="noopener"
              >transporteurbano.logrono.es</a
            >), el mismo que usa su web oficial. Si algo no cuadra, la fuente de verdad es esa.
          </p>
        </section>
        <section class="surface">
          <h2>Privacidad</h2>
          <p>
            No hay cuentas, ni anuncios, ni estadísticas. Tus paradas se guardan solo en el enlace
            del panel y, si quieres, en este navegador. Tu ubicación (si la usas para buscar paradas
            cercanas) no sale de tu dispositivo.
          </p>
          <p>
            Para mostrar las llegadas, tu navegador consulta directamente el servicio del
            Ayuntamiento (o tu propio servidor, si lo tienes instalado). El mapa usa teselas de
            OpenStreetMap.
          </p>
        </section>
        <section class="surface" aria-labelledby="screen-title">
          <h2 id="screen-title">Datos de esta pantalla</h2>
          <p class="muted">
            Si algo no se ve bien en tu Echo Show, Portal o tablet, incluye estos datos al avisar
            del problema.
          </p>
          <dl>
            <dt>Datos</dt>
            <dd>${this.sourceKind ? SOURCE_NAMES[this.sourceKind] : 'comprobando…'}</dd>
            <dt>Tamaño útil</dt>
            <dd>${window.innerWidth} × ${window.innerHeight} px</dd>
            <dt>Densidad</dt>
            <dd>${window.devicePixelRatio}</dd>
            <dt>Navegador</dt>
            <dd><code>${navigator.userAgent}</code></dd>
          </dl>
        </section>
        <section class="surface">
          <h2>Código y ayuda</h2>
          <p>
            Todo el código está en <a href=${REPOSITORY_URL} rel="noopener">GitHub</a> con licencia
            MIT. Allí puedes avisar de errores o proponer mejoras.
          </p>
        </section>
      </article>
    `;
  }
}

if (!customElements.get('lb-about')) customElements.define('lb-about', LbAbout);

declare global {
  interface HTMLElementTagNameMap {
    'lb-about': LbAbout;
  }
}
