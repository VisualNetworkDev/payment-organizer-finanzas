const CONFIG = {
  apiUrl: 'https://script.google.com/macros/s/AKfycbzMdsCVqnA9VUbXPZP3b_xBvUcCIlbKM7MFw5RoqowR5gmo_RTXHmP5dzmNpLqvwVy5/exec',
  timeoutMs: 30000,
  cacheTtlMs: 90000,
  busyDelayMs: 220,
  loginCooldownMs: 1200
};

const MUTATING_ACTIONS = new Set([
  'changePassword',
  'saveAccount',
  'updateAccountBalance',
  'createTransfer',
  'saveIncomeSource',
  'deleteIncomeSource',
  'savePaycheck',
  'verifyPaycheck',
  'markPaycheckNotReceived',
  'saveBill',
  'deleteBill',
  'markBillPaid',
  'markBillPartial',
  'saveDebt',
  'deleteDebt',
  'makeDebtPayment',
  'generateWeeklyChecklist',
  'completeChecklistItem',
  'reopenChecklistItem',
  'createNotification',
  'markNotificationRead',
  'snoozeNotification',
  'resolveNotification',
  'importData',
  'saveSettings',
  'markGasCovered',
  'markPhoneInternetReserved',
  'saveWorkShift',
  'deleteWorkShift',
  'seedUserFinancialData'
]);

const NAV = [
  ['today', 'Hoy', 'sparkles'],
  ['paychecks', 'Cheques', 'badge-dollar-sign'],
  ['bills', 'Pagos', 'receipt'],
  ['money', 'Mi dinero', 'wallet'],
  ['more', 'Mas', 'more-horizontal']
];

const MORE_NAV = [
  ['accounts', 'Cuentas', 'wallet'],
  ['debts', 'Deudas', 'trending-down'],
  ['shifts', 'Turnos', 'clock'],
  ['calendar', 'Calendario', 'calendar-days'],
  ['checklist', 'Checklist', 'list-checks'],
  ['notifications', 'Alertas', 'bell'],
  ['settings', 'Configuracion', 'settings'],
  ['backup', 'Backup', 'archive'],
  ['dashboard', 'Resumen avanzado', 'layout-dashboard']
];

