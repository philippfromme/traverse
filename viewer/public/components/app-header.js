import { LitElement, html } from "lit";
import "./map-style-select.js";

class AppHeader extends LitElement {
  static properties = {
    active: { type: String },
    _menuOpen: { type: Boolean, state: true },
  };

  constructor() {
    super();
    this._menuOpen = false;
  }

  createRenderRoot() {
    return this;
  }

  _toggleMenu() {
    this._menuOpen = !this._menuOpen;
  }

  _closeMenu() {
    this._menuOpen = false;
  }

  async _openSettings() {
    this._settingsReturnFocus = document.activeElement;
    this._menuOpen = false;
    await this.updateComplete;
    this.querySelector(".settings-dialog").showModal();
  }

  _closeSettings() {
    this.querySelector(".settings-dialog").close();
  }

  _settingsClosed() {
    if (this._settingsReturnFocus?.isConnected) this._settingsReturnFocus.focus();
  }

  _settingsBackdropClick(e) {
    if (e.target === e.currentTarget) this._closeSettings();
  }

  render() {
    return html`
      <div class="site-header">
        <h1>
          <a href="/"><img class="header-logo" src="/logo.svg" alt="">Traverse</a>
        </h1>
        <nav class="header-nav ${this._menuOpen ? "open" : ""}">
          <a
            href="/"
            class="header-link ${this.active === "feed" ? "active" : ""}"
            @click=${this._closeMenu}
            >Feed</a
          >
          <a
            href="/calendar"
            class="header-link ${this.active === "calendar" ? "active" : ""}"
            @click=${this._closeMenu}
            >Calendar</a
          >
          <a href="/races" class="header-link ${this.active === 'races' ? 'active' : ''}" @click=${this._closeMenu}>Races</a>
          <a
            href="/goals"
            class="header-link ${this.active === "goals" ? "active" : ""}"
            @click=${this._closeMenu}
            >Goals</a
          >
          <a
            href="/activities"
            class="header-link ${this.active === "activities" ? "active" : ""}"
            @click=${this._closeMenu}
            >Activities</a
          >
          <a
            href="/heatmap"
            class="header-link ${this.active === "heatmap" ? "active" : ""}"
            @click=${this._closeMenu}
            >Heatmap</a
          >
          <a
            href="/stats"
            class="header-link ${this.active === "stats" ? "active" : ""}"
            @click=${this._closeMenu}
            >Stats</a
          >
          <a
            href="/health"
            class="header-link ${this.active === "health" ? "active" : ""}"
            @click=${this._closeMenu}
            >Health</a
          >
          <a
            href="/upload"
            class="header-link ${this.active === "upload" ? "active" : ""}"
            @click=${this._closeMenu}
            >Upload</a
          >
        </nav>
        <div class="header-actions">
          <button class="header-settings" type="button" aria-label="Settings" title="Settings" @click=${this._openSettings}>
            <span class="material-symbols-outlined" aria-hidden="true">settings</span>
          </button>
          <button
            class="header-hamburger"
            type="button"
            @click=${this._toggleMenu}
            aria-label="Toggle menu"
          >
            <span class="material-symbols-outlined">${this._menuOpen ? "close" : "menu"}</span>
          </button>
        </div>
      </div>
      <dialog class="settings-dialog" aria-labelledby="settings-title" @close=${this._settingsClosed} @click=${this._settingsBackdropClick}>
        <div class="settings-dialog-header">
          <h2 id="settings-title">Settings</h2>
          <button type="button" aria-label="Close settings" @click=${this._closeSettings}>×</button>
        </div>
        <div class="settings-field">
          <span>Map style</span>
          <map-style-select></map-style-select>
        </div>
      </dialog>
    `;
  }
}

customElements.define("app-header", AppHeader);
