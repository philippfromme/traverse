import { LitElement, html } from "lit";

import { formatType } from "./utils.js";
import "./heatmap-map.js";
import "./custom-select.js";

class HeatmapPage extends LitElement {
  static properties = {
    _types: { state: true },
    _selectedType: { state: true },
    _mode: { state: true },
  };

  createRenderRoot() {
    return this;
  }

  constructor() {
    super();
    this._types = [];
    this._selectedType = "";
    this._mode = new URLSearchParams(location.search).get("view") === "tracks" ? "tracks" : "heatmap";
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
    this.renderRoot.querySelector("heatmap-map").reload(this._selectedType, this._mode);
  }

  _onModeChange(e) {
    const mode = e.target.value;
    if (mode === this._mode) return;
    this._mode = mode;
    const url = new URL(location.href);
    if (mode === "tracks") url.searchParams.set("view", "tracks");
    else url.searchParams.delete("view");
    history.replaceState(null, "", url);
    this.renderRoot.querySelector("heatmap-map").reload(this._selectedType, mode);
  }

  render() {
    return html`
      <div class="heatmap-controls">
        <custom-select
          aria-label="Map view"
          .value=${this._mode}
          @change=${this._onModeChange}
          .items=${[
            { value: "heatmap", label: "Heatmap" },
            { value: "tracks", label: "Tracks" },
          ]}
        ></custom-select>
        <custom-select
          aria-label="Activity type"
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