const state = {
  token: localStorage.getItem('mcf_token') || '',
  user: null,
  activeView: 'today',
  simpleMode: localStorage.getItem('mcf_mode') !== 'advanced',
  cache: {},
  requestCache: {},
  inFlight: {},
  busyCount: 0,
  busyTimer: 0,
  loginLockedUntil: 0
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

document.addEventListener('DOMContentLoaded', init);

function init() {
  renderNav();
  bindShell();
  if (state.token) {
    validateSavedSession();
  } else {
    showLogin();
  }
  refreshIcons();
}

function bindShell() {
  $('#loginForm').addEventListener('submit', handleLogin);
  $('#logoutButton').addEventListener('click', handleLogout);
  $('#refreshButton').addEventListener('click', () => {
    clearRequestCache();
    renderView(state.activeView, true);
  });
  $('#menuToggle').addEventListener('click', () => $('.sidebar').classList.toggle('open'));
  $('#forcedPasswordForm').addEventListener('submit', handleForcedPassword);
  document.addEventListener('click', handlePasswordToggle);
}

function renderNav() {
  $('#mainNav').innerHTML = NAV.map(([id, label, icon]) => `
    <button class="nav-item ${navIsActive(id) ? 'active' : ''}" data-view="${id}" type="button">
      <i data-lucide="${icon}"></i>
      <span>${label}</span>
    </button>
  `).join('');

  $$('.nav-item').forEach((button) => {
    button.addEventListener('click', () => {
      $('.sidebar').classList.remove('open');
      if (button.dataset.view === state.activeView) {
        return;
      }
      renderView(button.dataset.view);
    });
  });
}

function navIsActive(id) {
  if (id === state.activeView) return true;
  if (id === 'more') {
    return MORE_NAV.some(([view]) => view === state.activeView) || state.activeView === 'incomes';
  }
  return false;
}

function navItem(viewId) {
  return NAV.concat(MORE_NAV, [['incomes', 'Ingresos', 'banknote'], ['whatnow', 'Que hago ahora', 'circle-help']])
    .find(([id]) => id === viewId);
}

async function validateSavedSession() {
  try {
    showApp();
    $('#view').innerHTML = '<div class="empty">Cargando Hoy...</div>';
    const data = await api('bootstrap');
    state.user = data.user;
    state.cache.settings = data.settings || {};
    if (data.todayData) {
      setApiCache('getViewData', viewPayload('today'), data.todayData);
    }
    toggleForcedPassword(Boolean(state.user.mustChangePassword));
    await renderView(state.user.mustChangePassword ? 'settings' : 'today', false);
  } catch (error) {
    localStorage.removeItem('mcf_token');
    state.token = '';
    showLogin();
    toast(error.message || 'Sesion vencida.');
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (Date.now() < state.loginLockedUntil) {
    toast('Espera un momento antes de intentar otra vez.');
    return;
  }

  const payload = formValues(form);
  try {
    setBusy(true);
    setFormDisabled(form, true);
    const data = await api('login', { ...payload, includeToday: true }, { skipToken: true });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('mcf_token', state.token);
    clearRequestCache();
    if (data.todayData) {
      setApiCache('getViewData', viewPayload('today'), data.todayData);
    }
    showApp();
    toggleForcedPassword(Boolean(state.user.mustChangePassword));
    await renderView(state.user.mustChangePassword ? 'settings' : 'today', false);
  } catch (error) {
    state.loginLockedUntil = Date.now() + CONFIG.loginCooldownMs;
    toast(error.message);
  } finally {
    setFormDisabled(form, false);
    setBusy(false);
  }
}

async function handleLogout() {
  try {
    if (state.token) {
      await api('logout', { token: state.token });
    }
  } catch (error) {
    console.warn(error);
  }
  state.token = '';
  state.user = null;
  state.cache = {};
  clearRequestCache();
  localStorage.removeItem('mcf_token');
  showLogin();
}

async function handleForcedPassword(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = formValues(form);
  try {
    setBusy(true);
    await api('changePassword', payload);
    state.user.mustChangePassword = false;
    toggleForcedPassword(false);
    form.reset();
    toast('Contrasena actualizada.');
    await renderView('today', true);
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
  }
}

function showLogin() {
  $('#loginScreen').classList.remove('hidden');
  $('#appShell').classList.add('hidden');
  setBusy(false);
  refreshIcons();
}

function showApp() {
  $('#loginScreen').classList.add('hidden');
  $('#appShell').classList.remove('hidden');
  refreshIcons();
}

function toggleForcedPassword(show) {
  $('#forcedPassword').classList.toggle('hidden', !show);
}

async function renderView(viewId, force = false) {
  state.activeView = viewId;
  renderNav();
  const item = navItem(viewId) || NAV[0];
  $('#eyebrow').textContent = item[1];
  $('#viewTitle').textContent = item[1];
  const warm = hasWarmView(viewId) && !force;
  if (!warm) {
    $('#view').innerHTML = '<div class="empty">Cargando...</div>';
  }

  try {
    const renderers = {
      today: renderToday,
      dashboard: renderDashboard,
      money: renderMoney,
      more: renderMore,
      backup: renderBackup,
      accounts: renderAccounts,
      incomes: renderIncomes,
      paychecks: renderPaychecks,
      bills: renderBills,
      debts: renderDebts,
      shifts: renderShifts,
      calendar: renderCalendar,
      whatnow: renderWhatNow,
      checklist: renderChecklist,
      notifications: renderNotifications,
      settings: renderSettings
    };
    await (renderers[viewId] || renderDashboard)(force);
  } catch (error) {
    $('#view').innerHTML = `<div class="empty">${escapeHtml(error.message || 'No se pudo cargar.')}</div>`;
  } finally {
    refreshIcons();
  }
}

async function renderToday(force = false) {
  const data = await getViewData('today', force);
  state.cache.today = data;
  state.cache.dashboard = data;
  state.cache.accounts = data.accounts || [];
  state.cache.incomeSources = data.incomeSources || [];

  const status = data.financialStatus || data.recommendation || {};
  const statusLabel = status.status === 'green' ? 'Puedes avanzar' : status.status === 'yellow' ? 'Cuidado' : 'No gastar todavia';
  const nextBill = (data.upcomingBills || []).find((bill) => Number(bill.remaining || 0) > 0) || null;
  const nextPaycheck = (data.pendingPaychecks || [])[0] || data.nextPaycheck || null;
  const capitalOne = accountBalance(data.accounts, 'Capital One');
  const moneyNotToTouch = Number(status.moneyNotToTouch ?? data.totals?.reserved ?? 0);
  const freeReal = Number(status.freeReal ?? data.totals?.freeReal ?? 0);
  const steps = (status.steps || data.recommendation?.steps || []).slice(0, 3);

  $('#view').innerHTML = `
    <section class="today-shell">
      <article class="today-hero ${levelClass(status.status)}">
        <div>
          <span class="today-kicker">Estado de la semana</span>
          <h3>${escapeHtml(statusLabel)}</h3>
          <p>${escapeHtml(status.message || data.recommendation?.message || 'Revisa lo importante antes de mover dinero.')}</p>
        </div>
        <span class="status-pill ${levelClass(status.status)}">${escapeHtml(status.status || 'red')}</span>
      </article>

      <section class="money-strip">
        ${simpleMoneyCard('Capital One', capitalOne, 'Balance para pagos diarios')}
        ${simpleMoneyCard('No tocar', money(moneyNotToTouch), 'Pagos, gasolina, comida y buffer')}
        ${simpleMoneyCard('Libre real', money(freeReal), freeReal > 0 ? 'Dinero que puedes considerar' : 'No uses dinero extra ahora', freeReal > 0 ? 'green' : 'red')}
      </section>

      <section class="today-grid">
        <article class="panel today-focus">
          <div class="panel-head">
            <div>
              <h3>Proximo paso</h3>
              <p>${escapeHtml(status.title || 'Primero lo importante')}</p>
            </div>
          </div>
          <strong class="next-action">${escapeHtml(status.nextAction || steps[0] || 'Revisa pagos y cheques pendientes.')}</strong>
          <div class="mini-checklist">
            ${steps.map((step) => `<div><i data-lucide="check-circle-2"></i><span>${escapeHtml(step)}</span></div>`).join('') || '<div><i data-lucide="check-circle-2"></i><span>Sin pasos urgentes por ahora.</span></div>'}
          </div>
        </article>

        <article class="panel today-focus">
          <div class="panel-head"><h3>Lo que viene</h3></div>
          <div class="simple-list">
            <div>
              <span>Pago importante</span>
              <strong>${nextBill ? `${escapeHtml(nextBill.name)} - ${money(nextBill.remaining)}` : 'Sin pago cercano'}</strong>
              <small>${nextBill ? dateLabel(nextBill.dueDate) : 'Nada urgente registrado'}</small>
            </div>
            <div>
              <span>Cheque por verificar</span>
              <strong>${nextPaycheck ? money(nextPaycheck.netEstimated || nextPaycheck.netActual || 0) : 'Sin cheque pendiente'}</strong>
              <small>${nextPaycheck ? dateLabel(nextPaycheck.expectedDate) : 'No hay verificacion pendiente'}</small>
            </div>
          </div>
        </article>
      </section>

      <section class="quick-actions">
        <button class="quick-button" data-quick="verify-paycheck" type="button"><i data-lucide="badge-dollar-sign"></i><span>Ya recibi un cheque</span></button>
        <button class="quick-button" data-quick="payment" type="button"><i data-lucide="receipt"></i><span>Ya hice un pago</span></button>
        <button class="quick-button" data-quick="balance" type="button"><i data-lucide="wallet"></i><span>Actualizar balance</span></button>
        <button class="quick-button" data-go="whatnow" type="button"><i data-lucide="circle-help"></i><span>Calcular que hago ahora</span></button>
      </section>

      <section class="quick-secondary">
        <button class="action-button secondary" data-quick="daughter" type="button"><i data-lucide="hand-coins"></i>Pago a hija</button>
        <button class="action-button secondary" data-quick="gas" type="button"><i data-lucide="fuel"></i>Gasolina cubierta</button>
        <button class="action-button secondary" data-quick="reserve-phone" type="button"><i data-lucide="phone"></i>Telefono/internet reservado</button>
      </section>
    </section>
  `;

  bindGoButtons();
  bindQuickActions();
}

async function renderDashboard(force = false) {
  const data = await getViewData('dashboard', force);
  state.cache.dashboard = data;
  state.cache.accounts = data.accounts || [];
  state.cache.incomeSources = data.incomeSources || [];
  const actionCenter = sortByDateAsc(data.actionCenter || [], 'dueDate');
  const alerts = sortAlerts(data.alerts || []);
  const upcomingBills = sortByDateAsc(data.upcomingBills || [], 'dueDate');
  const pendingPaychecks = sortByDateAsc(data.pendingPaychecks || [], 'expectedDate');

  $('#view').innerHTML = `
    <section class="grid">
      ${metric('Capital One', accountBalance(data.accounts, 'Capital One'), 'Pagos y gastos diarios', 'info')}
      ${metric('VyStar Checking', accountBalance(data.accounts, 'VyStar Checking'), 'Dinero apartado', 'warning')}
      ${metric('VyStar Savings', accountBalance(data.accounts, 'VyStar Savings'), 'No tocar salvo emergencia', 'success')}
      ${metric('Dinero libre real', money(data.totals.freeReal), 'Despues de reservas', data.totals.freeReal < 0 ? 'critical' : 'success')}
    </section>

    <section class="grid">
      <div class="panel span-7">
        <div class="panel-head">
          <div>
            <h3>Action Center</h3>
            <p>Pasos claros para hoy</p>
          </div>
          <span class="badge blue">${escapeHtml(data.recommendation.level)}</span>
        </div>
        ${renderActionCenter(actionCenter)}
      </div>

      <div class="panel span-5">
        <div class="panel-head">
          <div>
            <h3>Recomendacion</h3>
            <p>${escapeHtml(data.recommendation.title)}</p>
          </div>
          <span class="badge ${levelClass(data.recommendation.level)}">${escapeHtml(data.recommendation.level)}</span>
        </div>
        <p>${escapeHtml(data.recommendation.message)}</p>
        <div class="list compact-list">
          ${(data.recommendation.steps || []).slice(0, 3).map((step) => `<div class="muted-line">${escapeHtml(step)}</div>`).join('')}
        </div>
        <div class="button-row">
          <button class="action-button primary" data-go="whatnow" type="button"><i data-lucide="circle-help"></i>Calcular ahora</button>
          <button class="action-button secondary" data-go="checklist" type="button"><i data-lucide="list-checks"></i>Checklist</button>
        </div>
      </div>
    </section>

    <section class="grid">
      <div class="panel span-6">
        <div class="panel-head">
          <div>
            <h3>Alertas internas</h3>
            <p>${alerts.length} activas</p>
          </div>
        </div>
        ${renderAlertList(alerts.slice(0, 6))}
      </div>

      <div class="panel span-6">
        <div class="panel-head">
          <div>
            <h3>Proximos pagos</h3>
            <p>14 dias</p>
          </div>
        </div>
        ${renderUpcomingBills(upcomingBills.slice(0, 7))}
      </div>
    </section>

    <section class="grid">
      <div class="panel span-6">
        <div class="panel-head">
          <div>
            <h3>Cheques por verificar</h3>
            <p>No cuentan como disponible hasta confirmar</p>
          </div>
        </div>
        ${renderPaycheckMini(pendingPaychecks)}
      </div>

      <div class="panel span-6">
        <div class="panel-head">
          <div>
            <h3>Checklist semanal</h3>
            <p>${escapeHtml(data.checklistProgress.text)}</p>
          </div>
          <span class="badge green">${data.checklistProgress.percent}%</span>
        </div>
        <div class="progress"><span style="width:${data.checklistProgress.percent}%"></span></div>
        <div class="button-row">
          <button class="action-button secondary" data-go="checklist" type="button"><i data-lucide="list-checks"></i>Abrir</button>
        </div>
      </div>
    </section>
  `;

  bindGoButtons();
}

async function renderMoney(force = false) {
  const data = await getViewData('accounts', force);
  const accounts = data.accounts || [];
  state.cache.accounts = accounts;
  $('#view').innerHTML = `
    <section class="today-shell">
      <section class="money-strip">
        ${accounts.map((account) => simpleMoneyCard(account.name, money(account.currentBalance), account.isProtected ? 'No tocar' : account.purpose || account.type, account.isProtected ? 'green' : 'blue')).join('')}
      </section>
      <section class="quick-actions">
        <button class="quick-button" data-quick="balance" type="button"><i data-lucide="wallet"></i><span>Actualizar Capital One</span></button>
        <button class="quick-button" data-go="accounts" type="button"><i data-lucide="settings-2"></i><span>Ver cuentas avanzado</span></button>
      </section>
    </section>
  `;
  bindGoButtons();
  bindQuickActions();
}

async function renderMore() {
  const advanced = state.simpleMode ? [] : [['incomes', 'Ingresos', 'banknote']];
  const items = MORE_NAV.concat(advanced);
  $('#view').innerHTML = `
    <section class="panel">
      <div class="panel-head">
        <div>
          <h3>Mas opciones</h3>
          <p>${state.simpleMode ? 'Modo simple activo' : 'Modo avanzado activo'}</p>
        </div>
        <button id="modeToggle" class="action-button secondary" type="button">
          <i data-lucide="${state.simpleMode ? 'sliders-horizontal' : 'sparkles'}"></i>${state.simpleMode ? 'Activar avanzado' : 'Volver a simple'}
        </button>
      </div>
      <div class="more-grid">
        ${items.map(([id, label, icon]) => `
          <button class="more-card" data-go="${id}" type="button">
            <i data-lucide="${icon}"></i>
            <span>${escapeHtml(label)}</span>
          </button>
        `).join('')}
      </div>
    </section>
  `;
  $('#modeToggle').addEventListener('click', () => {
    state.simpleMode = !state.simpleMode;
    localStorage.setItem('mcf_mode', state.simpleMode ? 'simple' : 'advanced');
    renderView('more', true);
  });
  bindGoButtons();
}

async function renderBackup() {
  $('#view').innerHTML = `
    <section class="panel">
      <div class="panel-head">
        <div>
          <h3>Backup</h3>
          <p>Exportar o importar datos sin tocar la vista simple.</p>
        </div>
      </div>
      <div class="button-row">
        <button id="exportBackup" class="action-button primary" type="button"><i data-lucide="download"></i>Exportar JSON</button>
        <label class="action-button secondary">
          <i data-lucide="upload"></i>
          Importar JSON
          <input id="importBackup" type="file" accept="application/json" hidden>
        </label>
      </div>
    </section>
  `;
  $('#exportBackup').addEventListener('click', exportBackup);
  $('#importBackup').addEventListener('change', importBackup);
}

async function renderAccounts(force = false) {
  const data = await getViewData('accounts', force);
  const accounts = data.accounts || [];
  const transfers = sortByDateDesc(data.transfers || [], 'date');
  state.cache.accounts = accounts;
  const accountOptions = options(accounts, 'id', 'name');

  $('#view').innerHTML = `
    <section class="grid">
      <div class="panel span-5">
        <div class="panel-head"><h3>Cuenta manual</h3></div>
        <form id="accountForm" class="form-grid">
          <input type="hidden" name="id">
          <label>Nombre<input name="name" required></label>
          <label>Tipo
            <select name="type">
              <option value="checking">Checking</option>
              <option value="savings">Savings</option>
              <option value="cash">Cash</option>
            </select>
          </label>
          <label>Balance<input name="currentBalance" type="number" step="0.01" value="0" required></label>
          <label class="full">Proposito<textarea name="purpose"></textarea></label>
          <label><input class="check-toggle" name="isProtected" type="checkbox"> No tocar</label>
          <div class="full button-row">
            <button class="action-button primary" type="submit"><i data-lucide="save"></i>Guardar</button>
            <button class="action-button secondary" type="reset"><i data-lucide="rotate-ccw"></i>Limpiar</button>
          </div>
        </form>
      </div>

      <div class="panel span-7">
        <div class="panel-head"><h3>Balances</h3></div>
        <div class="list">
          ${accounts.map((account) => `
            <article class="item-card">
              <div class="item-row">
                <div>
                  <strong>${escapeHtml(account.name)}</strong>
                  <div class="muted">${escapeHtml(account.purpose || account.type)}</div>
                </div>
                <span class="amount">${money(account.currentBalance)}</span>
              </div>
              <form class="inline-form balance-form" data-id="${escapeHtml(account.id)}">
                <input name="currentBalance" type="number" step="0.01" value="${Number(account.currentBalance || 0)}">
                <button class="action-button secondary" type="submit"><i data-lucide="refresh-cw"></i>Actualizar</button>
                <button class="action-button secondary edit-account" data-id="${escapeHtml(account.id)}" type="button"><i data-lucide="pencil"></i>Editar</button>
              </form>
            </article>
          `).join('') || empty('No hay cuentas.')}
        </div>
      </div>
    </section>

    <section class="grid">
      <div class="panel span-5">
        <div class="panel-head"><h3>Transferencia</h3></div>
        <form id="transferForm" class="form-grid">
          <label>Desde<select name="fromAccount" required>${accountOptions}</select></label>
          <label>Hacia<select name="toAccount" required>${accountOptions}</select></label>
          <label>Monto<input name="amount" type="number" step="0.01" required></label>
          <label class="wide">Razon<input name="reason"></label>
          <label class="full">Nota<textarea name="notes"></textarea></label>
          <div class="full button-row">
            <button class="action-button primary" type="submit"><i data-lucide="move-right"></i>Registrar</button>
          </div>
        </form>
      </div>
      <div class="panel span-7">
        <div class="panel-head"><h3>Historial de transferencias</h3></div>
        ${table(['Fecha', 'Desde', 'Hacia', 'Monto', 'Razon'], transfers.map((transfer) => [
          dateLabel(transfer.date),
          accountName(transfer.fromAccount),
          accountName(transfer.toAccount),
          money(transfer.amount),
          escapeHtml(transfer.reason || '')
        ]))}
      </div>
    </section>
  `;

  $('#accountForm').addEventListener('submit', submitAccount);
  $('#transferForm').addEventListener('submit', submitTransfer);
  $$('.balance-form').forEach((form) => form.addEventListener('submit', submitBalance));
  $$('.edit-account').forEach((button) => button.addEventListener('click', () => fillAccountForm(accounts.find((a) => a.id === button.dataset.id))));
}

async function renderIncomes(force = false) {
  const data = await getViewData('incomes', force);
  const sources = data.sources || [];
  const paychecks = sortByDateDesc(data.paychecks || [], 'expectedDate');
  const accounts = data.accounts || [];
  state.cache.accounts = accounts;
  state.cache.incomeSources = sources;

  $('#view').innerHTML = `
    <section class="grid">
      <div class="panel span-5">
        <div class="panel-head"><h3>Fuente de ingreso</h3></div>
        <form id="incomeSourceForm" class="form-grid">
          <input type="hidden" name="id">
          <label class="wide">Nombre<input name="name" required></label>
          <label>Tipo<select name="type"><option value="fixed">Fijo</option><option value="hourly">Por hora</option></select></label>
          <label>Pago por hora<input name="hourlyRate" type="number" step="0.01" value="0"></label>
          <label>Neto fijo<input name="fixedNetPay" type="number" step="0.01" value="0"></label>
          <label>Tax<input name="taxRate" type="number" step="0.001" value="0.12"></label>
          <label>Frecuencia<select name="payFrequency"><option value="weekly">Semanal</option><option value="manual">Manual</option></select></label>
          <label>Dia de cobro<input name="payDay" placeholder="Friday"></label>
          <label>Cuenta<select name="defaultAccount">${options(accounts, 'id', 'name')}</select></label>
          <div class="full button-row">
            <button class="action-button primary" type="submit"><i data-lucide="save"></i>Guardar</button>
          </div>
        </form>
      </div>

      <div class="panel span-7">
        <div class="panel-head"><h3>Fuentes registradas</h3></div>
        ${table(['Nombre', 'Tipo', 'Neto fijo', 'Hora', 'Tax', 'Accion'], sources.map((source) => [
          escapeHtml(source.name),
          escapeHtml(source.type),
          money(source.fixedNetPay),
          money(source.hourlyRate),
          percent(source.taxRate),
          `<button class="action-button secondary edit-source" data-id="${escapeHtml(source.id)}" type="button"><i data-lucide="pencil"></i>Editar</button>`
        ]))}
      </div>
    </section>

    <section class="grid">
      <div class="panel span-5">
        <div class="panel-head"><h3>Registrar cheque esperado</h3></div>
        <form id="paycheckForm" class="form-grid">
          <label class="wide">Fuente<select name="incomeSourceId" required>${options(sources, 'id', 'name')}</select></label>
          <label>Fecha esperada<input name="expectedDate" type="date" required value="${todayInput()}"></label>
          <label>Horas<input name="hours" type="number" step="0.01"></label>
          <label>Rate<input name="rate" type="number" step="0.01"></label>
          <label>Bono por hora<input name="bonusRate" type="number" step="0.01" value="0"></label>
          <label>Bono fijo<input name="bonusFixed" type="number" step="0.01" value="0"></label>
          <label>Cuenta<select name="account">${options(accounts, 'id', 'name')}</select></label>
          <label class="full">Notas<textarea name="notes"></textarea></label>
          <div class="full button-row">
            <button class="action-button primary" type="submit"><i data-lucide="calendar-plus"></i>Guardar cheque</button>
          </div>
        </form>
      </div>
      <div class="panel span-7">
        <div class="panel-head"><h3>Historial de cobros</h3></div>
        ${table(['Esperado', 'Fuente', 'Estimado', 'Real', 'Estado'], paychecks.map((paycheck) => [
          dateLabel(paycheck.expectedDate),
          incomeName(paycheck.incomeSourceId),
          money(paycheck.netEstimated),
          paycheck.netActual === '' ? '-' : money(paycheck.netActual),
          badge(paycheck.status === 'received' ? 'green' : paycheck.status === 'not_received' ? 'red' : 'blue', paycheck.status || 'expected')
        ]))}
      </div>
    </section>
  `;

  $('#incomeSourceForm').addEventListener('submit', submitIncomeSource);
  $('#paycheckForm').addEventListener('submit', submitPaycheck);
  $$('.edit-source').forEach((button) => button.addEventListener('click', () => fillIncomeSourceForm(sources.find((s) => s.id === button.dataset.id))));
}

async function renderPaychecks(force = false) {
  const data = await getViewData('paychecks', force);
  const pending = sortByDateAsc(data.pending || [], 'expectedDate');
  const sources = data.sources || [];
  state.cache.incomeSources = sources;
  $('#view').innerHTML = `
    <section class="panel">
      <div class="panel-head">
        <div>
          <h3>Verificacion semanal de cheques</h3>
          <p>${pending.length} pendientes</p>
        </div>
      </div>
      <div class="list">
        ${pending.map((paycheck) => `
          <article class="item-card alert ${levelClass(paycheck.alertLevel)}">
            <div class="item-row">
              <div>
                <strong>${dateLabel(paycheck.expectedDate)}</strong>
                <div class="muted">${escapeHtml(incomeName(paycheck.incomeSourceId))} - estimado ${money(paycheck.netEstimated)}</div>
              </div>
              ${badge(levelClass(paycheck.alertLevel), paycheck.alertLevel)}
            </div>
            <form class="inline-form verify-paycheck" data-id="${escapeHtml(paycheck.id)}">
              <input name="netActual" type="number" step="0.01" placeholder="Monto real" required>
              <input name="notes" placeholder="Nota">
              <button class="action-button primary" type="submit"><i data-lucide="check"></i>Recibido</button>
              <button class="action-button secondary not-received" data-id="${escapeHtml(paycheck.id)}" type="button"><i data-lucide="clock-alert"></i>No recibido</button>
            </form>
          </article>
        `).join('') || empty('No hay cheques pendientes.')}
      </div>
    </section>
  `;
  $$('.verify-paycheck').forEach((form) => form.addEventListener('submit', submitVerifyPaycheck));
  $$('.not-received').forEach((button) => button.addEventListener('click', () => markNotReceived(button.dataset.id)));
}

async function renderBills(force = false) {
  if (!state.simpleMode) {
    return renderBillsAdvanced(force);
  }
  const data = await getViewData('bills', force);
  const upcoming = sortByDateAsc(data.upcoming || [], 'dueDate').filter((bill) => Number(bill.remaining || 0) > 0);
  state.cache.accounts = data.accounts || [];
  state.cache.bills = data.bills || [];
  state.cache.upcomingBills = upcoming;
  $('#view').innerHTML = `
    <section class="today-shell">
      <article class="panel">
        <div class="panel-head">
          <div>
            <h3>Pagos proximos</h3>
            <p>Primero los mas cercanos</p>
          </div>
          <button class="action-button secondary" data-quick="payment" type="button"><i data-lucide="check-circle"></i>Ya hice un pago</button>
        </div>
        <div class="simple-list">
          ${upcoming.slice(0, 6).map((bill) => `
            <div class="bill-payment-item" data-bill-id="${escapeAttr(bill.billId)}" data-due="${escapeAttr(bill.dueDate)}">
              <span>${dateLabel(bill.dueDate)}</span>
              <strong>${escapeHtml(bill.name)} - ${money(bill.remaining)}</strong>
              <small>${escapeHtml(bill.status || 'pendiente')}</small>
            </div>
          `).join('') || '<div><strong>No hay pagos pendientes cerca.</strong><small>Todo se ve tranquilo por ahora.</small></div>'}
        </div>
      </article>
      <section class="quick-actions">
        <button class="quick-button" data-quick="daughter" type="button"><i data-lucide="hand-coins"></i><span>Registrar pago a hija</span></button>
        <button class="quick-button" data-quick="reserve-phone" type="button"><i data-lucide="phone"></i><span>Telefono/internet reservado</span></button>
        <button class="quick-button" data-go="more" type="button"><i data-lucide="more-horizontal"></i><span>Mas opciones</span></button>
      </section>
    </section>
  `;
  bindGoButtons();
  bindQuickActions();
}

async function renderBillsAdvanced(force = false) {
  const data = await getViewData('bills', force);
  const bills = data.bills || [];
  const upcoming = sortByDateAsc(data.upcoming || [], 'dueDate');
  const accounts = data.accounts || [];
  state.cache.accounts = accounts;
  state.cache.bills = bills;
  state.cache.upcomingBills = upcoming;

  $('#view').innerHTML = `
    <section class="grid">
      <div class="panel span-5">
        <div class="panel-head"><h3>Pago fijo o variable</h3></div>
        <form id="billForm" class="form-grid">
          <input type="hidden" name="id">
          <label class="wide">Nombre<input name="name" required></label>
          <label>Monto<input name="amount" type="number" step="0.01" required></label>
          <label>Frecuencia<select name="frequency"><option value="weekly">Semanal</option><option value="monthly">Mensual</option><option value="every_x_months">Cada X meses</option><option value="once">Una vez</option></select></label>
          <label>Dia<input name="dueDay" placeholder="Friday o 23"></label>
          <label>Fecha<input name="dueDate" type="date"></label>
          <label>Prioridad<select name="priority"><option value="critical">Critica</option><option value="important">Importante</option><option value="normal">Normal</option></select></label>
          <label>Cuenta<select name="account">${options(accounts, 'id', 'name')}</select></label>
          <label>Categoria<input name="category"></label>
          <label class="full">Notas<textarea name="notes"></textarea></label>
          <div class="full button-row">
            <button class="action-button primary" type="submit"><i data-lucide="save"></i>Guardar</button>
          </div>
        </form>
      </div>

      <div class="panel span-7">
        <div class="panel-head"><h3>Pagos proximos</h3></div>
        <div class="list">
          ${upcoming.map((bill) => `
            <article class="item-card alert bill-payment-item ${bill.remaining <= 0 ? 'green' : levelClass(bill.priority)}" data-bill-id="${escapeAttr(bill.billId)}" data-due="${escapeAttr(bill.dueDate)}">
              <div class="item-row">
                <div>
                  <strong>${escapeHtml(bill.name)}</strong>
                  <div class="muted">${dateLabel(bill.dueDate)} - falta ${money(bill.remaining)}</div>
                </div>
                ${badge(bill.remaining <= 0 ? 'green' : levelClass(bill.priority), bill.status)}
              </div>
              <form class="inline-form bill-pay-form" data-id="${escapeHtml(bill.billId)}" data-due="${escapeHtml(bill.dueDate)}" data-amount="${Number(bill.remaining || bill.amount)}">
                <input name="amount" type="number" step="0.01" value="${Number(bill.remaining || bill.amount)}">
                <button class="action-button primary" data-kind="paid" type="submit"><i data-lucide="check-circle"></i>Pagado</button>
                <button class="action-button secondary partial-pay" type="button"><i data-lucide="split"></i>Parcial</button>
              </form>
            </article>
          `).join('') || empty('No hay pagos proximos.')}
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head"><h3>Todos los pagos</h3></div>
      ${table(['Nombre', 'Monto', 'Frecuencia', 'Dia', 'Prioridad', 'Accion'], bills.map((bill) => [
        escapeHtml(bill.name),
        money(bill.amount),
        escapeHtml(bill.frequency),
        escapeHtml(bill.dueDay || bill.dueDate),
        badge(levelClass(bill.priority), bill.priority),
        `<button class="action-button secondary edit-bill" data-id="${escapeHtml(bill.id)}" type="button"><i data-lucide="pencil"></i>Editar</button>`
      ]))}
    </section>
  `;

  $('#billForm').addEventListener('submit', submitBill);
  $$('.bill-pay-form').forEach((form) => form.addEventListener('submit', submitBillPaid));
  $$('.partial-pay').forEach((button) => button.addEventListener('click', submitBillPartial));
  $$('.edit-bill').forEach((button) => button.addEventListener('click', () => fillBillForm(bills.find((b) => b.id === button.dataset.id))));
}

async function renderDebts(force = false) {
  const data = await getViewData('debts', force);
  const debts = data.debts || [];
  const strategy = data.strategy || {};
  const accounts = data.accounts || [];
  state.cache.accounts = accounts;

  $('#view').innerHTML = `
    <section class="grid">
      <div class="panel span-5">
        <div class="panel-head"><h3>Deuda</h3></div>
        <form id="debtForm" class="form-grid">
          <input type="hidden" name="id">
          <label class="wide">Nombre<input name="name" required></label>
          <label>Balance<input name="balance" type="number" step="0.01" required></label>
          <label>Balance original<input name="originalBalance" type="number" step="0.01"></label>
          <label>Minimo<input name="minimumPayment" type="number" step="0.01" required></label>
          <label>Dia<input name="dueDay" placeholder="23"></label>
          <label>Prioridad<select name="priority"><option value="normal">Normal</option><option value="important">Importante</option></select></label>
          <label class="full">Notas<textarea name="notes"></textarea></label>
          <div class="full button-row">
            <button class="action-button primary" type="submit"><i data-lucide="save"></i>Guardar</button>
          </div>
        </form>
      </div>
      <div class="panel span-7">
        <div class="panel-head">
          <div>
            <h3>Snowball</h3>
            <p>${escapeHtml(strategy.message)}</p>
          </div>
          <span class="badge blue">${money(strategy.totalBalance)}</span>
        </div>
        <p>Orden: ${escapeHtml((strategy.recommendedOrder || []).join(' -> '))}</p>
        <p>Minimos mensuales: <strong>${money(strategy.totalMinimums)}</strong></p>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head"><h3>Deudas activas</h3></div>
      <div class="list">
        ${debts.map((debt) => `
          <article class="item-card">
            <div class="item-row">
              <div>
                <strong>${escapeHtml(debt.name)}</strong>
                <div class="muted">Minimo ${money(debt.minimumPayment)} - dia ${escapeHtml(debt.dueDay)}</div>
              </div>
              <span class="amount">${money(debt.balance)}</span>
            </div>
            <div class="progress"><span style="width:${Math.max(0, Math.min(100, debt.progress))}%"></span></div>
            <form class="inline-form debt-payment" data-id="${escapeHtml(debt.id)}">
              <input name="amount" type="number" step="0.01" placeholder="Pago">
              <select name="type"><option value="minimum">Minimo</option><option value="extra">Extra</option></select>
              <select name="account">${options(accounts, 'id', 'name')}</select>
              <button class="action-button primary" type="submit"><i data-lucide="check"></i>Aplicar</button>
              <button class="action-button secondary edit-debt" data-id="${escapeHtml(debt.id)}" type="button"><i data-lucide="pencil"></i>Editar</button>
            </form>
          </article>
        `).join('') || empty('No hay deudas.')}
      </div>
    </section>
  `;

  $('#debtForm').addEventListener('submit', submitDebt);
  $$('.debt-payment').forEach((form) => form.addEventListener('submit', submitDebtPayment));
  $$('.edit-debt').forEach((button) => button.addEventListener('click', () => fillDebtForm(debts.find((d) => d.id === button.dataset.id))));
}

async function renderShifts(force = false) {
  const data = await getViewData('shifts', force);
  const sources = data.sources || [];
  const shifts = sortByDateDesc(data.shifts || [], 'date');
  const amazon = sources.find((s) => /amazon/i.test(s.name)) || sources[0] || {};
  $('#view').innerHTML = `
    <section class="grid">
      <div class="panel span-5">
        <div class="panel-head"><h3>Turno trabajado</h3></div>
        <form id="shiftForm" class="form-grid">
          <label class="wide">Fuente<select name="incomeSourceId">${options(sources, 'id', 'name', amazon.id)}</select></label>
          <label>Fecha<input name="date" type="date" value="${todayInput()}" required></label>
          <label>Inicio<input name="startTime" type="time" value="13:00"></label>
          <label>Fin<input name="endTime" type="time" value="17:30"></label>
          <label>Break min<input name="breakMinutes" type="number" value="0"></label>
          <label>Horas<input name="hours" type="number" step="0.01" placeholder="Auto"></label>
          <label>Rate<input name="rate" type="number" step="0.01" value="${Number(amazon.hourlyRate || 18.5)}"></label>
          <label>Bono/h<input name="bonusRate" type="number" step="0.01" value="0"></label>
          <label>Fecha de cobro<input name="expectedPayDate" type="date"></label>
          <label class="full">Notas<textarea name="notes"></textarea></label>
          <div class="full button-row">
            <button class="action-button primary" type="submit"><i data-lucide="save"></i>Guardar turno</button>
          </div>
        </form>
      </div>
      <div class="panel span-7">
        <div class="panel-head"><h3>Historial de turnos</h3></div>
        ${table(['Fecha', 'Horas', 'Rate', 'Neto estimado', 'Cheque'], shifts.map((shift) => [
          dateLabel(shift.date),
          Number(shift.hours || 0).toFixed(2),
          money(shift.rate),
          money(shift.estimatedNet),
          shift.linkedPaycheckId ? 'Creado' : '-'
        ]))}
      </div>
    </section>
  `;
  $('#shiftForm').addEventListener('submit', submitShift);
}

async function renderCalendar(force = false) {
  const data = await getViewData('calendar', force);
  const events = sortByDateAsc(data.events || [], 'date');
  $('#view').innerHTML = `
    <section class="panel">
      <div class="panel-head"><h3>Calendario</h3></div>
      <div class="calendar-list">
        ${events.map((event) => `
          <div class="calendar-event">
            <strong>${dateLabel(event.date)}</strong>
            <span>${escapeHtml(event.title)}</span>
            <span class="badge ${levelClass(event.priority)}">${escapeHtml(event.type)}</span>
          </div>
        `).join('') || empty('No hay eventos.')}
      </div>
    </section>
  `;
}

async function renderWhatNow() {
  const today = state.cache.today || await getViewData('today');
  const capitalOneAccount = (today.accounts || []).find((account) => account.name === 'Capital One') || {};
  $('#view').innerHTML = `
    <section class="grid">
      <div class="panel span-5">
        <div class="panel-head"><h3>Calculadora</h3></div>
        <form id="whatNowForm" class="form-grid">
          <label class="wide">Balance actual si cambio<input name="currentMoney" type="number" step="0.01" value="${Number(capitalOneAccount.currentBalance || 0)}"></label>
          <label><input class="check-toggle" name="paycheckConfirmed" type="checkbox"> Ya recibi cheque</label>
          <label><input class="check-toggle" name="gasPending" type="checkbox" ${today.context?.gasPending === false ? '' : 'checked'}> Falta gasolina</label>
          <label class="wide">Pago parcial hecho hoy<input name="daughterPaid" type="number" step="0.01" value="${Number(today.context?.daughter?.paid || 0)}"></label>
          <div class="full button-row">
            <button class="action-button primary" type="submit"><i data-lucide="calculator"></i>Calcular</button>
          </div>
        </form>
      </div>
      <div id="whatNowResult" class="panel span-7">
        <div class="empty">Usare tus balances, pagos, cheques y settings actuales.</div>
      </div>
    </section>
  `;
  $('#whatNowForm').addEventListener('submit', submitWhatNow);
}

async function renderChecklist(force = false) {
  const data = await getViewData('checklist', force);
  const items = sortByDateAsc(data.items || [], 'dueDate');
  $('#view').innerHTML = `
    <section class="panel">
      <div class="panel-head">
        <div>
          <h3>${escapeHtml(data.checklist.title)}</h3>
          <p>${escapeHtml(data.progress.text)}</p>
        </div>
        <span class="badge green">${data.progress.percent}%</span>
      </div>
      <div class="progress"><span style="width:${data.progress.percent}%"></span></div>
      <div class="list" style="margin-top:14px">
        ${items.map((item) => `
          <article class="item-card check-item">
            <input class="check-toggle checklist-toggle" data-id="${escapeHtml(item.id)}" type="checkbox" ${item.completed ? 'checked' : ''}>
            <div>
              <strong>${escapeHtml(item.title)}</strong>
              <div class="muted">${escapeHtml(item.description || '')}</div>
              <div class="muted">${dateLabel(item.dueDate)} - ${item.completed ? 'Ya hice esto.' : 'Esto todavia falta.'}</div>
            </div>
            ${badge(levelClass(item.priority), item.priority)}
          </article>
        `).join('')}
      </div>
      <div class="button-row">
        <button id="generateChecklist" class="action-button secondary" type="button"><i data-lucide="refresh-cw"></i>Regenerar</button>
      </div>
    </section>
  `;
  $$('.checklist-toggle').forEach((input) => input.addEventListener('change', toggleChecklistItem));
  $('#generateChecklist').addEventListener('click', async () => {
    await api('generateWeeklyChecklist');
    toast('Checklist actualizado.');
    renderView('checklist', true);
  });
}

async function renderNotifications(force = false) {
  const data = await getViewData('notifications', force);
  const alerts = sortAlerts(data.alerts || []);
  const notifications = sortAlerts(data.notifications || []);
  $('#view').innerHTML = `
    <section class="grid">
      <div class="panel span-7">
        <div class="panel-head">
          <div>
            <h3>Alertas activas</h3>
            <p>Ordenadas por fecha mas cercana</p>
          </div>
        </div>
        ${renderAlertList(alerts)}
      </div>

      <div class="panel span-5">
        <div class="panel-head">
          <div>
            <h3>Recordatorios internos</h3>
            <p>Pendientes, pospuestos y abiertos</p>
          </div>
        </div>
        <div class="list">
        ${notifications.map((notification) => `
          <article class="item-card alert-card ${levelClass(notification.priority)}">
            <div class="alert-icon ${levelClass(notification.priority)}">
              <i data-lucide="${alertIcon(notification)}"></i>
            </div>
            <div class="alert-content">
              <div class="item-row">
                <div>
                  <strong>${escapeHtml(notification.title)}</strong>
                  <div class="muted">${escapeHtml(notification.message)}</div>
                  <div class="action-meta">
                    <span class="date-chip"><i data-lucide="calendar"></i>${dateLabel(notification.dueDate)}</span>
                    <span>${escapeHtml(notification.type || 'general')}</span>
                  </div>
                </div>
                ${badge(levelClass(notification.priority), notification.status || 'open')}
              </div>
              <div class="button-row">
                <button class="action-button secondary resolve-notification" data-id="${escapeHtml(notification.id)}" type="button"><i data-lucide="check"></i>Resolver</button>
                <button class="action-button secondary snooze-notification" data-id="${escapeHtml(notification.id)}" type="button"><i data-lucide="clock"></i>Posponer</button>
              </div>
            </div>
          </article>
        `).join('') || empty('No hay recordatorios internos.')}
        </div>
      </div>
    </section>
  `;
  $$('.resolve-notification').forEach((button) => button.addEventListener('click', () => resolveNotification(button.dataset.id)));
  $$('.snooze-notification').forEach((button) => button.addEventListener('click', () => snoozeNotification(button.dataset.id)));
  bindGoButtons();
}

async function renderSettings(force = false) {
  const data = await getViewData('settings', force);
  const settings = data.settings || {};
  state.cache.settings = settings;
  $('#view').innerHTML = `
    <section class="grid">
      <div class="panel span-6">
        <div class="panel-head"><h3>Configuracion</h3></div>
        <form id="settingsForm" class="form-grid">
          <label class="wide">Email<input name="notificationEmail" type="email" value="${escapeAttr(settings.notificationEmail || '')}"></label>
          <label>Tax Amazon<input name="amazonTaxRate" type="number" step="0.001" value="${Number(settings.amazonTaxRate ?? 0.12)}"></label>
          <label>Tax trabajo<input name="mainJobTaxRate" type="number" step="0.001" value="${Number(settings.mainJobTaxRate ?? 0)}"></label>
          <label>Gasolina<input name="gasEstimated" type="number" step="0.01" value="${Number(settings.gasEstimated ?? 45)}"></label>
          <label>Comida<input name="foodEstimated" type="number" step="0.01" value="${Number(settings.foodEstimated ?? 60)}"></label>
          <label>Buffer<input name="bufferAmount" type="number" step="0.01" value="${Number(settings.bufferAmount ?? 50)}"></label>
          <label>Amazon a Capital One<input name="amazonSplitCapitalOne" type="number" step="0.01" value="${Number(settings.amazonSplitCapitalOne ?? 70)}"></label>
          <label>Amazon a Checking<input name="amazonSplitVyStarChecking" type="number" step="0.01" value="${Number(settings.amazonSplitVyStarChecking ?? 120)}"></label>
          <label>Amazon a Savings<input name="amazonSplitVyStarSavings" type="number" step="0.01" value="${Number(settings.amazonSplitVyStarSavings ?? 100)}"></label>
          <label><input class="check-toggle" name="emailsEnabled" type="checkbox" ${settings.emailsEnabled !== false ? 'checked' : ''}> Emails</label>
          <label><input class="check-toggle" name="internalAlertsEnabled" type="checkbox" ${settings.internalAlertsEnabled !== false ? 'checked' : ''}> Alertas internas</label>
          <div class="full button-row">
            <button class="action-button primary" type="submit"><i data-lucide="save"></i>Guardar</button>
          </div>
        </form>
      </div>

      <div class="panel span-6">
        <div class="panel-head"><h3>Seguridad y backup</h3></div>
        <form id="passwordForm" class="form-grid">
          <label class="wide">Contrasena actual
            <span class="password-field">
              <input name="currentPassword" type="password" autocomplete="current-password">
              <button class="password-toggle" type="button" title="Mostrar contrasena" aria-label="Mostrar contrasena">
                <i data-lucide="eye"></i>
              </button>
            </span>
          </label>
          <label class="wide">Nueva contrasena
            <span class="password-field">
              <input name="newPassword" type="password" minlength="12" pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9]).{12,}" title="Minimo 12 caracteres con mayuscula, minuscula, numero y simbolo" autocomplete="new-password" required>
              <button class="password-toggle" type="button" title="Mostrar contrasena" aria-label="Mostrar contrasena">
                <i data-lucide="eye"></i>
              </button>
            </span>
          </label>
          <div class="full button-row">
            <button class="action-button primary" type="submit"><i data-lucide="key-round"></i>Cambiar contrasena</button>
          </div>
        </form>
        <div class="button-row">
          <button id="exportBackup" class="action-button secondary" type="button"><i data-lucide="download"></i>Exportar JSON</button>
          <label class="action-button secondary">
            <i data-lucide="upload"></i>
            Importar JSON
            <input id="importBackup" type="file" accept="application/json" hidden>
          </label>
        </div>
      </div>
    </section>
  `;
  $('#settingsForm').addEventListener('submit', submitSettings);
  $('#passwordForm').addEventListener('submit', submitPassword);
  $('#exportBackup').addEventListener('click', exportBackup);
  $('#importBackup').addEventListener('change', importBackup);
}

async function submitAccount(event) {
  event.preventDefault();
  await guarded(async () => {
    await api('saveAccount', formValues(event.currentTarget));
    toast('Cuenta guardada.');
    renderView('accounts', true);
  });
}

async function submitBalance(event) {
  event.preventDefault();
  await guarded(async () => {
    await api('updateAccountBalance', { id: event.currentTarget.dataset.id, ...formValues(event.currentTarget) });
    toast('Balance actualizado.');
    renderView('accounts', true);
  });
}

async function submitTransfer(event) {
  event.preventDefault();
  await guarded(async () => {
    await api('createTransfer', formValues(event.currentTarget));
    toast('Transferencia registrada.');
    renderView('accounts', true);
  });
}

async function submitIncomeSource(event) {
  event.preventDefault();
  await guarded(async () => {
    await api('saveIncomeSource', formValues(event.currentTarget));
    toast('Fuente guardada.');
    renderView('incomes', true);
  });
}

async function submitPaycheck(event) {
  event.preventDefault();
  await guarded(async () => {
    await api('savePaycheck', formValues(event.currentTarget));
    toast('Cheque guardado.');
    renderView('incomes', true);
  });
}

async function submitVerifyPaycheck(event) {
  event.preventDefault();
  await guarded(async () => {
    await api('verifyPaycheck', { id: event.currentTarget.dataset.id, ...formValues(event.currentTarget) });
    toast('Cheque verificado.');
    renderView('paychecks', true);
  });
}

async function markNotReceived(id) {
  await guarded(async () => {
    await api('markPaycheckNotReceived', { id });
    toast('Cheque marcado como no recibido.');
    renderView('paychecks', true);
  });
}

async function submitBill(event) {
  event.preventDefault();
  await guarded(async () => {
    await api('saveBill', formValues(event.currentTarget));
    toast('Pago guardado.');
    renderView('bills', true);
  });
}

async function submitBillPaid(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const payment = {
    billId: form.dataset.id,
    dueDate: form.dataset.due,
    amount: Number(formValues(form).amount || form.dataset.amount || 0),
    full: true
  };
  await guarded(async () => {
    setFormDisabled(form, true);
    await api('markBillPaid', payment);
    confirmPaymentSaved(payment);
  });
  setFormDisabled(form, false);
}

async function submitBillPartial(event) {
  const form = event.currentTarget.closest('form');
  const values = formValues(form);
  const payment = {
    billId: form.dataset.id,
    dueDate: form.dataset.due,
    amount: Number(values.amount || 0),
    full: false
  };
  await guarded(async () => {
    setFormDisabled(form, true);
    await api('markBillPartial', {
      billId: payment.billId,
      dueDate: payment.dueDate,
      partialAmount: payment.amount
    });
    confirmPaymentSaved(payment);
  });
  setFormDisabled(form, false);
}

async function submitDebt(event) {
  event.preventDefault();
  await guarded(async () => {
    await api('saveDebt', formValues(event.currentTarget));
    toast('Deuda guardada.');
    renderView('debts', true);
  });
}

async function submitDebtPayment(event) {
  event.preventDefault();
  await guarded(async () => {
    await api('makeDebtPayment', { debtId: event.currentTarget.dataset.id, ...formValues(event.currentTarget) });
    toast('Pago aplicado.');
    renderView('debts', true);
  });
}

async function submitShift(event) {
  event.preventDefault();
  await guarded(async () => {
    await api('saveWorkShift', formValues(event.currentTarget));
    toast('Turno guardado.');
    renderView('shifts', true);
  });
}

async function submitWhatNow(event) {
  event.preventDefault();
  await guarded(async () => {
    const result = await api('calculateWhatToDoNow', formValues(event.currentTarget));
    $('#whatNowResult').innerHTML = `
      <div class="panel-head">
        <div>
          <h3>Respuesta</h3>
          <p>Dinero que no debes tocar: ${money(result.moneyNotToTouch)}</p>
        </div>
        ${badge(result.canPayDebtExtra ? 'green' : 'red', result.canPayDebtExtra ? 'Deuda extra si' : 'No deuda extra')}
      </div>
      <div class="grid">
        ${metric('Reservar', money(result.reservedForBills), 'Telefono, internet u otros pagos', 'warning')}
        ${metric('Gasolina', money(result.gasAmount), 'Prioridad antes de extra', 'info')}
        ${metric('Libre para gastar', money(result.freeToSpend), 'Despues de reservas', result.freeToSpend > 0 ? 'success' : 'critical')}
      </div>
      <div class="list" style="margin-top:14px">
        <div class="item-card alert ${levelClass(result.recommendation.level)}">
          <strong>${escapeHtml(result.recommendation.title)}</strong>
          <span>${escapeHtml(result.recommendation.message)}</span>
        </div>
        ${Object.values(result.decisions).map((line) => `<div class="item-card"><strong>${escapeHtml(line)}</strong></div>`).join('')}
        ${result.steps.map((line) => `<div class="item-card"><span>${escapeHtml(line)}</span></div>`).join('')}
      </div>
    `;
    refreshIcons();
  });
}

async function toggleChecklistItem(event) {
  const checked = event.currentTarget.checked;
  const id = event.currentTarget.dataset.id;
  await guarded(async () => {
    await api(checked ? 'completeChecklistItem' : 'reopenChecklistItem', { id });
    renderView('checklist', true);
  });
}

async function resolveNotification(id) {
  await guarded(async () => {
    await api('resolveNotification', { id });
    renderView('notifications', true);
  });
}

async function snoozeNotification(id) {
  await guarded(async () => {
    const snoozedUntil = new Date(Date.now() + 24 * 3600000).toISOString().slice(0, 10);
    await api('snoozeNotification', { id, snoozedUntil });
    renderView('notifications', true);
  });
}

async function submitSettings(event) {
  event.preventDefault();
  await guarded(async () => {
    await api('saveSettings', formValues(event.currentTarget));
    toast('Configuracion guardada.');
    renderView('settings', true);
  });
}

async function submitPassword(event) {
  event.preventDefault();
  const form = event.currentTarget;
  await guarded(async () => {
    await api('changePassword', formValues(form));
    form.reset();
    toast('Contrasena actualizada.');
  });
}

async function exportBackup() {
  await guarded(async () => {
    const backup = await api('exportData');
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mi-control-financiero-backup-${todayInput()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  });
}

async function importBackup(event) {
  const file = event.currentTarget.files[0];
  if (!file) return;
  await guarded(async () => {
    const text = await file.text();
    const backup = JSON.parse(text);
    await api('importData', backup);
    toast('Backup importado.');
    renderView('today', true);
  });
}

function bindQuickActions() {
  $$('[data-quick]').forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.dataset.quick;
      if (action === 'balance') openBalanceModal();
      if (action === 'payment') openPaymentModal(false);
      if (action === 'daughter') openPaymentModal(true);
      if (action === 'verify-paycheck') openPaycheckModal();
      if (action === 'gas') markGasCovered();
      if (action === 'reserve-phone') markPhoneInternetReserved();
    });
  });
}

