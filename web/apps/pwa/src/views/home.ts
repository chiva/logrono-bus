/** `<lb-home>`: what this is, saved boards, and the way in. */
import { parseBoardConfig } from '@logrono-bus/core';
import { LitElement, type PropertyDeclarations, css, html, nothing } from 'lit';

import { navigate, wizardHref } from '../context.ts';
import { type SavedBoard, browserStore, forgetBoard, loadSavedBoards } from '../preferences.ts';
import { uiStyles } from '../ui.ts';

export const EXAMPLE_QUERY = 'v=1&p=101~100&titulo=Ayuntamiento';
export const GUIDE_URL = 'https://chiva.github.io/logrono-bus/guia/';

export class LbHome extends LitElement {
  static override properties: PropertyDeclarations = {
    saved: { state: true },
  };

  declare saved: readonly SavedBoard[];

  constructor() {
    super();
    this.saved = loadSavedBoards(browserStore());
  }

  static override styles = [
    uiStyles,
    css`
      :host {
        display: block;
      }
      .hero {
        padding: clamp(24px, 6vw, 56px) 0 24px;
      }
      .hero h1 {
        font-size: clamp(2rem, 6vw, 3.4rem);
        letter-spacing: -0.02em;
        margin-bottom: 12px;
      }
      .hero p {
        font-size: clamp(1.05rem, 2.4vw, 1.3rem);
        max-width: 42ch;
        color: var(--lb-muted);
      }
      .tiles {
        display: grid;
        gap: var(--lb-gap);
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        margin: 24px 0;
      }
      .tile h3 {
        display: flex;
        gap: 8px;
        align-items: center;
      }
      .emoji {
        font-size: 1.6rem;
      }
      ul {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 10px;
      }
      li {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        justify-content: space-between;
        align-items: center;
      }
    `,
  ];

  #forget(query: string): void {
    this.saved = forgetBoard(browserStore(), query);
  }

  #renderSaved() {
    if (this.saved.length === 0) return nothing;
    return html`<section class="surface" aria-labelledby="saved-title">
      <h2 id="saved-title">Tus paneles</h2>
      <ul>
        ${this.saved.map((board) => {
          const valid = (() => {
            try {
              return parseBoardConfig(board.query) !== null;
            } catch {
              return false;
            }
          })();
          return html`<li>
            <strong>${board.name}</strong>
            <span class="row">
              ${
                valid
                  ? html`<a
                        class="button primary"
                        href=${`./?${board.query}`}
                        @click=${(e: Event) => {
                          e.preventDefault();
                          navigate(`./?${board.query}`);
                        }}
                        >Abrir</a
                      >
                      <a class="button" href=${`./?${board.query}&modo=kiosko`}>📺 Pantalla</a>`
                  : html`<span class="muted">Enlace no válido</span>`
              }
              <button
                class="ghost"
                @click=${() => this.#forget(board.query)}
                aria-label=${`Olvidar ${board.name}`}
              >
                ✕
              </button>
            </span>
          </li>`;
        })}
      </ul>
    </section>`;
  }

  override render() {
    return html`
      <section class="hero">
        <h1>¿Cuánto le falta a tu autobús?</h1>
        <p>
          Elige tus paradas de Logroño y ten siempre a mano el tiempo que falta para el próximo
          autobús: en el móvil, en una pantalla de casa o en Home Assistant.
        </p>
        <div class="row">
          <a
            class="button primary"
            href=${wizardHref()}
            @click=${(e: Event) => {
              e.preventDefault();
              navigate(wizardHref());
            }}
            >Crear mi panel</a
          >
          <a
            class="button"
            href=${`./?${EXAMPLE_QUERY}`}
            @click=${(e: Event) => {
              e.preventDefault();
              navigate(`./?${EXAMPLE_QUERY}`);
            }}
            >Ver ejemplo: Ayuntamiento</a
          >
        </div>
      </section>

      ${this.#renderSaved()}

      <section class="tiles" aria-label="Dónde usarlo">
        <article class="surface tile">
          <h3><span class="emoji" aria-hidden="true">📱</span> En el móvil</h3>
          <p class="muted">
            Añade esta web a la pantalla de inicio y ábrela como una aplicación más. Sin instalar
            nada ni registrarte.
          </p>
          <a href=${`${GUIDE_URL}02-usar-en-el-movil/`}>Cómo hacerlo</a>
        </article>
        <article class="surface tile">
          <h3><span class="emoji" aria-hidden="true">📺</span> En una pantalla</h3>
          <p class="muted">
            El modo pantalla está pensado para un Echo Show, un Portal, una tablet vieja o un
            monitor: letras grandes, se actualiza solo y avisa cuando el autobús está cerca.
          </p>
          <a href=${`${GUIDE_URL}05-echo-show/`}>Echo Show</a> ·
          <a href=${`${GUIDE_URL}06-portal/`}>Meta Portal</a>
        </article>
        <article class="surface tile">
          <h3><span class="emoji" aria-hidden="true">🏠</span> En Home Assistant</h3>
          <p class="muted">
            Con la integración de HACS tendrás un sensor por línea para usar en paneles,
            automatizaciones y widgets de Android.
          </p>
          <a href=${`${GUIDE_URL}07-home-assistant/`}>Instalar la integración</a>
        </article>
      </section>
    `;
  }
}

if (!customElements.get('lb-home')) customElements.define('lb-home', LbHome);

declare global {
  interface HTMLElementTagNameMap {
    'lb-home': LbHome;
  }
}
