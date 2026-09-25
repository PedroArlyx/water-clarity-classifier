"use strict";

// Seletor de métrica do gráfico comparativo (os dados já vêm renderizados do servidor).
const buttons = [...document.querySelectorAll("#metric-switch [data-metric]")];
const panels = [...document.querySelectorAll("[data-panel]")];

function select(button) {
    for (const other of buttons) {
        const active = other === button;
        other.setAttribute("aria-checked", String(active));
        other.tabIndex = active ? 0 : -1;
    }
    for (const panel of panels) panel.hidden = panel.dataset.panel !== button.dataset.metric;
}

buttons.forEach((button, index) => {
    button.tabIndex = button.getAttribute("aria-checked") === "true" ? 0 : -1;
    button.addEventListener("click", () => select(button));
    button.addEventListener("keydown", (event) => {
        const delta = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
        if (!delta) return;
        event.preventDefault();
        const next = buttons[(index + delta + buttons.length) % buttons.length];
        next.focus();
        select(next);
    });
});