function openBalanceModal() {
  const data = state.cache.today || state.cache.dashboard || {};
  const account = (data.accounts || state.cache.accounts || []).find((item) => item.name === 'Capital One');
  if (!account) {
    toast('No encontre Capital One.');
    return;
  }
  openQuickModal('Actualizar Capital One', `
    <label>Balance nuevo<input name="currentBalance" type="number" step="0.01" value="${Number(account.currentBalance || 0)}" required></label>
  `, async (values) => {
    await api('updateAccountBalance', { id: account.id, currentBalance: values.currentBalance });
    toast('Balance actualizado.');
    await renderView(state.activeView, true);
  });
}

function openPaymentModal(daughterOnly) {
  const data = state.cache.today || state.cache.dashboard || {};
  const upcoming = (data.upcomingBills || state.cache.upcomingBills || [])
    .filter((bill) => Number(bill.remaining || 0) > 0)
    .filter((bill) => !daughterOnly || /hija/i.test(bill.name) || bill.billId === 'bill_daughter');
  if (!upcoming.length) {
    toast(daughterOnly ? 'No encontre pago pendiente de hija.' : 'No hay pagos pendientes cerca.');
    return;
  }
  openQuickModal(daughterOnly ? 'Registrar pago a hija' : 'Registrar pago hecho', `
    <label>Pago
      <select name="billKey">
        ${upcoming.map((bill) => `<option value="${escapeAttr(`${bill.billId}|${bill.dueDate}`)}">${escapeHtml(bill.name)} - ${money(bill.remaining)} - ${dateLabel(bill.dueDate)}</option>`).join('')}
      </select>
    </label>
    <label>Monto pagado<input name="amount" type="number" step="0.01" value="${Number(upcoming[0].remaining || upcoming[0].amount || 0)}" required></label>
  `, async (values) => {
    const [billId, dueDate] = String(values.billKey || '').split('|');
    const bill = upcoming.find((item) => item.billId === billId && item.dueDate === dueDate);
    const amount = Number(values.amount || 0);
    const payment = {
      billId,
      dueDate,
      amount,
      full: Boolean(bill && amount >= Number(bill.remaining || bill.amount || 0))
    };
    if (bill && amount >= Number(bill.remaining || bill.amount || 0)) {
      await api('markBillPaid', { billId, dueDate, amount });
    } else {
      await api('markBillPartial', { billId, dueDate, partialAmount: amount });
    }
    confirmPaymentSaved(payment);
  });
}

