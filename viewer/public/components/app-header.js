import { LitElement, html } from "lit";

class AppHeader extends LitElement {
  static properties = {
    active: { type: String },
  };

  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <div class="site-header">
        <h1>
          <a href="/">
            <span class="material-symbols-outlined header-logo">swap_horiz</span
            >Traverse
          </a>
        </h1>
        <nav class="header-nav">
          <a
            href="/"
            class="header-link ${this.active === "feed" ? "active" : ""}"
            >Feed</a
          >
          <a
            href="/activities"
            class="header-link ${this.active === "activities" ? "active" : ""}"
            >Activities</a
          >
          <a
            href="/calendar"
            class="header-link ${this.active === "calendar" ? "active" : ""}"
            >Calendar</a
          >
          <a
            href="/stats"
            class="header-link ${this.active === "stats" ? "active" : ""}"
            >Stats</a
          >
        </nav>
      </div>
    `;
  }
}

customElements.define("app-header", AppHeader);
