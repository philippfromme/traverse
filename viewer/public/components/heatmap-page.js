import { LitElement, html } from "lit";

import { formatType } from "./utils.js";
import "./heatmap-map.js";
import "./custom-select.js";

class HeatmapPage extends LitElement {
  static properties = {
    _types: { state: true },
    _selectedType: { state: true },
  };

  createRenderRoot() {
    return this;
  }

  constructor() {
    super();
    this._types = [];
    this._selectedType = "";
  }

  connectedCallback() {
    super.connectedCallback();
    this._loadTypes();
  }

  async _loadTypes() {
    const res = await fetch("/api/activities");
    if (!res.ok) return;
    const { types } = await res.json();
    this._types = types || [];
  }

  _onTypeChange(e) {
    this._selectedType = e.target.value;
    this.renderRoot.querySelector("heatmap-map").reload(this._selectedType);
  }

  render() {
    return html`
      <div class="heatmap-controls">
        <custom-select
          .value=${this._selectedType}
          @change=${this._onTypeChange}
          .items=${[
            { value: "", label: "All types" },
            ...this._types.map((t) => ({ value: t, label: formatType(t) })),
          ]}
        ></custom-select>
      </div>
      <heatmap-map class="heatmap-map"></heatmap-map>
    `;
  }
}

customElements.define("heatmap-page", HeatmapPage);