async function openPaycheckModal() {
  const data = state.cache.today || await getViewData('today');
  const pending = data.pendingPaychecks || [];
  if (!pending.length) {
    toast('No hay cheques pendientes.');
    return;
  }
  openQuickModal('Verificar cheque', `
    <label>Cheque
      <select name="id">
        ${pending.map((paycheck) => `<option value="${escapeAttr(paycheck.id)}">${dateLabel(paycheck.expectedDate)} - ${money(paycheck.netEstimated)} - ${escapeHtml(incomeName(paycheck.incomeSourceId))}</option>`).join('')}
      </select>
    </label>
    <label>Estado
      <select name="status">
        <option value="received">Recibido</option>
        <option value="not_received">No recibido</option>
      </select>
    </label>
    <label>Monto real<input name="netActual" type="number" step="0.01" value="${Number(pending[0].netEstimated || 0)}"></label>
  `, async (values) => {
    if (values.status === 'not_received') {
      await api('markPaycheckNotReceived', { id: values.id });
    } else {
      await api('verifyPaycheck', { id: values.id, netActual: values.netActual });
    }
    confirmActionDone('Cheque actualizado', 'Quedo marcado. La informacion se sincroniza sola.');
    removePendingPaycheckLocally(values.id);
    refreshViewsQuietly('today', state.activeView);
  });
}

