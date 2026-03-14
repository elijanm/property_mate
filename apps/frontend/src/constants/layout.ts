/**
 * Layout configuration — tweak these to change sidebar behaviour across the whole app.
 */

/**
 * Where the back-link (← Portfolio, ← Real Estate) appears in the sidebar header.
 *
 * 'above-logo'  — back link sits above the logo/identity block (default).
 *                 Matches the "drill-down" feel: context first, then branding.
 *
 * 'below-logo'  — back link sits below the logo/identity block, just before
 *                 the main nav starts. Keeps the logo anchored at the top.
 */
export const SIDEBAR_BACK_LINK_POSITION: 'above-logo' | 'below-logo' = 'below-logo'

/**
 * Enable the wallet card in the user avatar dropdown.
 * When true, a wallet balance card is shown in the top-right avatar menu.
 * Wire WALLET_BALANCE / WALLET_LIMIT to your real API in UserAvatarMenu.tsx.
 */
export const WALLET_ENABLED = true
