import { cssVar } from "./utils.js";

class StatsChart extends HTMLElement {
  connectedCallback() {
    this.style.display = "block";
    this.style.position = "relative";
    this._canvas = document.createElement("canvas");
    this._canvas.style.cssText = "width:100%;height:100%;display:block;cursor:pointer";
    this._canvas.tabIndex = 0;
    this._canvas.setAttribute("role", "button");
    this._canvas.setAttribute("aria-label", "Chart. Use arrow keys to choose a period, then Enter to show its activities.");
    this._tooltip = document.createElement("div");
    this._tooltip.className = "stats-chart-tooltip";
    this._tooltip.hidden = true;
    this.append(this._canvas, this._tooltip);
    this._canvas.addEventListener("pointermove", (event) => this._onPointerMove(event));
    this._canvas.addEventListener("pointerleave", () => { this._tooltip.hidden = true; });
    this._canvas.addEventListener("click", (event) => this._select(this._indexAt(event.offsetX)));
    this._canvas.addEventListener("keydown", (event) => this._onKeydown(event));
    this._resizeObserver = new ResizeObserver(() => this._draw());
    this._resizeObserver.observe(this);
    this._draw();
  }

  disconnectedCallback() {
    this._resizeObserver?.disconnect();
  }

  set data(value) {
    this._data = value;
    this._draw();
  }

  _indexAt(x) {
    const count = this._data?.labels?.length || 0;
    if (!count || x < 54 || x > this.clientWidth - 16) return -1;
    const width = this.clientWidth - 70;
    return Math.min(count - 1, Math.floor(((x - 54) / width) * count));
  }

  _select(index) {
    if (index < 0 || index >= (this._data?.labels?.length || 0)) return;
    this._keyboardIndex = index;
    this.dispatchEvent(new CustomEvent("bucket-select", { detail: { index }, bubbles: true }));
  }

  _onKeydown(event) {
    const count = this._data?.labels?.length || 0;
    if (!count) return;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      this._keyboardIndex = Math.max(0, Math.min(count - 1,
        (this._keyboardIndex ?? this._data.selectedIndex ?? 0) + (event.key === "ArrowRight" ? 1 : -1)));
      this._showTooltip(this._keyboardIndex);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      this._select(this._keyboardIndex ?? this._data.selectedIndex ?? 0);
    }
  }

  _onPointerMove(event) {
    this._showTooltip(this._indexAt(event.offsetX));
  }

  _showTooltip(index) {
    if (index < 0 || !this._data?.labels?.[index]) {
      this._tooltip.hidden = true;
      return;
    }
    const { labels, values, previous, unit } = this._data;
    const format = (n) => unit === "km" ? `${n.toFixed(1)} km`
      : unit === "h" ? `${n.toFixed(1)} h` : String(n);
    this._tooltip.textContent = `${labels[index]} · ${format(values[index])}${previous ? ` · Previous: ${format(previous[index])}` : ""}`;
    this._tooltip.style.left = `${Math.max(8, Math.min(this.clientWidth - 220, 54 + ((index + 0.5) / labels.length) * (this.clientWidth - 70)))}px`;
    this._tooltip.hidden = false;
  }

  _draw() {
    if (!this._canvas || !this.isConnected || !this._data) return;
    const { labels, values, previous, type, unit, selectedIndex } = this._data;
    const rect = this.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    if (!w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    this._canvas.width = Math.round(w * dpr);
    this._canvas.height = Math.round(h * dpr);
    const ctx = this._canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    const left = 54, right = 16, top = 18, bottom = 48;
    const chartW = w - left - right, chartH = h - top - bottom;
    if (chartW <= 0 || chartH <= 0) return;
    const count = labels.length;
    const max = Math.max(1, ...values, ...(previous || []));
    const y = (value) => top + chartH - (value / max) * chartH;
    ctx.font = "11px 'Geist', system-ui, sans-serif";
    ctx.textAlign = "right";
    for (let i = 0; i <= 4; i++) {
      const value = (max * i) / 4;
      const py = y(value);
      ctx.strokeStyle = "#33333b";
      ctx.beginPath(); ctx.moveTo(left, py); ctx.lineTo(left + chartW, py); ctx.stroke();
      ctx.fillStyle = "#9a9aa3";
      ctx.fillText(unit === "h" ? `${value.toFixed(0)}h` : unit === "km" ? `${value.toFixed(0)}` : value.toFixed(0), left - 7, py + 4);
    }
    if (!count) return;
    const step = chartW / count;
    if (selectedIndex != null && selectedIndex >= 0 && selectedIndex < count) {
      ctx.fillStyle = "rgba(255,255,255,.07)";
      ctx.fillRect(left + selectedIndex * step, top, step, chartH);
    }
    const accent = cssVar("--accent");
    const drawLine = (series, color, fill) => {
      ctx.beginPath();
      series.forEach((value, i) => {
        const px = left + (i + 0.5) * step;
        if (i === 0) ctx.moveTo(px, y(value)); else ctx.lineTo(px, y(value));
      });
      if (fill) {
        ctx.lineTo(left + (count - 0.5) * step, top + chartH);
        ctx.lineTo(left + 0.5 * step, top + chartH);
        ctx.closePath();
        ctx.fillStyle = `${accent}26`;
        ctx.fill();
        ctx.beginPath();
        series.forEach((value, i) => {
          const px = left + (i + 0.5) * step;
          if (i === 0) ctx.moveTo(px, y(value)); else ctx.lineTo(px, y(value));
        });
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
      if (count === 1) {
        ctx.beginPath(); ctx.arc(left + step / 2, y(series[0]), 3, 0, Math.PI * 2);
        ctx.fillStyle = color; ctx.fill();
      }
    };
    if (type === "bar") {
      values.forEach((value, i) => {
        const width = Math.max(1, Math.min(40, step * (previous ? 0.34 : 0.68)));
        const center = left + (i + 0.5) * step;
        if (previous) {
          ctx.fillStyle = "#9999a3";
          ctx.fillRect(center - width - 1, y(previous[i]), width, top + chartH - y(previous[i]));
        }
        ctx.fillStyle = accent;
        ctx.fillRect(center + (previous ? 1 : -width / 2), y(value), width, top + chartH - y(value));
      });
    } else {
      if (previous) drawLine(previous, "#aaaab3", false);
      drawLine(values, accent, type === "area");
    }
    ctx.fillStyle = "#9a9aa3";
    ctx.textAlign = "center";
    const labelEvery = Math.max(1, Math.ceil(count / Math.max(2, Math.floor(chartW / 85))));
    for (let i = 0; i < count; i += labelEvery) {
      ctx.save();
      ctx.translate(left + (i + 0.5) * step, top + chartH + 12);
      ctx.rotate(-Math.PI / 4);
      ctx.textAlign = "right";
      ctx.fillText(labels[i], 0, 0);
      ctx.restore();
    }
  }
}

customElements.define("stats-chart", StatsChart);