async function markGasCovered() {
  await guarded(async () => {
    await api('markGasCovered');
    confirmActionDone('Gasolina cubierta', 'Quedo marcado. Ya no se debe tratar como pendiente.');
    refreshViewsQuietly('today');
  });
}

async function markPhoneInternetReserved() {
  await guarded(async () => {
    await api('markPhoneInternetReserved');
    confirmActionDone('Telefono e internet reservados', 'Quedo marcado. La pantalla se actualiza sola.');
    refreshViewsQuietly('today');
  });
}

function confirmPaymentSaved(payment) {
  const bill = findCachedBill(payment.billId, payment.dueDate);
  const name = bill?.name || 'Pago';
  applyLocalBillPayment(payment);
  markBillPaymentItem(payment, name);
  confirmActionDone(
    payment.full ? 'Pago registrado' : 'Pago parcial registrado',
    `${name} quedo guardado por ${money(payment.amount)}. ${payment.full ? 'Ya no queda como pendiente.' : 'Se desconto el monto pagado.'}`
  );
  refreshViewsQuietly('today', 'bills');
}

function confirmActionDone(title, detail) {
  toast(title, {
    type: 'success',
    icon: 'check-circle-2',
    detail
  });
}

function findCachedBill(billId, dueDate) {
  const sources = [
    state.cache.upcomingBills,
    state.cache.today?.upcomingBills,
    state.cache.dashboard?.upcomingBills
  ];
  for (const list of sources) {
    const found = (list || []).find((bill) => sameBill(bill, billId, dueDate));
    if (found) return found;
  }
  return null;
}

