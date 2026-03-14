/**
 * Centralised route helpers — all frontend URL paths are defined here.
 * Never hardcode "/properties/..." strings directly in components or pages.
 *
 * Portfolio hierarchy:
 *   /portfolio                           → category selector
 *   /portfolio/properties                → real-estate property list
 *   /portfolio/properties/new            → create property
 *   /portfolio/properties/:id/*          → property workspace
 */

export const PORTFOLIO_ROOT = '/portfolio'
export const PROPERTIES_ROOT = '/portfolio/properties'

export const routes = {
  portfolio: PORTFOLIO_ROOT,

  // Properties list / creation
  properties: PROPERTIES_ROOT,
  propertyNew: `${PROPERTIES_ROOT}/new`,

  // Property workspace root + named sub-pages
  property:               (id: string) => `${PROPERTIES_ROOT}/${id}`,
  propertyUnits:          (id: string) => `${PROPERTIES_ROOT}/${id}/units`,
  propertyLeases:         (id: string) => `${PROPERTIES_ROOT}/${id}/leases`,
  propertyTenants:        (id: string) => `${PROPERTIES_ROOT}/${id}/tenants`,
  propertyTickets:        (id: string) => `${PROPERTIES_ROOT}/${id}/tickets`,
  propertyAccounting:     (id: string) => `${PROPERTIES_ROOT}/${id}/accounting`,
  propertyInventory:      (id: string) => `${PROPERTIES_ROOT}/${id}/inventory`,
  propertyAssets:         (id: string) => `${PROPERTIES_ROOT}/${id}/assets`,
  propertyStores:         (id: string) => `${PROPERTIES_ROOT}/${id}/stores`,
  propertyCCTV:           (id: string) => `${PROPERTIES_ROOT}/${id}/cctv`,
  propertySmartDevices:   (id: string) => `${PROPERTIES_ROOT}/${id}/smart-devices`,
  propertyWhatsApp:       (id: string) => `${PROPERTIES_ROOT}/${id}/whatsapp`,
  propertyParking:        (id: string) => `${PROPERTIES_ROOT}/${id}/parking`,
  propertyVendors:        (id: string) => `${PROPERTIES_ROOT}/${id}/service-providers`,
  propertyReports:        (id: string) => `${PROPERTIES_ROOT}/${id}/reports`,
  propertyApps:           (id: string) => `${PROPERTIES_ROOT}/${id}/apps`,
  propertySettings:       (id: string) => `${PROPERTIES_ROOT}/${id}/settings`,
  propertyAccountingInvoices: (id: string) => `${PROPERTIES_ROOT}/${id}/accounting/invoices`,
}
