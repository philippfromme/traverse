import {
  getMapStylePreference,
  setMapStylePreference,
  MAP_STYLE_CHANGE_EVENT,
} from "./map-style.js";
import "./custom-select.js";

class MapStyleSelect extends HTMLElement {
  connectedCallback() {
    if (!this._select) {
      this._select = document.createElement("custom-select");
      this._select.setAttribute("aria-label", "Map style");
      this._select.items = [
        { value: "dark", label: "Dark map" },
        { value: "streets", label: "Street map" },
      ];
      this.append(this._select);
    }
    this._select.value = getMapStylePreference();
    this._onChange = () => setMapStylePreference(this._select.value);
    this._onStyleChange = () => {
      this._select.value = getMapStylePreference();
    };
    this._select.addEventListener("change", this._onChange);
    window.addEventListener(MAP_STYLE_CHANGE_EVENT, this._onStyleChange);
  }

  disconnectedCallback() {
    this._select?.removeEventListener("change", this._onChange);
    window.removeEventListener(MAP_STYLE_CHANGE_EVENT, this._onStyleChange);
  }
}

customElements.define("map-style-select", MapStyleSelect);