function sameBill(bill, billId, dueDate) {
  return String(bill?.billId || bill?.id || '') === String(billId || '') && String(bill?.dueDate || '') === String(dueDate || '');
}

function applyLocalBillPayment(payment) {
  const updateList = (list) => (list || []).map((bill) => {
    if (!sameBill(bill, payment.billId, payment.dueDate)) return bill;
    const currentRemaining = Number(bill.remaining || bill.amount || 0);
    const remaining = payment.full ? 0 : Math.max(0, currentRemaining - Number(payment.amount || 0));
    return {
      ...bill,
      remaining,
      status: remaining <= 0 ? 'paid' : 'partial'
    };
  });

  state.cache.upcomingBills = updateList(state.cache.upcomingBills);
  if (state.cache.today?.upcomingBills) {
    state.cache.today.upcomingBills = updateList(state.cache.today.upcomingBills);
  }
  if (state.cache.dashboard?.upcomingBills) {
    state.cache.dashboard.upcomingBills = updateList(state.cache.dashboard.upcomingBills);
  }
}

function markBillPaymentItem(payment, name) {
  const title = payment.full ? 'Pago registrado' : 'Pago parcial registrado';
  const detail = `${name} - ${money(payment.amount)} - ${dateLabel(payment.dueDate)}`;
  $$('.bill-payment-item').forEach((item) => {
    if (String(item.dataset.billId || '') !== String(payment.billId || '') || String(item.dataset.due || '') !== String(payment.dueDate || '')) {
      return;
    }
    item.classList.add('payment-done');
    item.innerHTML = `
      <div class="payment-confirmed">
        <i data-lucide="check-circle-2"></i>
        <div>
          <strong>${escapeHtml(title)}</strong>
          <span>${escapeHtml(detail)}</span>
        </div>
      </div>
    `;
  });
  refreshIcons();
}

