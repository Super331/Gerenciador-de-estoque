const elements = {
  alertBanner: document.querySelector("#alert-banner"),
  alertTitle: document.querySelector("#alert-title"),
  alertDetail: document.querySelector("#alert-detail"),
  metricProducts: document.querySelector("#metric-products"),
  metricUnits: document.querySelector("#metric-units"),
  metricAlerts: document.querySelector("#metric-alerts"),
  metricAlertFoot: document.querySelector("#metric-alert-foot"),
  productCount: document.querySelector("#product-count"),
  productRows: document.querySelector("#product-rows"),
  productsEmpty: document.querySelector("#products-empty"),
  filterEmpty: document.querySelector("#filter-empty"),
  search: document.querySelector("#search-products"),
  stockFilter: document.querySelector("#stock-filter"),
  movementProduct: document.querySelector("#movement-product"),
  movementForm: document.querySelector("#movement-form"),
  movementError: document.querySelector("#movement-error"),
  movementList: document.querySelector("#movement-list"),
  movementsEmpty: document.querySelector("#movements-empty"),
  dialog: document.querySelector("#product-dialog"),
  productForm: document.querySelector("#product-form"),
  productError: document.querySelector("#product-error"),
  toast: document.querySelector("#toast"),
};

let dashboard = { products: [], movements: [], alerts: [], summary: {} };
let toastTimer;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function localDateTimeValue(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function showToast(message, isError = false) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle("toast-error", isError);
  elements.toast.hidden = false;
  toastTimer = setTimeout(() => { elements.toast.hidden = true; }, 4200);
}

function productStatus(product) {
  if (product.quantity === 0) return { className: "stock-empty", label: "Zerado" };
  if (product.quantity <= product.minimum_quantity) return { className: "stock-low", label: "Estoque baixo" };
  return { className: "stock-ok", label: "Disponível" };
}

function renderProducts() {
  const searchTerm = elements.search.value.trim().toLocaleLowerCase("pt-BR");
  const filter = elements.stockFilter.value;
  const filtered = dashboard.products.filter((product) => {
    const matchesSearch = `${product.name} ${product.sku ?? ""} ${product.category}`.toLocaleLowerCase("pt-BR").includes(searchTerm);
    const matchesFilter = filter === "all"
      || (filter === "attention" && product.quantity <= product.minimum_quantity)
      || (filter === "available" && product.quantity > product.minimum_quantity);
    return matchesSearch && matchesFilter;
  });

  elements.productRows.innerHTML = filtered.map((product) => {
    const status = productStatus(product);
    const initials = product.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("");
    return `<tr>
      <td><div class="product-main"><span class="product-tile">${escapeHtml(initials)}</span><div><div class="product-name" title="${escapeHtml(product.name)}">${escapeHtml(product.name)}</div><div class="product-category">${escapeHtml(product.category || "Sem categoria")}</div></div></div></td>
      <td class="sku-cell">${escapeHtml(product.sku || "—")}</td>
      <td class="quantity-cell">${product.quantity}<span class="quantity-unit">un.</span></td>
      <td><span class="stock-badge ${status.className}">${status.label}</span></td>
      <td><button class="row-action" type="button" data-product-id="${product.id}" title="Registrar movimentação para ${escapeHtml(product.name)}" aria-label="Registrar movimentação para ${escapeHtml(product.name)}">···</button></td>
    </tr>`;
  }).join("");

  elements.productsEmpty.hidden = dashboard.products.length > 0;
  elements.filterEmpty.hidden = dashboard.products.length === 0 || filtered.length > 0;
  elements.productCount.textContent = `${filtered.length} ${filtered.length === 1 ? "item" : "itens"}`;
  elements.movementProduct.innerHTML = '<option value="">Selecione um produto</option>' + dashboard.products.map((product) =>
    `<option value="${product.id}">${escapeHtml(product.name)} · ${product.quantity} un.</option>`
  ).join("");
}

function renderAlerts() {
  const emptyProducts = dashboard.alerts.filter((product) => product.quantity === 0);
  const lowProducts = dashboard.alerts.filter((product) => product.quantity > 0);
  elements.alertBanner.hidden = dashboard.alerts.length === 0;
  if (dashboard.alerts.length) {
    elements.alertTitle.textContent = emptyProducts.length
      ? `${emptyProducts.length} ${emptyProducts.length === 1 ? "produto zerado" : "produtos zerados"}${lowProducts.length ? ` · ${lowProducts.length} com estoque baixo` : ""}`
      : `${lowProducts.length} ${lowProducts.length === 1 ? "produto precisa" : "produtos precisam"} de atenção`;
    const names = dashboard.alerts.slice(0, 4).map((product) => product.name);
    const remaining = dashboard.alerts.length - names.length;
    elements.alertDetail.textContent = `${names.join(", ")}${remaining > 0 ? ` e mais ${remaining}` : ""}. Verifique os níveis de reposição.`;
  }
  elements.metricAlertFoot.textContent = `${dashboard.summary.empty_count || 0} zerado(s) · ${Math.max(0, (dashboard.summary.low_stock_count || 0) - (dashboard.summary.empty_count || 0))} baixo(s)`;
}

