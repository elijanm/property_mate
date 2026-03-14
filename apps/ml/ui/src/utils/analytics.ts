// Analytics helpers — pushes events to GTM dataLayer.
// GTM ID: GTM-T7MRCN6J
// Configure GA4, conversion tags, etc. inside GTM — no changes needed here.

declare global {
  interface Window {
    dataLayer?: Record<string, unknown>[]
  }
}

function push(event: string, params?: Record<string, unknown>) {
  if (typeof window === 'undefined') return
  window.dataLayer = window.dataLayer || []
  window.dataLayer.push({ event, ...params })
}

/** Fire a virtual page view — call on every SPA route change. */
export function trackPageView(path: string, title?: string) {
  push('page_view', {
    page_path: path,
    page_title: title ?? document.title,
    page_location: window.location.origin + path,
  })
}

/** Fire a custom event. */
export function trackEvent(
  eventName: string,
  params?: Record<string, string | number | boolean>,
) {
  push(eventName, params)
}

// Preset events used across the app
export const ga = {
  signUp:          () => push('sign_up'),
  login:           () => push('login'),
  startTrial:      () => push('begin_checkout', { item_name: 'cloud_gpu' }),
  viewPricing:     () => push('view_item_list', { item_list_name: 'pricing' }),
  clickGetStarted: (source: string) => push('cta_click', { source }),
  openApiDocs:     () => push('api_docs_open'),
  copyCode:        (lang: string) => push('code_copy', { language: lang }),
}
