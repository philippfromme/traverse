import { LitElement, html } from "lit";

class AppFooter extends LitElement {
  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <footer class="site-footer">
        <div class="footer-brand">
          <img class="footer-logo" src="/logo.svg" alt="" />
          <span class="footer-text">Traverse</span>
        </div>
        <div class="footer-links">
          <a
            href="https://github.com/philippfromme/traverse"
            target="_blank"
            rel="noopener"
            >GitHub</a
          >
        </div>
      </footer>
    `;
  }
}

customElements.define("app-footer", AppFooter);
