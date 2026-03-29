class CustomSelect extends HTMLElement {
  constructor() {
    super();
    this._open = false;
    this._items = [];
    this._value = "";
    this._onDocClick = this._onDocClick.bind(this);
  }

  connectedCallback() {
    document.addEventListener("click", this._onDocClick);
    this._render();
  }

  disconnectedCallback() {
    document.removeEventListener("click", this._onDocClick);
  }

  get items() {
    return this._items;
  }

  set items(val) {
    this._items = val || [];
    this._render();
  }

  get value() {
    return this._value;
  }

  set value(val) {
    this._value = val;
    this._render();
  }

  _onDocClick(e) {
    if (!this.contains(e.target) && this._open) {
      this._open = false;
      this._render();
    }
  }

  get _selectedLabel() {
    const item = this._items.find((o) => o.value === this._value);
    return item ? item.label : "";
  }

  _toggle(e) {
    e.stopPropagation();
    const opening = !this._open;
    if (opening) {
      document.querySelectorAll("custom-select").forEach((el) => {
        if (el !== this && el._open) {
          el._open = false;
          el._render();
        }
      });
    }
    this._open = opening;
    this._render();
  }

  _select(val) {
    this._value = val;
    this._open = false;
    this._render();
    this.dispatchEvent(new Event("change", { bubbles: true }));
  }

  _render() {
    if (!this.isConnected) return;

    this.innerHTML = "";

    const wrapper = document.createElement("div");
    wrapper.className = "custom-select" + (this._open ? " open" : "");

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "custom-select-trigger";
    trigger.addEventListener("click", (e) => this._toggle(e));

    const label = document.createElement("span");
    label.className = "custom-select-label";
    label.textContent = this._selectedLabel;

    const chevron = document.createElement("span");
    chevron.className = "material-symbols-outlined custom-select-chevron";
    chevron.textContent = "expand_more";

    trigger.append(label, chevron);
    wrapper.append(trigger);

    if (this._open) {
      const dropdown = document.createElement("div");
      dropdown.className = "custom-select-dropdown";

      for (const item of this._items) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className =
          "custom-select-option" +
          (item.value === this._value ? " selected" : "");
        btn.textContent = item.label;
        btn.addEventListener("click", () => this._select(item.value));
        dropdown.append(btn);
      }

      wrapper.append(dropdown);
    }

    this.append(wrapper);
  }
}

customElements.define("custom-select", CustomSelect);
