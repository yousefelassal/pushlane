import { detailSchema, listSchema, projectSchema, receiptSchema, request } from './api.js';
import {
  dateLabel,
  errorMessage,
  node,
  providerLabels,
  requiredElement,
  statusBadge,
  statusLabels,
  text,
} from './dom.js';

import type { NotificationLog, Project } from './api.js';

import './style.css';

type Connection =
  | { kind: 'disconnected' }
  | {
      kind: 'connected';
      apiKey: string;
      project: Project;
      abortController: AbortController;
    };

let connection: Connection = { kind: 'disconnected' };
let notifications: NotificationLog[] = [];
let nextCursor: string | null = null;
let currentFilter = '';
let pendingSend: { fingerprint: string; key: string } | null = null;
let logRequest = 0;
let detailRequest = 0;

const connectForm = requiredElement('#connect-form', HTMLFormElement);
const apiKeyInput = requiredElement('#api-key', HTMLInputElement);
const connectButton = requiredElement('#connect-button', HTMLButtonElement);
const sendButton = requiredElement('#send-button', HTMLButtonElement);
const sendNav = requiredElement('#send-nav', HTMLButtonElement);
const disconnectButton = requiredElement('#disconnect-button', HTMLButtonElement);
const filterForm = requiredElement('#filter-form', HTMLFormElement);
const userFilter = requiredElement('#user-filter', HTMLInputElement);
const refreshButton = requiredElement('#refresh-button', HTMLButtonElement);
const loadMoreButton = requiredElement('#load-more', HTMLButtonElement);
const sendDialog = requiredElement('#send-dialog', HTMLDialogElement);
const sendForm = requiredElement('#send-form', HTMLFormElement);
const submitSend = requiredElement('#submit-send', HTMLButtonElement);
const detailDialog = requiredElement('#detail-dialog', HTMLDialogElement);

function showMessage(message: string, success = false): void {
  const notice = requiredElement('#global-message', HTMLElement);
  notice.textContent = message;
  notice.className = success ? 'notice success' : 'notice';
  notice.hidden = false;
}

function clearMessage(): void {
  requiredElement('#global-message', HTMLElement).hidden = true;
}

function renderProject(project: Project): void {
  text('#workspace-name', project.name);
  text('#workspace-environment', project.environment);
  text('#project-name', project.name);
  text('#project-environment', `${project.environment} environment`);
  text('#project-usage', project.usage.reservedDispatches.toLocaleString());
  text(
    '#project-allowance',
    project.usage.limit === null
      ? `No plan allowance · ${project.usage.month}`
      : `of ${project.usage.limit.toLocaleString()} allowed · ${project.usage.month}`
  );
  text(
    '#project-retention',
    project.logRetentionDays === null ? 'No plan expiry' : `${project.logRetentionDays} days`
  );
  text('#project-plan', `${project.plan.replaceAll('_', ' ')} plan`);

  const providers = requiredElement('#provider-list', HTMLUListElement);
  providers.replaceChildren();

  for (const kind of ['apns', 'fcm', 'webpush']) {
    const configured = project.providers.includes(kind);
    const item = node(
      'li',
      configured ? '' : 'missing',
      `${configured ? '✓' : '○'} ${providerLabels[kind] ?? kind}${configured ? '' : ' not configured'}`
    );
    providers.append(item);
  }
}

function renderLogs(): void {
  const rows = requiredElement('#notification-rows', HTMLTableSectionElement);
  rows.replaceChildren();

  for (const notification of notifications) {
    const row = node('tr');
    const titleCell = node('td');
    titleCell.append(
      node('span', 'notification-title', notification.title),
      node('span', 'notification-id', notification.id)
    );

    const userCell = node('td', 'user-cell', notification.userId);
    userCell.title = notification.userId;

    const statusCell = node('td');
    statusCell.append(statusBadge(notification.status));

    const createdCell = node('td', '', dateLabel(notification.createdAt));
    createdCell.title = notification.createdAt;

    const actionCell = node('td');
    const detailButton = node('button', 'detail-button', '→');
    detailButton.type = 'button';
    detailButton.setAttribute('aria-label', `Inspect ${notification.title}`);
    detailButton.addEventListener('click', () => {
      void openDetails(notification.id);
    });
    actionCell.append(detailButton);

    row.append(
      titleCell,
      userCell,
      statusCell,
      node('td', '', notification.deliveryCount.toLocaleString()),
      createdCell,
      actionCell
    );
    rows.append(row);
  }

  text('#loaded-count', notifications.length.toLocaleString());
  text(
    '#logs-summary',
    `${notifications.length.toLocaleString()} notification${notifications.length === 1 ? '' : 's'} loaded${currentFilter ? ` for ${currentFilter}` : ''}`
  );
  requiredElement('#logs-empty', HTMLElement).hidden = notifications.length > 0;
  loadMoreButton.hidden = nextCursor === null;
}

