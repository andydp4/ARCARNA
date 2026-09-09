import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import { useToast } from '@/hooks/use-toast'
import { apiRequest } from '@/lib/queryClient'
import { OrgNameSettings } from '@/components/OrgNameSettings'
import { PageHeader, LM_CARD } from '@/components/PageHeader'
import { ImportsHub } from '@/components/settings/ImportsHub'
import { SuppliersHub } from '@/components/settings/SuppliersHub'
import { WhatsAppSettings } from '@/components/settings/WhatsAppSettings'
import { CashierCommissionSettings } from '@/components/settings/CashierCommissionSettings'
import { BrandingSettings } from '@/components/settings/BrandingSettings'
import { FeatureFlagsSettings } from '@/pages/settings/feature-flags'
import { useAuth } from '@/hooks/useAuth'
import { Link } from "wouter";
import {
  Settings2,
  CreditCard,
  Users,
  Moon,
  Copy,
  Check,
  MapPin,
  Building,
  Phone,
  Mail,
  Boxes,
  Award,
  LayoutTemplate,
  Lock,
} from 'lucide-react'

/** What `GET /api/settings` returns — see server/routes/settingsOrg.ts. */
interface OrgSettings {
  businessName: string
  businessAddress: string
  businessPhone: string
  businessEmail: string
  vatRate: number
  vatNumber: string
  bankName: string
  accountNumber: string
  sortCode: string
  invoicePaymentLink: string
}

const EMPTY_PROFILE_FORM = {
  businessName: '',
  businessAddress: '',
  businessPhone: '',
  businessEmail: '',
  vatNumber: '',
  vatRate: 20,
}

