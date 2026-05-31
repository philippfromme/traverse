import { LitElement, html } from "lit";

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

  render() {
    return html`
      <div class="site-header">
        <h1>
          <a href="/"><img class="header-logo" src="/logo.svg" alt="">Traverse</a>
        </h1>
        <button
          class="header-hamburger"
          @click=${this._toggleMenu}
          aria-label="Toggle menu"
        >
          <span class="material-symbols-outlined">${this._menuOpen ? "close" : "menu"}</span>
        </button>
        <nav class="header-nav ${this._menuOpen ? "open" : ""}">
          <a
            href="/"
            class="header-link ${this.active === "feed" ? "active" : ""}"
            @click=${this._closeMenu}
            >Feed</a
          >
          <a
            href="/activities"
            class="header-link ${this.active === "activities" ? "active" : ""}"
            @click=${this._closeMenu}
            >Activities</a
          >
          <a
            href="/calendar"
            class="header-link ${this.active === "calendar" ? "active" : ""}"
            @click=${this._closeMenu}
            >Calendar</a
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
            href="/upload"
            class="header-link ${this.active === "upload" ? "active" : ""}"
            @click=${this._closeMenu}
            >Upload</a
          >
        </nav>
      </div>
    `;
  }
}

customElements.define("app-header", AppHeader);