function removePendingPaycheckLocally(id) {
  const remove = (list) => (list || []).filter((paycheck) => String(paycheck.id || '') !== String(id || ''));
  if (state.cache.today?.pendingPaychecks) {
    state.cache.today.pendingPaychecks = remove(state.cache.today.pendingPaychecks);
  }
  if (state.cache.dashboard?.pendingPaychecks) {
    state.cache.dashboard.pendingPaychecks = remove(state.cache.dashboard.pendingPaychecks);
  }
}

function refreshViewsQuietly(...views) {
  const allowed = new Set(['today', 'dashboard', 'accounts', 'incomes', 'paychecks', 'bills', 'debts', 'shifts', 'calendar', 'checklist', 'notifications', 'settings']);
  Array.from(new Set(views))
    .filter((view) => allowed.has(view))
    .forEach((view) => {
      apiCached('getViewData', viewPayload(view), { force: true, ttlMs: CONFIG.cacheTtlMs })
        .then((data) => rememberViewData(view, data))
        .catch((error) => console.warn('Background refresh failed:', error));
    });
}

function rememberViewData(view, data) {
  if (view === 'today') {
    state.cache.today = data;
    state.cache.dashboard = data;
    state.cache.accounts = data.accounts || state.cache.accounts || [];
    state.cache.incomeSources = data.incomeSources || state.cache.incomeSources || [];
    return;
  }
  if (view === 'bills') {
    state.cache.bills = data.bills || state.cache.bills || [];
    state.cache.upcomingBills = sortByDateAsc(data.upcoming || [], 'dueDate').filter((bill) => Number(bill.remaining || 0) > 0);
    state.cache.accounts = data.accounts || state.cache.accounts || [];
  }
}

function openQuickModal(title, bodyHtml, onSubmit) {
  closeQuickModal();
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <section class="quick-modal" role="dialog" aria-modal="true">
      <div class="panel-head">
        <h3>${escapeHtml(title)}</h3>
        <button class="icon-button modal-close" type="button" title="Cerrar"><i data-lucide="x"></i></button>
      </div>
      <form class="stack quick-modal-form">
        ${bodyHtml}
        <div class="button-row">
          <button class="action-button primary" type="submit"><i data-lucide="check"></i>Guardar</button>
          <button class="action-button secondary modal-close" type="button">Cancelar</button>
        </div>
      </form>
    </section>
  `;
  document.body.appendChild(modal);
  $$('.modal-close', modal).forEach((button) => button.addEventListener('click', closeQuickModal));
  $('.quick-modal-form', modal).addEventListener('submit', async (event) => {
    event.preventDefault();
    await guarded(async () => {
      await onSubmit(formValues(event.currentTarget));
      closeQuickModal();
    });
  });
  refreshIcons();
}

function closeQuickModal() {
  $$('.modal-backdrop').forEach((modal) => modal.remove());
}

function fillAccountForm(account) {
  fillForm($('#accountForm'), account);
}

function fillIncomeSourceForm(source) {
  fillForm($('#incomeSourceForm'), source);
}

function fillBillForm(bill) {
  fillForm($('#billForm'), bill);
}

function fillDebtForm(debt) {
  fillForm($('#debtForm'), debt);
}

function fillForm(form, values) {
  if (!form || !values) return;
  Object.entries(values).forEach(([key, value]) => {
    const input = form.elements[key];
    if (!input) return;
    if (input.type === 'checkbox') {
      input.checked = value === true || value === 'true';
    } else {
      input.value = value ?? '';
    }
  });
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function guarded(fn) {
  try {
    setBusy(true);
    await fn();
  } catch (error) {
    toast(error.message || 'No se pudo completar.');
  } finally {
    setBusy(false);
    refreshIcons();
  }
}

function viewPayload(view) {
  const base = { view };
  if (view === 'today') return { view: 'today' };
  if (view === 'accounts') return { ...base, transfersLimit: 20 };
  if (view === 'incomes') return { ...base, paychecksLimit: 40 };
  if (view === 'bills') return { ...base, upcomingDays: 30 };
  if (view === 'shifts') return { ...base, shiftsLimit: 50 };
  if (view === 'calendar') return { ...base, days: 45 };
  return base;
}

async function getViewData(view, force = false) {
  return apiCached('getViewData', viewPayload(view), { force, ttlMs: CONFIG.cacheTtlMs });
}

function hasWarmView(view) {
  const entry = state.requestCache[apiCacheKey('getViewData', viewPayload(view))];
  return Boolean(entry && Date.now() - entry.at < CONFIG.cacheTtlMs);
}

async function apiCached(action, payload = {}, options = {}) {
  const key = apiCacheKey(action, payload);
  const ttlMs = options.ttlMs ?? CONFIG.cacheTtlMs;
  const cached = state.requestCache[key];
  if (!options.force && cached && Date.now() - cached.at < ttlMs) {
    return cached.data;
  }

  if (!options.force && state.inFlight[key]) {
    return state.inFlight[key];
  }

  state.inFlight[key] = api(action, payload, options)
    .then((data) => {
      state.requestCache[key] = { at: Date.now(), data };
      return data;
    })
    .finally(() => {
      delete state.inFlight[key];
    });

  return state.inFlight[key];
}

function setApiCache(action, payload = {}, data) {
  state.requestCache[apiCacheKey(action, payload)] = { at: Date.now(), data };
}

async function api(action, payload = {}, options = {}) {
  const requestId = `mcf_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const request = {
    requestId,
    action,
    token: options.skipToken ? '' : state.token,
    payload
  };
  const data = await postWithIframe(request);
  if (MUTATING_ACTIONS.has(action)) {
    clearRequestCache();
  }
  return data;
}

function apiCacheKey(action, payload = {}) {
  return `${action}:${stableStringify(payload)}`;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function clearRequestCache() {
  state.requestCache = {};
  state.inFlight = {};
}

function postWithIframe(request) {
  return new Promise((resolve, reject) => {
    const iframeName = `frame_${request.requestId}`;
    const iframe = document.createElement('iframe');
    iframe.name = iframeName;
    iframe.className = 'transport-frame';
    iframe.setAttribute('aria-hidden', 'true');

    const form = document.createElement('form');
    form.method = 'POST';
    form.action = CONFIG.apiUrl;
    form.target = iframeName;
    form.className = 'transport-form';

    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'request';
    input.value = JSON.stringify(request);
    form.appendChild(input);

    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
      form.remove();
      iframe.remove();
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('El backend no respondio a tiempo.'));
    }, CONFIG.timeoutMs);

    function onMessage(event) {
      const data = event.data || {};
      if (data.source !== 'mcf-apps-script' || data.requestId !== request.requestId) {
        return;
      }
      cleanup();
      if (!data.payload || data.payload.ok === false) {
        reject(new Error((data.payload && data.payload.error) || 'Error del backend.'));
        return;
      }
      resolve(data.payload.data);
    }

    window.addEventListener('message', onMessage);
    document.body.appendChild(iframe);
    document.body.appendChild(form);
    form.submit();
  });
}

