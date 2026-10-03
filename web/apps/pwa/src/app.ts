/** `<lb-app>`: the shell. Routes on the URL and hosts the header, footer and theme switcher. */
import { THEMES, type Theme } from '@logrono-bus/core';
import { LitElement, type PropertyDeclarations, css, html, nothing } from 'lit';

import { ABOUT_HASH, NAVIGATE_EVENT, navigate, wizardHref } from './context.ts';
import {
  THEME_NAMES,
  applyTheme,
  browserStore,
  loadDisplayPreferences,
  saveDisplayPreferences,
  savedTheme,
} from './preferences.ts';
import { type Route, route } from './router.ts';
import { uiStyles } from './ui.ts';
import './views/about.ts';
import './views/home.ts';
import './views/kiosk.ts';
import './views/panel.ts';
import './views/wizard.ts';

export class LbApp extends LitElement {
  static override properties: PropertyDeclarations = {
    current: { state: true },
  };

  declare current: Route;
  readonly #onLocation = (): void => this.#route();

  constructor() {
    super();
    this.current = route(location.search, location.hash, loadDisplayPreferences(browserStore()));
  }

  static override styles = [
    uiStyles,
    css`
      :host {
        display: block;
        min-height: 100vh;
      }
      .shell {
        max-width: 1100px;
        margin: 0 auto;
        padding: 0 clamp(14px, 4vw, 28px) 40px;
      }
      header {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        align-items: center;
        justify-content: space-between;
        padding: 14px 0;
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 10px;
        color: inherit;
        text-decoration: none;
        font-weight: 800;
        font-size: 1.15rem;
      }
      .brand img {
        width: 34px;
        height: 34px;
      }
      nav {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
      }
      nav select {
        width: auto;
      }
      @media (max-width: 600px) {
        header {
          padding: 10px 0;
          gap: 8px;
        }
        nav .button {
          padding: 0.35em 0.7em;
          min-height: 40px;
        }
        nav select {
          min-height: 40px;
          padding: 0.3em 0.6em;
        }
      }
      footer {
        margin-top: 48px;
        padding-top: 16px;
        border-top: 1px solid var(--lb-border);
        font-size: 0.9rem;
        color: var(--lb-muted);
      }
    `,
  ];

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener('popstate', this.#onLocation);
    window.addEventListener('hashchange', this.#onLocation);
    window.addEventListener(NAVIGATE_EVENT, this.#onLocation);
    this.#applyTheme();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener('popstate', this.#onLocation);
    window.removeEventListener('hashchange', this.#onLocation);
    window.removeEventListener(NAVIGATE_EVENT, this.#onLocation);
  }

  #route(): void {
    this.current = route(location.search, location.hash, loadDisplayPreferences(browserStore()));
    this.#applyTheme();
  }

  /** A board's theme (its URL, else this device's default); elsewhere, the device default. */
  #applyTheme(): void {
    const current = this.current;
    applyTheme('config' in current ? current.config.theme : savedTheme(browserStore()));
  }

  #chooseTheme(event: Event): void {
    const theme = (event.target as HTMLSelectElement).value as Theme;
    saveDisplayPreferences(browserStore(), { theme });
    applyTheme(theme);
  }

  #link(href: string, label: string) {
    return html`<a
      class="button ghost"
      href=${href}
      @click=${(e: Event) => {
        e.preventDefault();
        navigate(href);
      }}
      >${label}</a
    >`;
  }

  #renderView() {
    const current = this.current;
    switch (current.view) {
      case 'home':
        return html`<lb-home></lb-home>`;
      case 'about':
        return html`<lb-about></lb-about>`;
      case 'wizard':
        return html`<lb-wizard .initial=${current.initial}></lb-wizard>`;
      case 'panel':
        return html`<lb-panel .config=${current.config}></lb-panel>`;
      case 'kiosk':
        return html`<lb-kiosk .config=${current.config}></lb-kiosk>`;
      case 'invalid':
        return html`<section class="surface" role="alert">
          <h1>Este enlace no funciona</h1>
          <p>${current.message}</p>
          ${this.#link(wizardHref(), 'Crear un panel nuevo')}
        </section>`;
    }
  }

  override render() {
    if (this.current.view === 'kiosk') return this.#renderView();
    const theme = savedTheme(browserStore());
    return html`
      <div class="shell">
        <header>
          <a
            class="brand"
            href="./"
            @click=${(e: Event) => {
              e.preventDefault();
              navigate('./');
            }}
          >
            <img src="./icon.svg" alt="" />
            <span>Logroño Bus</span>
          </a>
          <nav aria-label="Principal">
            ${this.#link(wizardHref(), 'Crear panel')} ${this.#link(`./${ABOUT_HASH}`, 'Acerca de')}
            <label>
              <span class="visually-hidden">Tema</span>
              <select @change=${this.#chooseTheme} aria-label="Tema de colores">
                ${THEMES.map(
                  (t) =>
                    html`<option value=${t} ?selected=${t === theme}>${THEME_NAMES[t]}</option>`,
                )}
              </select>
            </label>
          </nav>
        </header>
        <main>${this.#renderView()}</main>
        <footer>
          Proyecto no oficial. Datos del servicio público de autobuses del Ayuntamiento de Logroño.
          ${this.current.view === 'about' ? nothing : this.#link(`./${ABOUT_HASH}`, 'Más información')}
        </footer>
      </div>
    `;
  }
}

if (!customElements.get('lb-app')) customElements.define('lb-app', LbApp);

declare global {
  interface HTMLElementTagNameMap {
    'lb-app': LbApp;
  }
}