async function loadLogs(append = false): Promise<void> {
  if (connection.kind !== 'connected') {
    return;
  }

  const current = connection;
  const requestId = ++logRequest;
  const params = new URLSearchParams({ limit: '25' });

  if (currentFilter) {
    params.set('userId', currentFilter);
  }

  if (append && nextCursor) {
    params.set('before', nextCursor);
  }

  refreshButton.disabled = true;
  loadMoreButton.disabled = true;
  text('#logs-summary', 'Loading notifications…');

  try {
    const result = await request({
      path: `/v1/notifications?${params}`,
      apiKey: current.apiKey,
      schema: listSchema,
      signal: current.abortController.signal,
    });

    if (connection !== current || requestId !== logRequest) {
      return;
    }

    notifications = append ? [...notifications, ...result.items] : result.items;
    nextCursor = result.nextCursor;
    renderLogs();
  } catch (error) {
    if (!current.abortController.signal.aborted && requestId === logRequest) {
      showMessage(errorMessage(error));
      text('#logs-summary', 'Could not load notifications. Try refreshing.');
    }
  } finally {
    if (requestId === logRequest) {
      refreshButton.disabled = false;
      loadMoreButton.disabled = false;
    }
  }
}

async function connect(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  clearMessage();
  connectButton.disabled = true;
  connectButton.textContent = 'Connecting…';
  const apiKey = apiKeyInput.value.trim();

  try {
    const project = await request({
      path: '/v1/project',
      apiKey,
      schema: projectSchema,
    });
    connection = {
      kind: 'connected',
      apiKey,
      project,
      abortController: new AbortController(),
    };
    apiKeyInput.value = '';

    renderProject(project);
    requiredElement('#connect-panel', HTMLElement).hidden = true;
    requiredElement('#project-content', HTMLElement).hidden = false;
    requiredElement('#connection-dot', HTMLElement).classList.remove('offline');
    text('#connection-label', project.environment);
    disconnectButton.hidden = false;
    sendButton.disabled = false;
    sendNav.disabled = false;

    await loadLogs();
  } catch (error) {
    showMessage(errorMessage(error));
  } finally {
    connectButton.disabled = false;
    connectButton.textContent = 'Connect project →';
  }
}

function disconnect(): void {
  if (connection.kind === 'connected') {
    connection.abortController.abort();
  }

  connection = { kind: 'disconnected' };
  notifications = [];
  nextCursor = null;
  pendingSend = null;
  currentFilter = '';
  userFilter.value = '';
  apiKeyInput.value = '';
  logRequest += 1;
  detailRequest += 1;
  sendDialog.close();
  detailDialog.close();
  sendForm.reset();
  requiredElement('#detail-content', HTMLElement).replaceChildren();
  requiredElement('#notification-rows', HTMLTableSectionElement).replaceChildren();
  requiredElement('#connect-panel', HTMLElement).hidden = false;
  requiredElement('#project-content', HTMLElement).hidden = true;
  requiredElement('#connection-dot', HTMLElement).classList.add('offline');
  text('#connection-label', 'Not connected');
  text('#workspace-name', 'Your workspace');
  text('#workspace-environment', 'Connect a project');
  disconnectButton.hidden = true;
  sendButton.disabled = true;
  sendNav.disabled = true;
  clearMessage();
  apiKeyInput.focus();
}

function openSend(): void {
  requiredElement('#send-message', HTMLElement).hidden = true;
  sendDialog.showModal();
}

async function sendNotification(event: SubmitEvent): Promise<void> {
  event.preventDefault();

  if (connection.kind !== 'connected') {
    return;
  }

  const current = connection;
  const form = new FormData(sendForm);
  const field = (name: string) => {
    const value = form.get(name);

    return typeof value === 'string' ? value : '';
  };
  const image = field('image');
  const url = field('url');
  const payload = {
    userId: field('userId').trim(),
    title: field('title'),
    body: field('body'),
    ...(image ? { image } : {}),
    ...(url ? { url } : {}),
  };

  const body = JSON.stringify(payload);

  if (pendingSend?.fingerprint !== body) {
    pendingSend = { fingerprint: body, key: crypto.randomUUID() };
  }

  submitSend.disabled = true;
  submitSend.textContent = 'Sending…';
  requiredElement('#send-message', HTMLElement).hidden = true;

  try {
    const receipt = await request({
      path: '/v1/notifications',
      method: 'POST',
      body,
      apiKey: current.apiKey,
      idempotencyKey: pendingSend.key,
      schema: receiptSchema,
      signal: current.abortController.signal,
    });

    if (connection !== current) {
      return;
    }

    pendingSend = null;
    sendDialog.close();
    sendForm.reset();
    showMessage(
      receipt.status === 'no_registered_devices'
        ? `Notification ${receipt.id} was recorded. This user has no registered devices.`
        : `Notification ${receipt.id} was queued for ${receipt.deliveryCount} installation${receipt.deliveryCount === 1 ? '' : 's'}.`,
      true
    );

    try {
      const project = await request({
        path: '/v1/project',
        apiKey: current.apiKey,
        schema: projectSchema,
        signal: current.abortController.signal,
      });

      if (connection === current) {
        renderProject(project);
        await loadLogs();
      }
    } catch (error) {
      if (!current.abortController.signal.aborted) {
        showMessage(
          `Notification ${receipt.id} was accepted, but the project summary could not refresh. ${errorMessage(error)}`
        );
      }
    }
  } catch (error) {
    if (!current.abortController.signal.aborted) {
      const message = requiredElement('#send-message', HTMLElement);
      message.textContent = errorMessage(error);
      message.hidden = false;
    }
  } finally {
    submitSend.disabled = false;
    submitSend.textContent = 'Send notification ↗';
  }
}

