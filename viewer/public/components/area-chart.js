import { cssVar } from "./utils.js";

class AreaChart extends HTMLElement {
  connectedCallback() {
    this._canvas = document.createElement("canvas");
    this._canvas.style.width = "100%";
    this._canvas.style.height = "100%";
    this._canvas.style.display = "block";
    this.appendChild(this._canvas);
    this.style.display = "block";

    if (this._values) {
      this._draw();
    }

    this._resizeObserver = new ResizeObserver(() => {
      if (this._values) this._draw();
    });
    this._resizeObserver.observe(this);
  }

  disconnectedCallback() {
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
    }
  }

  set data({ labels, values, unit }) {
    this._labels = labels;
    this._values = values;
    this._unit = unit;

    if (this._canvas && this.isConnected) {
      this._draw();
    }
  }

  _draw() {
    const canvas = this._canvas;
    const labels = this._labels;
    const values = this._values;
    const unit = this._unit;

    if (!values || values.length < 2) return;

    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const padLeft = 60;
    const padRight = 16;
    const padTop = 16;
    const padBottom = 56;
    const chartW = w - padLeft - padRight;
    const chartH = h - padTop - padBottom;

    const maxVal = Math.max(...values, 1);

    ctx.clearRect(0, 0, w, h);

    // grid lines
    const gridLines = 4;
    ctx.strokeStyle = "#23232a";
    ctx.lineWidth = 1;
    ctx.font = "11px 'Geist', system-ui, sans-serif";
    ctx.fillStyle = "#9a9aa3";
    ctx.textAlign = "right";

    for (let i = 0; i <= gridLines; i++) {
      const y = padTop + chartH - (i / gridLines) * chartH;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(padLeft + chartW, y);
      ctx.stroke();

      const val = (maxVal * i) / gridLines;
      let label;
      if (unit === "km") {
        label = val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val.toFixed(0);
      } else if (unit === "h") {
        label = `${(val / 3600).toFixed(0)}h`;
      } else {
        label = val.toFixed(0);
      }
      ctx.fillText(label, padLeft - 8, y + 4);
    }

    // filled area
    ctx.beginPath();
    for (let i = 0; i < values.length; i++) {
      const x = padLeft + (i / (values.length - 1)) * chartW;
      const y = padTop + chartH - (values[i] / maxVal) * chartH;
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.lineTo(padLeft + chartW, padTop + chartH);
    ctx.lineTo(padLeft, padTop + chartH);
    ctx.closePath();
    ctx.fillStyle = cssVar("--green") + "26";
    ctx.fill();

    // line on top
    ctx.beginPath();
    for (let i = 0; i < values.length; i++) {
      const x = padLeft + (i / (values.length - 1)) * chartW;
      const y = padTop + chartH - (values[i] / maxVal) * chartH;
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.strokeStyle = cssVar("--green");
    ctx.lineWidth = 2;
    ctx.stroke();

    // x-axis labels
    ctx.fillStyle = "#9a9aa3";
    ctx.font = "11px 'Geist', system-ui, sans-serif";
    ctx.textAlign = "center";
    const labelEvery = Math.max(1, Math.ceil(labels.length / 12));
    for (let i = 0; i < labels.length; i += labelEvery) {
      const x = padLeft + (i / (values.length - 1)) * chartW;
      ctx.save();
      ctx.translate(x, padTop + chartH + 10);
      ctx.rotate(-Math.PI / 4);
      ctx.textAlign = "right";
      ctx.fillText(labels[i], 0, 0);
      ctx.restore();
    }
  }
}

customElements.define("area-chart", AreaChart);
