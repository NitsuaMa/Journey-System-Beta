import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import './features/journey-grid/journey-grid.css';
import './features/equipment/equipment.css';
import './features/calendar/calendar.css';
import './features/subjective-report/subjective-report.css';
import './features/catalog/catalog.tokens.css';
import './features/catalog/catalog.css';
import './features/studio-tasks/studio-tasks.css';
import { ThemeProvider } from './components/ThemeProvider.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';

declare global {
  interface Window {
    __appLoaded?: boolean;
    __earlyErrors?: Record<string, unknown>[];
    /** Ring buffer of the last 10 reported errors, read by the feedback drawer. */
    __recentClientErrors?: { message: string; type: string; at: number }[];
    __appVersion?: string;
  }
}

// Tell the buffering handlers in index.html to stand down. From here on this
// module is the only thing that reports client errors.
window.__appLoaded = true;

// index.html used to register its own window.onerror and unhandledrejection
// handlers posting to the same endpoint, so every client error was reported
// twice. These listeners are now the only ones.
//
// The cap matters: the Firestore multi-tab assertion bug produced 3,664 errors
// in a single session, and the server is one Node process. Unthrottled, an
// error storm turns into an accidental self-DoS.
const MAX_ERROR_REPORTS = 50;
let errorReportCount = 0;

function reportClientError(payload: Record<string, unknown>) {
  // Mirrored into a small ring buffer the beta feedback drawer reads, so a
  // trainer's "it broke" arrives with the actual errors attached. Kept OUTSIDE
  // the report cap below: the cap exists to stop an error storm from DoSing the
  // single Node process, and an in-memory array of 10 costs nothing.
  try {
    const buf = (window.__recentClientErrors ??= []);
    buf.push({
      message: String((payload as { message?: unknown }).message ?? "unknown"),
      type: String((payload as { type?: unknown }).type ?? "unknown"),
      at: Date.now(),
    });
    if (buf.length > 10) buf.splice(0, buf.length - 10);
  } catch {
    /* never let telemetry break the page it is reporting on */
  }

  if (errorReportCount >= MAX_ERROR_REPORTS) return;
  errorReportCount += 1;
  const body =
    errorReportCount === MAX_ERROR_REPORTS
      ? { ...payload, note: "report cap reached; further errors go to the console only" }
      : payload;
  fetch('/api/log-error', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => {});
}

// Suppress benign ResizeObserver errors
const suppressResizeObserverError = () => {
  const originalError = console.error;
  console.error = (...args) => {
    if (typeof args[0] === 'string' && args[0].includes('ResizeObserver')) {
      return;
    }
    originalError.call(console, ...args);
  };
};

suppressResizeObserverError();

window.addEventListener('error', (e) => {
  if (typeof e.message === 'string' && e.message.includes('ResizeObserver')) {
    e.stopImmediatePropagation();
    e.preventDefault();
    return;
  }
  reportClientError({ message: e.message, type: 'window_error', stack: e.error?.stack });
});

window.addEventListener('unhandledrejection', (e) => {
  let message = e.reason?.message || '';
  
  // Ignore benign errors from Vite and certain extensions
  const reasonStr = e.reason ? String(e.reason) : '';
  if (
    reasonStr.includes('WebSocket') || 
    reasonStr.includes('vite') ||
    message.includes('WebSocket') ||
    message.includes('standardSelectors')
  ) {
    return;
  }

  if (!message) {
    if (e.reason instanceof Error) {
      message = e.reason.toString();
    } else {
      try {
        message = JSON.stringify(e.reason);
        if (message === '{}') message = String(e.reason);
      } catch(err) {
        message = String(e.reason);
      }
    }
  }
  
  let stack = e.reason?.stack;
  
  // Try to inspect the reason fully
  let fullReason = message;
  try {
    const keys = Object.getOwnPropertyNames(e.reason || {});
    const inspectObj: any = {};
    keys.forEach(k => { inspectObj[k] = (e.reason as any)[k]; });
    fullReason = JSON.stringify(inspectObj);
  } catch(e) {}

  reportClientError({
    message,
    type: 'unhandled_rejection',
    stack,
    fullReason,
  });
});

// Flush anything that failed before this module ran.
(window.__earlyErrors ?? []).forEach(reportClientError);
window.__earlyErrors = [];

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark" storageKey="journey-system-theme">
        <App />
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
);