function formValues(form) {
  const out = {};
  Array.from(new FormData(form).entries()).forEach(([key, value]) => {
    out[key] = value;
  });
  $$('input[type="checkbox"]', form).forEach((input) => {
    out[input.name] = input.checked;
  });
  return out;
}

function setBusy(show) {
  if (show) {
    state.busyCount += 1;
    clearTimeout(state.busyTimer);
    state.busyTimer = setTimeout(() => {
      if (state.busyCount > 0) {
        $('#busy').classList.remove('hidden');
      }
    }, CONFIG.busyDelayMs);
    return;
  }

  state.busyCount = Math.max(0, state.busyCount - 1);
  if (state.busyCount === 0) {
    clearTimeout(state.busyTimer);
    $('#busy').classList.add('hidden');
  }
}

function setFormDisabled(form, disabled) {
  if (!form) return;
  $$('button, input, select, textarea', form).forEach((element) => {
    element.disabled = disabled;
  });
}

function toast(message, options = {}) {
  if (typeof options === 'string') {
    options = { type: options };
  }
  const el = $('#toast');
  const type = options.type || 'info';
  const hasRichContent = Boolean(options.icon || options.detail);
  el.className = `toast ${type}${hasRichContent ? '' : ' plain'}`;
  if (hasRichContent) {
    el.innerHTML = `
      ${options.icon ? `<i data-lucide="${escapeAttr(options.icon)}"></i>` : ''}
      <div>
        <strong>${escapeHtml(message || '')}</strong>
        ${options.detail ? `<span>${escapeHtml(options.detail)}</span>` : ''}
      </div>
    `;
  } else {
    el.textContent = message || '';
  }
  el.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.add('hidden'), 4200);
  refreshIcons();
}

function refreshIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function bindGoButtons() {
  $$('[data-go]').forEach((button) => button.addEventListener('click', () => renderView(button.dataset.go)));
}

function handlePasswordToggle(event) {
  const button = event.target.closest('.password-toggle');
  if (!button) return;
  const field = button.closest('.password-field');
  const input = field ? $('input', field) : null;
  if (!input) return;

  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  button.title = showing ? 'Mostrar contrasena' : 'Ocultar contrasena';
  button.setAttribute('aria-label', button.title);
  button.innerHTML = `<i data-lucide="${showing ? 'eye' : 'eye-off'}"></i>`;
  refreshIcons();
}

function metric(label, value, detail, tone = 'info') {
  return `
    <div class="metric ${tone} span-3">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value))}</strong>
      <small>${escapeHtml(detail || '')}</small>
    </div>
  `;
}

function simpleMoneyCard(label, value, detail, tone = 'blue') {
  return `
    <article class="simple-money ${levelClass(tone)}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value))}</strong>
      <small>${escapeHtml(detail || '')}</small>
    </article>
  `;
}

function renderActionCenter(items) {
  const actions = (items || []).map(normalizeActionItem);
  return `<div class="action-list">${actions.map((item, index) => `
    <article class="action-card ${levelClass(item.priority)}">
      <div class="action-index">${index + 1}</div>
      <div class="action-body">
        <div class="item-row">
          <div>
            <strong>${escapeHtml(item.title)}</strong>
            ${item.message ? `<div class="muted">${escapeHtml(item.message)}</div>` : ''}
          </div>
          ${badge(levelClass(item.priority), item.priority || 'paso')}
        </div>
        <div class="action-meta">
          ${item.dueDate ? `<span class="date-chip"><i data-lucide="calendar"></i>${dateLabel(item.dueDate)}</span>` : ''}
          ${item.type ? `<span>${escapeHtml(item.type)}</span>` : ''}
        </div>
        ${item.action ? `
          <div class="button-row compact">
            <button class="action-button secondary" ${item.view ? `data-go="${escapeAttr(item.view)}"` : ''} type="button">
              <i data-lucide="${escapeAttr(item.icon || 'arrow-right')}"></i>${escapeHtml(item.action)}
            </button>
          </div>
        ` : ''}
      </div>
    </article>
  `).join('') || empty('Sin pasos pendientes.')}</div>`;
}

function normalizeActionItem(item) {
  if (typeof item === 'string') {
    return {
      title: item,
      message: '',
      priority: 'blue',
      dueDate: '',
      action: '',
      view: ''
    };
  }
  return {
    title: item.title || item.message || 'Paso pendiente',
    message: item.message || '',
    priority: item.priority || item.level || 'blue',
    dueDate: item.dueDate || '',
    action: item.action || item.primaryAction || '',
    view: item.view || '',
    type: item.type || '',
    icon: item.icon || 'arrow-right'
  };
}

function renderAlertList(alerts) {
  return `<div class="list">${alerts.map((alert) => `
    <article class="item-card alert-card ${levelClass(alert.priority)}">
      <div class="alert-icon ${levelClass(alert.priority)}">
        <i data-lucide="${alertIcon(alert)}"></i>
      </div>
      <div class="alert-content">
        <div class="item-row">
          <div>
            <strong>${escapeHtml(alert.title)}</strong>
            <div class="muted">${escapeHtml(alert.message)}</div>
          </div>
          ${badge(levelClass(alert.priority), alert.priority)}
        </div>
        <div class="action-meta">
          ${alert.dueDate ? `<span class="date-chip"><i data-lucide="calendar"></i>${dateLabel(alert.dueDate)}</span>` : ''}
          <span>${escapeHtml(alert.type || 'alerta')}</span>
        </div>
        ${alert.action ? `
          <div class="button-row compact">
            <button class="action-button secondary" ${alert.view ? `data-go="${escapeAttr(alert.view)}"` : ''} type="button">
              <i data-lucide="arrow-right"></i>${escapeHtml(alert.action)}
            </button>
          </div>
        ` : ''}
      </div>
    </article>
  `).join('') || empty('Sin alertas.')}</div>`;
}

function alertIcon(alert) {
  const type = String(alert.type || '').toLowerCase();
  if (type === 'bill') return 'receipt';
  if (type === 'paycheck') return 'badge-dollar-sign';
  if (type === 'debt') return 'trending-down';
  if (type === 'transfer') return 'move-right';
  if (type === 'budget') return 'wallet';
  return 'bell';
}

function renderUpcomingBills(bills) {
  return `<div class="list">${bills.map((bill) => `
    <article class="item-card">
      <div class="item-row">
        <div>
          <strong>${escapeHtml(bill.name)}</strong>
          <div class="muted">${dateLabel(bill.dueDate)} - ${escapeHtml(bill.status)}</div>
        </div>
        <span class="amount">${money(bill.remaining)}</span>
      </div>
    </article>
  `).join('') || empty('Sin pagos proximos.')}</div>`;
}

function renderPaycheckMini(paychecks) {
  return `<div class="list">${paychecks.map((paycheck) => `
    <article class="item-card alert ${levelClass(paycheck.alertLevel)}">
      <div class="item-row">
        <div>
          <strong>${dateLabel(paycheck.expectedDate)}</strong>
          <div class="muted">${escapeHtml(incomeName(paycheck.incomeSourceId))}</div>
        </div>
        <span class="amount">${money(paycheck.netEstimated)}</span>
      </div>
    </article>
  `).join('') || empty('Sin cheques pendientes.')}</div>`;
}

function sortByDateAsc(rows, key) {
  return [...(rows || [])].sort((a, b) => dateValue(a[key]) - dateValue(b[key]));
}

function sortByDateDesc(rows, key) {
  return [...(rows || [])].sort((a, b) => dateValue(b[key]) - dateValue(a[key]));
}

function sortAlerts(rows) {
  return [...(rows || [])].sort((a, b) => {
    const byDate = dateValue(a.dueDate) - dateValue(b.dueDate);
    if (byDate !== 0) return byDate;
    return priorityRank(a.priority) - priorityRank(b.priority);
  });
}

function dateValue(value) {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  const time = date.getTime();
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
}

function priorityRank(value) {
  const level = levelClass(value);
  if (level === 'red') return 0;
  if (level === 'yellow') return 1;
  if (level === 'blue') return 2;
  return 3;
}

function table(headers, rows) {
  if (!rows.length) return empty('Sin registros.');
  return `
    <div class="table-wrap">
      <table>
        <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
    </div>
  `;
}

function badge(level, label) {
  return `<span class="badge ${levelClass(level)}">${escapeHtml(String(label || ''))}</span>`;
}

function empty(text) {
  return `<div class="empty">${escapeHtml(text)}</div>`;
}

function options(rows, valueKey, labelKey, selected = '') {
  return rows.map((row) => {
    const selectedAttr = String(row[valueKey]) === String(selected) ? ' selected' : '';
    return `<option value="${escapeAttr(row[valueKey])}"${selectedAttr}>${escapeHtml(row[labelKey])}</option>`;
  }).join('');
}

function accountBalance(accounts, name) {
  const account = (accounts || []).find((item) => item.name === name);
  return money(account ? account.currentBalance : 0);
}

function accountName(id) {
  const account = (state.cache.accounts || []).find((item) => item.id === id);
  return escapeHtml(account ? account.name : id || '');
}

function incomeName(id) {
  const source = (state.cache.incomeSources || []).find((item) => item.id === id);
  return source ? source.name : id || 'Ingreso';
}

function money(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0));
}

function percent(value) {
  return `${Math.round(Number(value || 0) * 10000) / 100}%`;
}

function dateLabel(value) {
  if (!value) return '-';
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return new Intl.DateTimeFormat('es-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function todayInput() {
  return new Date().toISOString().slice(0, 10);
}

function levelClass(value) {
  const text = String(value || '').toLowerCase();
  if (['critical', 'red', 'critica'].includes(text)) return 'red';
  if (['important', 'warning', 'yellow', 'amarillo'].includes(text)) return 'yellow';
  if (['success', 'green', 'paid'].includes(text)) return 'green';
  return 'blue';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}
