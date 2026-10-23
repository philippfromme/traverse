class CustomCheckbox extends HTMLElement {
  constructor() {
    super();
    this._checked = false;
    this._disabled = false;
    this._label = "";
  }

  connectedCallback() {
    if (!this._input) {
      const trigger = document.createElement("label");
      trigger.className = "custom-checkbox-trigger";

      const input = document.createElement("input");
      input.type = "checkbox";
      input.className = "custom-checkbox-input";
      input.addEventListener("change", (event) => {
        event.stopPropagation();
        this._checked = input.checked;
        this._sync();
        this.dispatchEvent(new Event("change", { bubbles: true }));
      });

      const mark = document.createElement("span");
      mark.className = "custom-checkbox-mark";
      mark.setAttribute("aria-hidden", "true");

      const text = document.createElement("span");
      text.className = "custom-checkbox-label";

      trigger.append(input, mark, text);
      this.append(trigger);
      this._input = input;
      this._trigger = trigger;
      this._text = text;
    }
    this._sync();
  }

  get checked() { return this._checked; }
  set checked(value) { this._checked = !!value; this._sync(); }

  get disabled() { return this._disabled; }
  set disabled(value) { this._disabled = !!value; this._sync(); }

  get label() { return this._label; }
  set label(value) { this._label = String(value ?? ""); this._sync(); }

  _sync() {
    if (!this._input) return;
    this._input.checked = this._checked;
    this._input.disabled = this._disabled;
    this._input.setAttribute("aria-label", this.getAttribute("aria-label") || this._label);
    this._trigger.classList.toggle("checked", this._checked);
    this._trigger.classList.toggle("disabled", this._disabled);
    this._text.textContent = this._label;
  }
}

customElements.define("custom-checkbox", CustomCheckbox);
