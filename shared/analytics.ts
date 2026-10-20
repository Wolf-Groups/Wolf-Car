/**
 * What the public website reports about a visit, shared by the page that
 * sends it and the API that stores it. Keep this file free of imports: it is
 * compiled into both projects.
 */
export const SITE_EVENT_TYPES = [
  'pageview',
  /** the basket sent to the branch on WhatsApp */
  'whatsapp_order',
  /** the booking form sent on WhatsApp */
  'whatsapp_booking',
  /** any other WhatsApp button */
  'whatsapp_chat',
  'call',
  'add_to_cart',
  /** a car model opened on the products page */
  'model_view',
  /** the customer pressed Pay on the checkout details step */
  'checkout_start',
  /** the return page confirmed a paid order */
  'order_paid',
] as const;
export type SiteEventType = (typeof SITE_EVENT_TYPES)[number];

/** Where a visit came from. */
export const SITE_SOURCES = [
  'direct',
  'google',
  'instagram',
  'tiktok',
  'facebook',
  'snapchat',
  'whatsapp',
  'x',
  'youtube',
  'search',
  'other',
] as const;
export type SiteSource = (typeof SITE_SOURCES)[number];

export const SITE_DEVICES = ['mobile', 'tablet', 'desktop'] as const;
export type SiteDevice = (typeof SITE_DEVICES)[number];