function renderMovements() {
  elements.movementList.innerHTML = dashboard.movements.map((movement) => {
    const isEntry = movement.movement_type === "entry";
    const label = isEntry ? "Entrada" : "Saída";
    return `<div class="history-item">
      <span class="history-mark ${isEntry ? "entry" : "exit"}" aria-label="${label}">${isEntry ? "↓" : "↑"}</span>
      <div class="history-product">${escapeHtml(movement.product_name)}<span class="history-note">${escapeHtml(movement.note || label)}</span></div>
      <span class="history-quantity ${isEntry ? "entry" : "exit"}">${isEntry ? "+" : "−"}${movement.quantity} un.</span>
      <time class="history-date" datetime="${escapeHtml(movement.occurred_at)}">${escapeHtml(formatDate(movement.occurred_at))}</time>
    </div>`;
  }).join("");
  elements.movementsEmpty.hidden = dashboard.movements.length > 0;
}

function renderDashboard() {
  elements.metricProducts.textContent = dashboard.summary.product_count ?? 0;
  elements.metricUnits.textContent = dashboard.summary.unit_count ?? 0;
  elements.metricAlerts.textContent = dashboard.summary.low_stock_count ?? 0;
  renderAlerts();
  renderProducts();
  renderMovements();
}

async function refreshDashboard() {
  const response = await fetch("/api/dashboard");
  if (!response.ok) throw new Error("Não foi possível carregar os dados do estoque.");
  dashboard = await response.json();
  renderDashboard();
}

async function postJson(path, data) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const responseText = await response.text();
  let result;
  try {
    result = JSON.parse(responseText);
  } catch {
    throw new Error("O servidor não retornou uma resposta válida. Confirme se app.py está em execução e tente novamente.");
  }
  if (!response.ok) throw new Error(result.error || "Não foi possível salvar.");
  return result;
}

function setMovementType(type) {
  document.querySelectorAll(".segment").forEach((button) => {
    const active = button.dataset.type === type;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelector("#movement-type").value = type;
  document.querySelector("#submit-label").textContent = type === "entry" ? "Registrar entrada" : "Registrar saída";
  elements.movementError.hidden = true;
}

function openProductDialog() {
  elements.productError.hidden = true;
  elements.dialog.showModal();
}

document.querySelector("#today-label").textContent = new Intl.DateTimeFormat("pt-BR", { dateStyle: "full" }).format(new Date());
document.querySelector("#current-date").textContent = new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date());
document.querySelector("#movement-date").value = localDateTimeValue();
document.querySelector("#open-product-dialog").addEventListener("click", openProductDialog);
document.querySelector("#empty-add-product").addEventListener("click", openProductDialog);
document.querySelector("#close-product-dialog").addEventListener("click", () => elements.dialog.close());
document.querySelector("#cancel-product").addEventListener("click", () => elements.dialog.close());
document.querySelectorAll(".segment").forEach((button) => button.addEventListener("click", () => setMovementType(button.dataset.type)));
elements.search.addEventListener("input", renderProducts);
elements.stockFilter.addEventListener("change", renderProducts);

document.querySelectorAll(".nav-link").forEach((link) => link.addEventListener("click", () => {
  document.querySelectorAll(".nav-link").forEach((item) => item.classList.remove("active"));
  link.classList.add("active");
}));

document.addEventListener("keydown", (event) => {
  if (event.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) {
    event.preventDefault();
    elements.search.focus();
  }
});

elements.productRows.addEventListener("click", (event) => {
  const button = event.target.closest("[data-product-id]");
  if (!button) return;
  elements.movementProduct.value = button.dataset.productId;
  document.querySelector("#movement-quantity").focus();
  document.querySelector(".movement-panel").scrollIntoView({ behavior: "smooth", block: "center" });
});

elements.productForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.productError.hidden = true;
  const formData = new FormData(elements.productForm);
  const data = Object.fromEntries(formData.entries());
  data.initial_quantity = Number(data.initial_quantity);
  data.minimum_quantity = Number(data.minimum_quantity);
  try {
    await postJson("/api/products", data);
    elements.dialog.close();
    elements.productForm.reset();
    elements.productForm.elements.minimum_quantity.value = "5";
    await refreshDashboard();
    showToast("Produto cadastrado com sucesso.");
  } catch (error) {
    elements.productError.textContent = error.message;
    elements.productError.hidden = false;
  }
});

elements.movementForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.movementError.hidden = true;
  const movementType = document.querySelector("#movement-type").value;
  const data = {
    product_id: Number(elements.movementProduct.value),
    movement_type: movementType,
    quantity: Number(document.querySelector("#movement-quantity").value),
    occurred_at: document.querySelector("#movement-date").value,
    note: document.querySelector("#movement-note").value,
  };
  try {
    const result = await postJson("/api/movements", data);
    elements.movementForm.reset();
    document.querySelector("#movement-date").value = localDateTimeValue();
    setMovementType("entry");
    await refreshDashboard();
    const message = result.is_empty
      ? `Alerta: ${result.product_name} ficou sem estoque. Reposição necessária.`
      : `${movementType === "entry" ? "Entrada" : "Saída"} registrada. Saldo atual: ${result.quantity} unidade(s).`;
    showToast(message, result.is_empty);
  } catch (error) {
    elements.movementError.textContent = error.message;
    elements.movementError.hidden = false;
  }
});

refreshDashboard().catch((error) => showToast(error.message, true));