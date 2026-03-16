import { Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom'
import DashboardLayout from '@/layouts/DashboardLayout'
import { useAuth } from '@/hooks/useAuth'
import { useOrgProfile } from '@/hooks/useOrgProfile'
import ProtectedRoute from '@/components/ProtectedRoute'
import { WebSocketProvider } from '@/context/WebSocketContext'
import LoginPage from '@/pages/auth/LoginPage'
import SignupPage from '@/pages/auth/SignupPage'
import Forbidden from '@/pages/errors/Forbidden'
import NotFound from '@/pages/NotFound'
import OwnerDashboard from '@/pages/owner/OwnerDashboard'
import AgentDashboard from '@/pages/agent/AgentDashboard'
import TenantDashboard from '@/pages/tenant/TenantDashboard'
// ServiceProviderDashboard replaced by VendorPortalPage
import SuperAdminDashboard from '@/pages/superadmin/SuperAdminDashboard'
import PortfolioPage from '@/pages/owner/portfolio/PortfolioPage'
import PropertiesListPage from '@/pages/owner/properties/PropertiesListPage'
import NewPropertyPage from '@/pages/owner/properties/NewPropertyPage'
import PropertyWorkspacePage from '@/pages/owner/properties/PropertyWorkspacePage'
import PropertyDashboardPage from '@/pages/owner/properties/PropertyDashboardPage'
import PropertyUnitsPage from '@/pages/owner/properties/PropertyUnitsPage'
import PropertyTenantsPage from '@/pages/owner/properties/PropertyTenantsPage'
import PropertyTicketsPage from '@/pages/owner/properties/PropertyTicketsPage'
import PropertyAccountingPage from '@/pages/owner/properties/PropertyAccountingPage'
// PropertyServiceProvidersPage replaced by PropertyVendorsPage
import PropertyInventoryPage from '@/pages/owner/properties/PropertyInventoryPage'
import PropertyAssetsPage from '@/pages/owner/properties/PropertyAssetsPage'
import PropertyStoresPage from '@/pages/owner/properties/PropertyStoresPage'
import PropertyWhatsAppPage from '@/pages/owner/properties/PropertyWhatsAppPage'
import PropertyParkingPage from '@/pages/owner/properties/PropertyParkingPage'
import PropertySettingsPage from '@/pages/owner/properties/PropertySettingsPage'
import PropertyReportsPage from '@/pages/owner/properties/PropertyReportsPage'
import RentRollReportPage from '@/pages/owner/properties/RentRollReportPage'
import ArrearsReportPage from '@/pages/owner/properties/ArrearsReportPage'
import CollectionRateReportPage from '@/pages/owner/properties/CollectionRateReportPage'
import OutstandingBalancesReportPage from '@/pages/owner/properties/OutstandingBalancesReportPage'
import LeaseExpiryReportPage from '@/pages/owner/properties/LeaseExpiryReportPage'
import PaymentBehaviorReportPage from '@/pages/owner/properties/PaymentBehaviorReportPage'
import OccupancyReportPage from '@/pages/owner/properties/OccupancyReportPage'
import VacancyDetailReportPage from '@/pages/owner/properties/VacancyDetailReportPage'
import UtilityConsumptionReportPage from '@/pages/owner/properties/UtilityConsumptionReportPage'
import MeterReadingsReportPage from '@/pages/owner/properties/MeterReadingsReportPage'
import PropertyAppsPage from '@/pages/owner/properties/PropertyAppsPage'
import PropertySmartDevicesPage from '@/pages/owner/properties/PropertySmartDevicesPage'
import PropertyCCTVPage from '@/pages/owner/properties/PropertyCCTVPage'
import IncomingCallModal from '@/components/IncomingCallModal'
import LeaseManagementPage from '@/pages/owner/leases/LeaseManagementPage'
import TenantsPage from '@/pages/owner/tenants/TenantsPage'
import TenantDetailPage from '@/pages/owner/tenants/TenantDetailPage'
import BusinessSetupPage from '@/pages/owner/setup/BusinessSetupPage'
import GlobalSettingsPage from '@/pages/owner/settings/GlobalSettingsPage'
import OnboardingWizardPage from '@/pages/tenant/OnboardingWizardPage'
import InspectionWizardPage from '@/pages/tenant/InspectionWizardPage'
import TaskSubmissionPage from '@/pages/tenant/TaskSubmissionPage'
import TenantInvoicesPage from '@/pages/tenant/TenantInvoicesPage'
import TenantTicketsPage from '@/pages/tenant/TenantTicketsPage'
import TicketsDashboardPage from '@/pages/owner/tickets/TicketsDashboardPage'
import PrepareInvoicesPage from '@/pages/owner/accounting/PrepareInvoicesPage'
import SummaryPage from '@/pages/owner/accounting/SummaryPage'
import VerifyPage from '@/pages/public/VerifyPage'
import VoiceAgentDashboardPage from '@/pages/owner/apps/VoiceAgentDashboardPage'
// VendorsPage, VendorListingsPage, VendorApplicationsPage consolidated into PropertyVendorsPage
import PropertyVendorsPage from '@/pages/owner/properties/PropertyVendorsPage'
import VendorListingsDirectoryPage from '@/pages/public/VendorListingsDirectoryPage'
import VendorApplyPage from '@/pages/public/VendorApplyPage'
import VendorOnboardingPage from '@/pages/public/VendorOnboardingPage'
import VendorContractPage from '@/pages/public/VendorContractPage'
import VendorSetupPage from '@/pages/public/VendorSetupPage'
import VendorPortalPage from '@/pages/service_provider/VendorPortalPage'
import ShipmentSignPage from '@/pages/public/ShipmentSignPage'
import VacancyLossPage from '@/pages/owner/properties/reports/VacancyLossPage'
import ExpiryCalendarPage from '@/pages/owner/properties/reports/ExpiryCalendarPage'
import PaymentScorecardPage from '@/pages/owner/properties/reports/PaymentScorecardPage'
import DiscountImpactPage from '@/pages/owner/properties/reports/DiscountImpactPage'

const roleHomePage: Record<string, string> = {
  owner: '/owner',
  agent: '/agent',
  tenant: '/tenant',
  service_provider: '/service-provider',
  superadmin: '/superadmin',
}

function RoleRedirect() {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  const home = roleHomePage[user.role] ?? '/forbidden'
  return <Navigate to={home} replace />
}

/**
 * Gate that redirects owner/agent to /owner/setup when setup_complete === false.
 * Renders children when setup is done (or org profile is still loading).
 */
function OrgSetupGate({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const { orgProfile, loading } = useOrgProfile()

  if (user?.role !== 'owner') return <>{children}</>
  if (loading) return null
  if (orgProfile && !orgProfile.setup_complete) {
    return <Navigate to="/owner/setup" replace />
  }
  return <>{children}</>
}

const PROPERTY_ROLES = ['owner', 'agent', 'superadmin'] as const
const CREATE_ROLES = ['owner', 'superadmin'] as const

/** Preserves sub-path when redirecting /properties/:id/foo → /portfolio/properties/:id/foo */
function LegacyPropertyRedirect() {
  const { propertyId } = useParams<{ propertyId: string }>()
  const { pathname } = useLocation()
  const suffix = pathname.replace(`/properties/${propertyId}`, '')
  return <Navigate to={`/portfolio/properties/${propertyId}${suffix}`} replace />
}

function AuthenticatedApp({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  if (!user) return <>{children}</>
  return (
    <WebSocketProvider>
      {children}
      <IncomingCallModal />
    </WebSocketProvider>
  )
}

export default function App() {
  return (
    <AuthenticatedApp>
    <Routes>
      {/* Public */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/forbidden" element={<Forbidden />} />
      <Route path="/onboarding/:token" element={<OnboardingWizardPage />} />
      <Route path="/inspection/:token" element={<InspectionWizardPage />} />
      <Route path="/task/:token" element={<TaskSubmissionPage />} />
      <Route path="/verify/:onboardingId" element={<VerifyPage />} />
      <Route path="/listings" element={<VendorListingsDirectoryPage />} />
      <Route path="/apply/:listingId" element={<VendorApplyPage />} />
      <Route path="/vendor-onboarding/:token" element={<VendorOnboardingPage />} />
      <Route path="/vendor-contract/:token" element={<VendorContractPage />} />
      <Route path="/vendor-setup/:token" element={<VendorSetupPage />} />
      <Route path="/shipment-sign/:token" element={<ShipmentSignPage />} />

      {/* Business setup (owner only, no OrgSetupGate here to avoid redirect loop) */}
      <Route
        path="/owner/setup"
        element={
          <ProtectedRoute allowedRoles={['owner']}>
            <BusinessSetupPage />
          </ProtectedRoute>
        }
      />

      {/* Global settings */}
      <Route
        path="/owner/settings"
        element={
          <ProtectedRoute allowedRoles={['owner']}>
            <OrgSetupGate>
              <GlobalSettingsPage />
            </OrgSetupGate>
          </ProtectedRoute>
        }
      />

      {/* Voice Agent dashboard */}
      <Route
        path="/owner/apps/voice-agent"
        element={
          <ProtectedRoute allowedRoles={['owner']}>
            <OrgSetupGate>
              <VoiceAgentDashboardPage />
            </OrgSetupGate>
          </ProtectedRoute>
        }
      />

      {/* Tickets dashboard */}
      <Route
        path="/owner/tickets"
        element={
          <ProtectedRoute allowedRoles={['owner', 'agent']}>
            <OrgSetupGate>
              <TicketsDashboardPage />
            </OrgSetupGate>
          </ProtectedRoute>
        }
      />


      {/* Accounting pages — accessible both from global URL and property workspace */}
      <Route
        path="/owner/accounting/invoices"
        element={
          <ProtectedRoute allowedRoles={['owner', 'agent']}>
            <OrgSetupGate>
              <DashboardLayout><PrepareInvoicesPage /></DashboardLayout>
            </OrgSetupGate>
          </ProtectedRoute>
        }
      />
      <Route
        path="/owner/accounting/summary"
        element={
          <ProtectedRoute allowedRoles={['owner', 'agent']}>
            <OrgSetupGate>
              <DashboardLayout><SummaryPage /></DashboardLayout>
            </OrgSetupGate>
          </ProtectedRoute>
        }
      />

      {/* Role dashboards */}
      <Route
        path="/owner/*"
        element={
          <ProtectedRoute allowedRoles={['owner']}>
            <OrgSetupGate>
              <OwnerDashboard />
            </OrgSetupGate>
          </ProtectedRoute>
        }
      />
      <Route
        path="/agent/*"
        element={
          <ProtectedRoute allowedRoles={['agent']}>
            <AgentDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/tenant"
        element={
          <ProtectedRoute allowedRoles={['tenant']}>
            <TenantDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/tenant/invoices"
        element={
          <ProtectedRoute allowedRoles={['tenant']}>
            <TenantInvoicesPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/tenant/tickets"
        element={
          <ProtectedRoute allowedRoles={['tenant']}>
            <TenantTicketsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/service-provider"
        element={
          <ProtectedRoute allowedRoles={['service_provider']}>
            <VendorPortalPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/superadmin/*"
        element={
          <ProtectedRoute allowedRoles={['superadmin']}>
            <SuperAdminDashboard />
          </ProtectedRoute>
        }
      />

      {/* Portfolio — entry point for all asset categories */}
      <Route
        path="/portfolio"
        element={
          <ProtectedRoute allowedRoles={[...PROPERTY_ROLES]}>
            <OrgSetupGate>
              <PortfolioPage />
            </OrgSetupGate>
          </ProtectedRoute>
        }
      />

      {/* Legacy redirects — keep old /properties/* bookmarks working */}
      <Route path="/properties" element={<Navigate to="/portfolio/properties" replace />} />
      <Route path="/properties/new" element={<Navigate to="/portfolio/properties/new" replace />} />
      <Route path="/properties/:propertyId/*" element={<LegacyPropertyRedirect />} />

      {/* Portfolio → Real Estate property list */}
      <Route
        path="/portfolio/properties"
        element={
          <ProtectedRoute allowedRoles={[...PROPERTY_ROLES]}>
            <OrgSetupGate>
              <PropertiesListPage />
            </OrgSetupGate>
          </ProtectedRoute>
        }
      />
      <Route
        path="/portfolio/properties/new"
        element={
          <ProtectedRoute allowedRoles={[...CREATE_ROLES]}>
            <OrgSetupGate>
              <NewPropertyPage />
            </OrgSetupGate>
          </ProtectedRoute>
        }
      />

      {/* Property workspace — nested routes rendered in PropertyWorkspacePage <Outlet /> */}
      <Route
        path="/portfolio/properties/:propertyId"
        element={
          <ProtectedRoute allowedRoles={[...PROPERTY_ROLES]}>
            <OrgSetupGate>
              <PropertyWorkspacePage />
            </OrgSetupGate>
          </ProtectedRoute>
        }
      >
        <Route index element={<PropertyDashboardPage />} />
        <Route path="units" element={<PropertyUnitsPage />} />
        <Route path="leases" element={<LeaseManagementPage />} />
        <Route path="tenants" element={<PropertyTenantsPage />} />
        <Route path="tickets" element={<PropertyTicketsPage />} />
        <Route path="accounting" element={<PropertyAccountingPage />} />
        <Route path="accounting/invoices" element={<PrepareInvoicesPage />} />
        <Route path="accounting/summary" element={<SummaryPage />} />
        <Route path="service-providers" element={<PropertyVendorsPage />} />
        <Route path="inventory" element={<PropertyInventoryPage />} />
        <Route path="assets" element={<PropertyAssetsPage />} />
        <Route path="stores" element={<PropertyStoresPage />} />
        <Route path="smart-devices" element={<PropertySmartDevicesPage />} />
        <Route path="whatsapp" element={<PropertyWhatsAppPage />} />
        <Route path="cctv" element={<PropertyCCTVPage />} />
        <Route path="parking" element={<PropertyParkingPage />} />
        <Route path="reports" element={<PropertyReportsPage />} />
        <Route path="reports/rent-roll" element={<RentRollReportPage />} />
        <Route path="reports/arrears" element={<ArrearsReportPage />} />
        <Route path="reports/collection-rate" element={<CollectionRateReportPage />} />
        <Route path="reports/outstanding-balances" element={<OutstandingBalancesReportPage />} />
        <Route path="reports/lease-expiry" element={<LeaseExpiryReportPage />} />
        <Route path="reports/payment-behavior" element={<PaymentBehaviorReportPage />} />
        <Route path="reports/occupancy" element={<OccupancyReportPage />} />
        <Route path="reports/vacancy-detail" element={<VacancyDetailReportPage />} />
        <Route path="reports/utility-consumption" element={<UtilityConsumptionReportPage />} />
        <Route path="reports/meter-readings" element={<MeterReadingsReportPage />} />
        <Route path="reports/vacancy-loss" element={<VacancyLossPage />} />
        <Route path="reports/expiry-calendar" element={<ExpiryCalendarPage />} />
        <Route path="reports/payment-scorecard" element={<PaymentScorecardPage />} />
        <Route path="reports/discount-impact" element={<DiscountImpactPage />} />
        <Route path="apps" element={<PropertyAppsPage />} />
        <Route path="apps/voice-agent" element={<VoiceAgentDashboardPage />} />
        <Route path="settings" element={<PropertySettingsPage />} />
      </Route>

      {/* Tenant management */}
      <Route
        path="/tenants"
        element={
          <ProtectedRoute allowedRoles={[...PROPERTY_ROLES]}>
            <TenantsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/tenants/:tenantId"
        element={
          <ProtectedRoute allowedRoles={[...PROPERTY_ROLES]}>
            <TenantDetailPage />
          </ProtectedRoute>
        }
      />

      {/* Root → role home */}
      <Route path="/" element={<RoleRedirect />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
    </AuthenticatedApp>
  )
}
