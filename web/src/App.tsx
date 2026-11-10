import { Suspense, lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import { PublicLayout } from './components/PublicLayout';
import { AppLayout } from './components/AppLayout';
import { AdminLayout } from './components/AdminLayout';
import { RequireAuth, RequireMfaSetup } from './components/guards';
import { Loading } from './components/ui';

const HomePage = lazy(() => import('./pages/public/HomePage').then(m => ({ default: m.HomePage })));
const PricingPage = lazy(() => import('./pages/public/PricingPage').then(m => ({ default: m.PricingPage })));
const DocsPage = lazy(() => import('./pages/public/DocsPage').then(m => ({ default: m.DocsPage })));
const LegalPage = lazy(() => import('./pages/public/LegalPage').then(m => ({ default: m.LegalPage })));
const PublicSupportPage = lazy(() => import('./pages/public/SupportPage').then(m => ({ default: m.SupportPage })));
const StatusPage = lazy(() => import('./pages/public/StatusPage').then(m => ({ default: m.StatusPage })));

const LoginPage = lazy(() => import('./pages/auth/LoginPage').then(m => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => import('./pages/auth/RegisterPage').then(m => ({ default: m.RegisterPage })));
const VerifyPage = lazy(() => import('./pages/auth/VerifyPage').then(m => ({ default: m.VerifyPage })));
const ForgotPasswordPage = lazy(() => import('./pages/auth/ForgotPasswordPage').then(m => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import('./pages/auth/ResetPasswordPage').then(m => ({ default: m.ResetPasswordPage })));
const AdminMfaPage = lazy(() => import('./pages/auth/AdminMfaPage').then(m => ({ default: m.AdminMfaPage })));

const OverviewPage = lazy(() => import('./pages/app/OverviewPage').then(m => ({ default: m.OverviewPage })));
const SendPage = lazy(() => import('./pages/app/SendPage').then(m => ({ default: m.SendPage })));
const MessagesPage = lazy(() => import('./pages/app/MessagesPage').then(m => ({ default: m.MessagesPage })));
const MessageDetailPage = lazy(() => import('./pages/app/MessageDetailPage').then(m => ({ default: m.MessageDetailPage })));
const WalletPage = lazy(() => import('./pages/app/WalletPage').then(m => ({ default: m.WalletPage })));
const ProjectsPage = lazy(() => import('./pages/app/ProjectsPage').then(m => ({ default: m.ProjectsPage })));
const WebhooksPage = lazy(() => import('./pages/app/WebhooksPage').then(m => ({ default: m.WebhooksPage })));
const ContactsPage = lazy(() => import('./pages/app/ContactsPage').then(m => ({ default: m.ContactsPage })));
const SendersPage = lazy(() => import('./pages/app/SendersPage').then(m => ({ default: m.SendersPage })));
const DeveloperSupportPage = lazy(() => import('./pages/app/SupportPage').then(m => ({ default: m.DeveloperSupportPage })));
const SettingsPage = lazy(() => import('./pages/app/SettingsPage').then(m => ({ default: m.SettingsPage })));
const WhatsappPage = lazy(() => import('./pages/app/WhatsappPage').then(m => ({ default: m.WhatsappPage })));
const HostingPage = lazy(() => import('./pages/app/HostingPage').then(m => ({ default: m.HostingPage })));
const DomainsPage = lazy(() => import('./pages/app/DomainsPage').then(m => ({ default: m.DomainsPage })));

const AdminOverviewPage = lazy(() => import('./pages/admin/AdminOverviewPage').then(m => ({ default: m.AdminOverviewPage })));
const AdminAccountsPage = lazy(() => import('./pages/admin/AdminAccountsPage').then(m => ({ default: m.AdminAccountsPage })));
const AdminAccountDetailPage = lazy(() => import('./pages/admin/AdminAccountDetailPage').then(m => ({ default: m.AdminAccountDetailPage })));
const AdminSendersPage = lazy(() => import('./pages/admin/AdminSendersPage').then(m => ({ default: m.AdminSendersPage })));
const AdminPricingPage = lazy(() => import('./pages/admin/AdminPricingPage').then(m => ({ default: m.AdminPricingPage })));
const AdminMessagesPage = lazy(() => import('./pages/admin/AdminMessagesPage').then(m => ({ default: m.AdminMessagesPage })));
const AdminReconciliationPage = lazy(() => import('./pages/admin/AdminReconciliationPage').then(m => ({ default: m.AdminReconciliationPage })));
const AdminWhatsappPage = lazy(() => import('./pages/admin/AdminWhatsappPage').then(m => ({ default: m.AdminWhatsappPage })));
const AdminSupportPage = lazy(() => import('./pages/admin/AdminSupportPage').then(m => ({ default: m.AdminSupportPage })));
const AdminAuditPage = lazy(() => import('./pages/admin/AdminAuditPage').then(m => ({ default: m.AdminAuditPage })));
const AdminSettingsPage = lazy(() => import('./pages/admin/AdminSettingsPage').then(m => ({ default: m.AdminSettingsPage })));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage').then(m => ({ default: m.NotFoundPage })));

function PageFallback() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <Loading label="Loading page…" />
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route element={<PublicLayout />}>
          <Route index element={<HomePage />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/status" element={<StatusPage />} />
          <Route path="/support" element={<PublicSupportPage />} />
          <Route path="/terms" element={<LegalPage kind="terms" />} />
          <Route path="/privacy" element={<LegalPage kind="privacy" />} />
          <Route path="/acceptable-use" element={<LegalPage kind="acceptable" />} />
        </Route>

        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/verify" element={<VerifyPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />

        <Route element={<RequireMfaSetup />}>
          <Route path="/admin/mfa" element={<AdminMfaPage />} />
        </Route>

        <Route element={<RequireAuth role="developer" />}>
          <Route path="/app" element={<AppLayout />}>
            <Route index element={<OverviewPage />} />
            <Route path="send" element={<SendPage />} />
            <Route path="messages" element={<MessagesPage />} />
            <Route path="messages/:id" element={<MessageDetailPage />} />
            <Route path="wallet" element={<WalletPage />} />
            <Route path="projects" element={<ProjectsPage />} />
            <Route path="webhooks" element={<WebhooksPage />} />
            <Route path="contacts" element={<ContactsPage />} />
            <Route path="senders" element={<SendersPage />} />
            <Route path="whatsapp" element={<WhatsappPage />} />
            <Route path="hosting" element={<HostingPage />} />
            <Route path="domains" element={<DomainsPage />} />
            <Route path="support" element={<DeveloperSupportPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Route>

        <Route element={<RequireAuth role="admin" />}>
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<AdminOverviewPage />} />
            <Route path="accounts" element={<AdminAccountsPage />} />
            <Route path="accounts/:id" element={<AdminAccountDetailPage />} />
            <Route path="senders" element={<AdminSendersPage />} />
            <Route path="pricing" element={<AdminPricingPage />} />
            <Route path="messages" element={<AdminMessagesPage />} />
            <Route path="reconciliation" element={<AdminReconciliationPage />} />
            <Route path="whatsapp" element={<AdminWhatsappPage />} />
            <Route path="support" element={<AdminSupportPage />} />
            <Route path="audit" element={<AdminAuditPage />} />
            <Route path="settings" element={<AdminSettingsPage />} />
          </Route>
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
