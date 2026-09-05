// Azure Application Insights, loaded only when a connection string is set at
// build time (VITE_APPINSIGHTS_CONNECTION_STRING). Without it every call is a
// silent no-op, so local dev and forks work unchanged.

const connectionString = import.meta.env.VITE_APPINSIGHTS_CONNECTION_STRING as
  | string
  | undefined;

interface AppInsights {
  trackEvent(event: { name: string }, properties?: Record<string, unknown>): void;
  trackPageView(): void;
  loadAppInsights(): void;
}

let ai: AppInsights | null = null;
const queue: { name: string; props?: Record<string, unknown> }[] = [];

export function initAnalytics(): void {
  if (!connectionString) return;
  const script = document.createElement("script");
  script.src = "https://js.monitoring.azure.com/scripts/b/ai.3.gzip.min.js";
  script.async = true;
  script.onload = () => {
    const M = (window as any).Microsoft?.ApplicationInsights;
    if (!M?.ApplicationInsights) return;
    ai = new M.ApplicationInsights({
      config: {
        connectionString,
        disableFetchTracking: true,
        disableAjaxTracking: true,
      },
    }) as AppInsights;
    ai.loadAppInsights();
    ai.trackPageView();
    for (const e of queue) ai.trackEvent({ name: e.name }, e.props);
    queue.length = 0;
  };
  document.head.appendChild(script);
}

export function track(name: string, props?: Record<string, unknown>): void {
  if (!connectionString) return;
  if (ai) ai.trackEvent({ name }, props);
  else queue.push({ name, props });
}