export default function Settings() {
  const { user } = useAuth()
  const canManageFlags = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN'
  const canViewCashiers = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN' || user?.role === 'MANAGER'
  // Business Information and Tax Settings write real org data (ARC-006) —
  // same bar the rest of the app uses for org-identity fields.
  const canEditOrgProfile = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN'
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState('general')
  const [copiedText, setCopiedText] = useState('')

  const { data: orgSettings, isLoading: isLoadingSettings } = useQuery<OrgSettings>({
    queryKey: ['/api/settings'],
  })

  const [profileForm, setProfileForm] = useState(EMPTY_PROFILE_FORM)

  useEffect(() => {
    if (!orgSettings) return
    setProfileForm({
      businessName: orgSettings.businessName ?? '',
      businessAddress: orgSettings.businessAddress ?? '',
      businessPhone: orgSettings.businessPhone ?? '',
      businessEmail: orgSettings.businessEmail ?? '',
      vatNumber: orgSettings.vatNumber ?? '',
      vatRate: orgSettings.vatRate ?? 20,
    })
  }, [orgSettings])

  const saveProfile = useMutation({
    mutationFn: async () => {
      await apiRequest('PATCH', '/api/settings', profileForm)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/settings'] })
      toast({ title: 'Saved', description: 'Business and tax settings updated for your organization.' })
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to save', description: error.message, variant: 'destructive' })
    },
  })

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    setCopiedText(label)
    setTimeout(() => setCopiedText(''), 2000)
    toast({
      title: 'Copied',
      description: `${label} copied to clipboard`,
    })
  }

  return (
    <div className="w-full">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <PageHeader
          icon={Settings2}
          title="Settings"
          question="How is Arcarna set up for your business?"
          explanation="Business name, branding, suppliers, cashiers and flags save to your account. A few cards below are placeholders for features that aren't wired up to anything yet — each says so plainly."
        />

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-3 md:grid-cols-8 min-h-[48px]">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="imports">Imports</TabsTrigger>
            <TabsTrigger value="suppliers">Suppliers</TabsTrigger>
            <TabsTrigger value="payment">Payment</TabsTrigger>
            <TabsTrigger value="invoice">Invoice</TabsTrigger>
            <TabsTrigger value="system">System</TabsTrigger>
            <TabsTrigger value="integrations">Integrations</TabsTrigger>
            {canViewCashiers && <TabsTrigger value="cashiers" data-testid="tab-cashiers">Cashiers</TabsTrigger>}
            <TabsTrigger value="users">Users</TabsTrigger>
            {canManageFlags && <TabsTrigger value="flags">Flags</TabsTrigger>}
          </TabsList>

          <TabsContent value="imports" className="space-y-6">
            <ImportsHub />
          </TabsContent>

          <TabsContent value="integrations" className="space-y-6">
            <Card className={LM_CARD}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <LayoutTemplate className="h-5 w-5" />
                  WM Supplies Website
                </CardTitle>
                <CardDescription>Customer-facing homepage, media, theme, and order intake</CardDescription>
              </CardHeader>
              <CardContent>
                <Link href="/settings/wm-supplies-website">
                  <Button variant="outline">Open website manager</Button>
                </Link>
              </CardContent>
            </Card>
            <WhatsAppSettings />
          </TabsContent>

          <TabsContent value="suppliers" className="space-y-6">
            <SuppliersHub />
          </TabsContent>

          {canViewCashiers && (
            <TabsContent value="cashiers" className="space-y-6">
              <CashierCommissionSettings />
            </TabsContent>
          )}

          {/* General Settings */}
          <TabsContent value="general" className="space-y-6">
              <OrgNameSettings />
              <Card className={LM_CARD}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Building className="h-5 w-5" />
                    Business Information
                  </CardTitle>
                  <CardDescription>
                    {canEditOrgProfile
                      ? 'Your business details used on invoices and receipts'
                      : 'Your business details used on invoices and receipts. Ask an admin to change these.'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {isLoadingSettings ? (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                  ) : (
                    <>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="businessName">Business Name</Label>
                          <Input
                            id="businessName"
                            value={profileForm.businessName}
                            onChange={(e) => setProfileForm((p) => ({ ...p, businessName: e.target.value }))}
                            className="min-h-[44px]"
                            disabled={!canEditOrgProfile}
                            data-testid="input-business-name"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="businessPhone">Phone</Label>
                          <div className="flex gap-2">
                            <Phone className="h-4 w-4 mt-2 text-muted-foreground" />
                            <Input
                              id="businessPhone"
                              value={profileForm.businessPhone}
                              onChange={(e) => setProfileForm((p) => ({ ...p, businessPhone: e.target.value }))}
                              placeholder="+44 20 7946 0958"
                              className="min-h-[44px]"
                              disabled={!canEditOrgProfile}
                            />
                          </div>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="businessAddress">Address</Label>
                        <div className="flex gap-2">
                          <MapPin className="h-4 w-4 mt-2 text-muted-foreground" />
                          <Textarea
                            id="businessAddress"
                            value={profileForm.businessAddress}
                            onChange={(e) => setProfileForm((p) => ({ ...p, businessAddress: e.target.value }))}
                            placeholder="123 High Street, City, County, Postcode"
                            rows={2}
                            disabled={!canEditOrgProfile}
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="businessEmail">Email</Label>
                        <div className="flex gap-2">
                          <Mail className="h-4 w-4 mt-2 text-muted-foreground" />
                          <Input
                            id="businessEmail"
                            type="email"
                            value={profileForm.businessEmail}
                            onChange={(e) => setProfileForm((p) => ({ ...p, businessEmail: e.target.value }))}
                            placeholder="info@example.com"
                            disabled={!canEditOrgProfile}
                          />
                        </div>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              <Separator />

              <Card className={LM_CARD}>
                <CardHeader>
                  <CardTitle>Tax Settings</CardTitle>
                  <CardDescription>
                    VAT rate used on every order (client/src/pages/pos.tsx) and invoice
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {isLoadingSettings ? (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="vatRate">VAT Rate (%)</Label>
                        <Input
                          id="vatRate"
                          type="number"
                          value={profileForm.vatRate}
                          onChange={(e) => setProfileForm((p) => ({ ...p, vatRate: parseFloat(e.target.value) || 0 }))}
                          disabled={!canEditOrgProfile}
                          data-testid="input-vat-rate"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="vatNumber">VAT Number</Label>
                        <Input
                          id="vatNumber"
                          value={profileForm.vatNumber}
                          onChange={(e) => setProfileForm((p) => ({ ...p, vatNumber: e.target.value }))}
                          placeholder="GB123456789"
                          disabled={!canEditOrgProfile}
                        />
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {canEditOrgProfile && (
                <div className="flex justify-end">
                  <Button
                    onClick={() => saveProfile.mutate()}
                    disabled={saveProfile.isPending || isLoadingSettings}
                    className="min-h-[44px]"
                    data-testid="button-save-business-tax"
                  >
                    Save business & tax settings
                  </Button>
                </div>
              )}

              <Separator />

              <Card className={LM_CARD}>
                <CardHeader>
                  <CardTitle>Appearance</CardTitle>
                  <CardDescription>Customize the look and feel</CardDescription>
                </CardHeader>
                <CardContent>
                  {/* The light/dark toggle was removed: Arcarna's Liquid Metal
                      tokens are defined on :root, so flipping the `dark` class
                      changed nothing users could rely on — a control that
                      appeared to work but didn't. */}
                  <div className="flex items-start gap-3">
                    <Moon className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    <div>
                      <Label>Interface theme</Label>
                      <p className="text-sm text-muted-foreground">
                        Arcarna uses a single dark “Liquid Metal” interface, tuned for long shifts
                        and shop-floor lighting. There is no light mode.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
          </TabsContent>

          {/* Payment Settings */}
          <TabsContent value="payment" className="space-y-6">
              <Card className={LM_CARD}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <CreditCard className="h-5 w-5" />
                    Payment Methods
                  </CardTitle>
                  <CardDescription className="flex items-center gap-1.5">
                    <Lock className="h-3.5 w-3.5" />
                    Not wired up yet — every method below is offered at checkout regardless of this switch.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="cardPayment" className="text-muted-foreground">Card Payment</Label>
                      <Switch id="cardPayment" checked disabled />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="cashPayment" className="text-muted-foreground">Cash Payment</Label>
                      <Switch id="cashPayment" checked disabled />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="tickPayment" className="text-muted-foreground">Credit Payment</Label>
                      <Switch id="tickPayment" checked disabled />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="transferPayment" className="text-muted-foreground">Bank Transfer</Label>
                      <Switch id="transferPayment" checked disabled />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Separator />

              <Card className={LM_CARD}>
                <CardHeader>
                  <CardTitle>Bank Details</CardTitle>
                  <CardDescription>
                    Shown on invoices and copied at the till for transfer payments.
                    {canEditOrgProfile && ' Edited under Invoice → Branding.'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {isLoadingSettings ? (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                  ) : !orgSettings?.bankName && !orgSettings?.accountNumber && !orgSettings?.sortCode ? (
                    <p className="text-sm text-muted-foreground">
                      No bank details on file yet.
                      {canEditOrgProfile && ' Add them under the Invoice tab.'}
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {orgSettings?.bankName && (
                        <div className="space-y-1">
                          <Label className="text-muted-foreground">Bank Name</Label>
                          <p className="min-h-[44px] flex items-center font-medium">{orgSettings.bankName}</p>
                        </div>
                      )}
                      {orgSettings?.accountNumber && (
                        <div className="space-y-1">
                          <Label className="text-muted-foreground">Account Number</Label>
                          <div className="flex items-center gap-2">
                            <p className="font-medium font-mono">{orgSettings.accountNumber}</p>
                            <Button
                              variant="outline"
                              size="icon"
                              aria-label="Copy account number"
                              onClick={() => copyToClipboard(orgSettings.accountNumber, 'Account Number')}
                              data-testid="button-copy-account"
                            >
                              {copiedText === 'Account Number' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                            </Button>
                          </div>
                        </div>
                      )}
                      {orgSettings?.sortCode && (
                        <div className="space-y-1">
                          <Label className="text-muted-foreground">Sort Code</Label>
                          <div className="flex items-center gap-2">
                            <p className="font-medium font-mono">{orgSettings.sortCode}</p>
                            <Button
                              variant="outline"
                              size="icon"
                              aria-label="Copy sort code"
                              onClick={() => copyToClipboard(orgSettings.sortCode, 'Sort Code')}
                            >
                              {copiedText === 'Sort Code' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {canEditOrgProfile && (
                    <Button variant="outline" size="sm" onClick={() => setActiveTab('invoice')} data-testid="button-edit-bank-details">
                      Edit under Invoice
                    </Button>
                  )}
                </CardContent>
              </Card>

              <Separator />

              <Card className={LM_CARD}>
                <CardHeader>
                  <CardTitle>Collection & Delivery</CardTitle>
                  <CardDescription className="flex items-center gap-1.5">
                    <Lock className="h-3.5 w-3.5" />
                    Not wired up yet — nothing in the order flow reads these fields.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 opacity-60">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="collectionEnabled">Collection Available</Label>
                      <p className="text-sm text-muted-foreground">Allow customers to collect orders</p>
                    </div>
                    <Switch id="collectionEnabled" checked disabled />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="collectionAddress">Collection Address</Label>
                    <Textarea id="collectionAddress" placeholder="123 Pickup Street, City, County, Postcode" rows={2} disabled />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="deliveryEnabled">Delivery Available</Label>
                      <p className="text-sm text-muted-foreground">Offer delivery service</p>
                    </div>
                    <Switch id="deliveryEnabled" checked disabled />
                  </div>
                </CardContent>
              </Card>

              {/* /settings/loyalty was registered in App.tsx but nothing linked
                  to it, so the only way to reach it was to type the URL. It is
                  not the same page as /loyalty, which manages tiers — this one
                  sets what a point is worth at checkout. */}
              <Card className={LM_CARD}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Award className="h-5 w-5" />
                    Loyalty redemption
                  </CardTitle>
                  <CardDescription>
                    What a point is worth at checkout, and the minimum a customer can redeem.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Link href="/settings/loyalty">
                    <Button variant="outline" data-testid="link-loyalty-settings">
                      Open loyalty redemption settings
                    </Button>
                  </Link>
                </CardContent>
              </Card>
          </TabsContent>

          {/* Invoice Settings */}
          <TabsContent value="invoice" className="space-y-6">
              <BrandingSettings />
              <Card className={LM_CARD}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Mail className="h-5 w-5" />
                    Email receipts
                  </CardTitle>
                  <CardDescription>
                    Branded HTML receipts sent after POS checkout via Resend.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Link href="/settings/receipts">
                    <Button variant="outline">Open receipt template editor</Button>
                  </Link>
                </CardContent>
              </Card>
          </TabsContent>

          {/* System Settings */}
          <TabsContent value="system" className="space-y-6">
              <Card className={LM_CARD}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Boxes className="h-5 w-5" />
                    Stock Management
                  </CardTitle>
                  <CardDescription>How low stock is tracked</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    There's no single org-wide low-stock percentage — each product has its own
                    stock limit, set on that product's row in{' '}
                    <Link href="/products" className="underline underline-offset-2">
                      Products
                    </Link>
                    . That per-product limit is what drives the low-stock and out-of-stock counts
                    across the app.
                  </p>
                </CardContent>
              </Card>

              {canEditOrgProfile && (
                <>
                  <Separator />
                  <Card className={LM_CARD}>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <MapPin className="h-5 w-5" />
                        Multi-Location
                      </CardTitle>
                      <CardDescription>
                        Every org can already run more than one store — there's no switch to
                        turn on, just locations to add.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Link href="/locations">
                        <Button variant="outline" data-testid="link-locations">
                          Manage locations
                        </Button>
                      </Link>
                    </CardContent>
                  </Card>
                </>
              )}
          </TabsContent>

          {/* Users Management */}
          {canManageFlags && (
            <TabsContent value="flags" className="space-y-6">
              <FeatureFlagsSettings />
            </TabsContent>
          )}

          <TabsContent value="users">
            <Card className={LM_CARD}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  User Management
                </CardTitle>
                <CardDescription>
                  User accounts, approvals and org access are managed in User Access.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  This tab previously showed an example list that could not actually change
                  anything. Real approvals, role changes and suspensions all happen on the
                  User Access page.
                </p>
                <Button asChild className="gap-2" data-testid="button-open-user-access">
                  <Link href="/user-access">
                    <Users className="h-4 w-4" />
                    Open User Access
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
