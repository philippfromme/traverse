import { cssVar } from "./utils.js";

class HeartRateChart extends HTMLElement {
  connectedCallback() {
    this._canvas = document.createElement("canvas");
    this._canvas.style.width = "100%";
    this._canvas.style.height = "100%";
    this._canvas.style.display = "block";
    this.appendChild(this._canvas);
    this.style.display = "block";

    if (this._heartRates) {
      this._draw();
    }

    this._resizeObserver = new ResizeObserver(() => {
      if (this._heartRates) this._draw();
    });
    this._resizeObserver.observe(this);
  }

  disconnectedCallback() {
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
    }
  }

  set data({ distances, heartRates }) {
    this._distances = distances;
    this._heartRates = heartRates;

    if (this._canvas && this.isConnected) {
      this._draw();
    }
  }

  _draw() {
    const canvas = this._canvas;
    const distances = this._distances;
    const heartRates = this._heartRates;

    if (!heartRates || heartRates.length < 2) return;

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
    const padBottom = 32;
    const chartW = w - padLeft - padRight;
    const chartH = h - padTop - padBottom;

    const minHr = Math.min(...heartRates);
    const maxHr = Math.max(...heartRates);
    const hrRange = maxHr - minHr || 1;
    const maxDist = distances[distances.length - 1] || 1;

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

      const val = minHr + (hrRange * i) / gridLines;
      ctx.fillText(`${Math.round(val)}`, padLeft - 8, y + 4);
    }

    // x-axis labels
    const xLabels = 5;
    ctx.textAlign = "center";
    for (let i = 0; i <= xLabels; i++) {
      const dist = (maxDist * i) / xLabels;
      const x = padLeft + (i / xLabels) * chartW;
      const label =
        dist >= 1000
          ? `${(dist / 1000).toFixed(1)} km`
          : `${Math.round(dist)} m`;
      ctx.fillText(label, x, padTop + chartH + 20);
    }

    // filled area
    ctx.beginPath();
    for (let i = 0; i < heartRates.length; i++) {
      const x = padLeft + (distances[i] / maxDist) * chartW;
      const y = padTop + chartH - ((heartRates[i] - minHr) / hrRange) * chartH;
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    // close the path along the bottom
    ctx.lineTo(
      padLeft + (distances[distances.length - 1] / maxDist) * chartW,
      padTop + chartH,
    );
    ctx.lineTo(padLeft, padTop + chartH);
    ctx.closePath();
    ctx.fillStyle = cssVar("--red") + "26";
    ctx.fill();

    // line on top
    ctx.beginPath();
    for (let i = 0; i < heartRates.length; i++) {
      const x = padLeft + (distances[i] / maxDist) * chartW;
      const y = padTop + chartH - ((heartRates[i] - minHr) / hrRange) * chartH;
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.strokeStyle = cssVar("--red");
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

customElements.define("heart-rate-chart", HeartRateChart);