/** Render provider attempt data as text so notification content cannot become HTML. */
async function openDetails(id: string): Promise<void> {
  if (connection.kind !== 'connected') {
    return;
  }

  const current = connection;
  const requestId = ++detailRequest;
  const content = requiredElement('#detail-content', HTMLElement);
  content.replaceChildren(node('p', 'muted', 'Loading delivery activity…'));
  detailDialog.showModal();

  try {
    const result = await request({
      path: `/v1/notifications/${encodeURIComponent(id)}`,
      apiKey: current.apiKey,
      schema: detailSchema,
      signal: current.abortController.signal,
    });

    if (connection !== current || !detailDialog.open || requestId !== detailRequest) {
      return;
    }

    const notification = result.notification;
    const summary = node('section', 'detail-summary');
    summary.append(node('h3', '', notification.title), node('p', 'body-copy', notification.body));

    const metadata = node('dl', 'detail-metadata');

    for (const [label, value] of [
      ['Notification', notification.id],
      ['User', notification.userId],
      ['Created', dateLabel(notification.createdAt)],
      ['Status', statusLabels[notification.status] ?? notification.status],
      ...(notification.image ? [['Image URL', notification.image]] : []),
      ...(notification.url ? [['Click destination', notification.url]] : []),
    ]) {
      metadata.append(node('dt', '', label), node('dd', '', value));
    }

    summary.append(metadata);
    content.replaceChildren(
      summary,
      node(
        'h3',
        '',
        `${result.deliveries.length} installation deliver${result.deliveries.length === 1 ? 'y' : 'ies'}`
      )
    );

    if (result.deliveries.length === 0) {
      content.append(
        node(
          'p',
          'muted',
          'This user had no active installations when the notification was accepted.'
        )
      );
    }

    for (const delivery of result.deliveries) {
      const card = node('section', 'delivery-card');
      const heading = node('div', 'delivery-card-heading');
      heading.append(
        node('strong', '', providerLabels[delivery.provider] ?? delivery.provider),
        statusBadge(delivery.status)
      );
      card.append(heading, node('p', 'mono', delivery.installationId));

      if (delivery.lastError) {
        card.append(node('p', 'provider-error', delivery.lastError));
      }

      if (delivery.providerMessageId) {
        card.append(node('p', 'mono', `Provider message ${delivery.providerMessageId}`));
      }

      const attempts = node('ol', 'attempt-list');

      for (const attempt of delivery.attempts) {
        const item = node('li');
        item.append(
          node(
            'span',
            '',
            `Attempt ${attempt.attempt} · ${attempt.result}${attempt.code ? ` · ${attempt.code}` : ''}`
          ),
          node('time', '', dateLabel(attempt.startedAt))
        );
        attempts.append(item);
      }

      if (delivery.attempts.length === 0) {
        attempts.append(node('li', '', 'No provider attempt has been recorded.'));
      }

      card.append(attempts);
      content.append(card);
    }
  } catch (error) {
    if (!current.abortController.signal.aborted) {
      content.replaceChildren(node('p', 'form-message', errorMessage(error)));
    }
  }
}

connectForm.addEventListener('submit', (event) => {
  void connect(event);
});
disconnectButton.addEventListener('click', disconnect);
sendButton.addEventListener('click', openSend);
sendNav.addEventListener('click', openSend);
refreshButton.addEventListener('click', () => {
  clearMessage();
  void loadLogs();
});
loadMoreButton.addEventListener('click', () => {
  void loadLogs(true);
});
sendForm.addEventListener('submit', (event) => {
  void sendNotification(event);
});
requiredElement('#close-send', HTMLButtonElement).addEventListener('click', () =>
  sendDialog.close()
);
requiredElement('#cancel-send', HTMLButtonElement).addEventListener('click', () =>
  sendDialog.close()
);
requiredElement('#close-detail', HTMLButtonElement).addEventListener('click', () =>
  detailDialog.close()
);
filterForm.addEventListener('submit', (event) => {
  event.preventDefault();
  currentFilter = userFilter.value.trim();
  clearMessage();
  void loadLogs();
});
requiredElement('#clear-filter', HTMLButtonElement).addEventListener('click', () => {
  userFilter.value = '';
  currentFilter = '';
  clearMessage();
  void loadLogs();
});
