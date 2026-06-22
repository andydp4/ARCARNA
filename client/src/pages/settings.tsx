import { useState, useEffect } from 'react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
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
  Store,
  Receipt,
  CreditCard,
  Users,
  Moon,
  Copy,
  Check,
  MapPin,
  Building,
  Phone,
  Mail,
  Globe,
  Award,
  LayoutTemplate,
} from 'lucide-react'

export default function Settings() {
  const { user } = useAuth()
  const canManageFlags = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN'
  const canViewCashiers = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN' || user?.role === 'MANAGER'
  const { toast } = useToast()
  const [activeTab, setActiveTab] = useState('general')
  const [copiedText, setCopiedText] = useState('')

  // Load settings from localStorage or API
  const [settings, setSettings] = useState({
    // General Settings
    businessName: 'arcarna',
    businessAddress: '',
    businessPhone: '',
    businessEmail: '',
    businessWebsite: '',
    
    // Tax Settings
    vatEnabled: true,
    vatRate: 20,
    vatNumber: '',
    
    // Payment Settings
    cardPaymentEnabled: true,
    cashPaymentEnabled: true,
    tickPaymentEnabled: true,
    transferPaymentEnabled: true,
    bankName: '',
    accountName: '',
    accountNumber: '',
    sortCode: '',
    iban: '',
    swift: '',
    
    // Collection/Delivery Settings
    collectionEnabled: true,
    collectionAddress: '',
    collectionInstructions: '',
    deliveryEnabled: true,
    deliveryFee: 5,
    freeDeliveryThreshold: 50,
    
    // Invoice Settings
    invoicePrefix: 'INV',
    invoiceStartNumber: 1000,
    invoiceFooterText: 'Thank you for your business!',
    invoiceTerms: 'Payment due within 30 days',
    showVatBreakdown: true,
    
    // System Settings
    lowStockThreshold: 20,
    criticalStockThreshold: 5,
    autoBackup: true,
    backupFrequency: 'daily',
    multiLocationEnabled: false,
    defaultLocation: '',
  })

  useEffect(() => {
    // Load saved settings. These are browser-local only — see saveSettings.
    const savedSettings = localStorage.getItem('settings')
    if (savedSettings) {
      try {
        setSettings(JSON.parse(savedSettings))
      } catch {
        // Corrupt payload: keep defaults rather than crash the page.
        localStorage.removeItem('settings')
      }
    }
  }, [])

  const handleSettingChange = (section: string, field: string, value: any) => {
    setSettings(prev => ({
      ...prev,
      [field]: value
    }))
  }

  const saveSettings = () => {
    localStorage.setItem('settings', JSON.stringify(settings))
    // Be explicit about where this landed. These preferences are stored in this
    // browser only — they do not sync to the server or to other devices.
    toast({
      title: 'Saved to this browser',
      description: 'These preferences apply on this device only. They are not synced to your account.',
    })
  }

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
          explanation="Business name, branding, suppliers, cashiers and feature flags save to your account. The preference fields on General, Payment, Invoice and System save to this browser only."
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
                  <CardDescription>Your business details used on invoices and receipts</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="businessName">Business Name</Label>
                      <Input
                        id="businessName"
                        value={settings.businessName}
                        onChange={(e) => handleSettingChange('general', 'businessName', e.target.value)}
                        className="min-h-[44px]"
                        data-testid="input-business-name"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="businessWebsite">Website</Label>
                      <div className="flex gap-2">
                        <Globe className="h-4 w-4 mt-2 text-muted-foreground" />
                        <Input
                          id="businessWebsite"
                          value={settings.businessWebsite}
                          onChange={(e) => handleSettingChange('general', 'businessWebsite', e.target.value)}
                          placeholder="www.example.com"
                          className="min-h-[44px]"
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
                        value={settings.businessAddress}
                        onChange={(e) => handleSettingChange('general', 'businessAddress', e.target.value)}
                        placeholder="123 High Street, City, County, Postcode"
                        rows={2}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="businessPhone">Phone</Label>
                      <div className="flex gap-2">
                        <Phone className="h-4 w-4 mt-2 text-muted-foreground" />
                        <Input
                          id="businessPhone"
                          value={settings.businessPhone}
                          onChange={(e) => handleSettingChange('general', 'businessPhone', e.target.value)}
                          placeholder="+44 20 7946 0958"
                          className="min-h-[44px]"
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
                          value={settings.businessEmail}
                          onChange={(e) => handleSettingChange('general', 'businessEmail', e.target.value)}
                          placeholder="info@example.com"
                        />
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Separator />

              <Card className={LM_CARD}>
                <CardHeader>
                  <CardTitle>Tax Settings</CardTitle>
                  <CardDescription>Configure VAT and tax calculations</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="vatEnabled">VAT Enabled</Label>
                      <p className="text-sm text-muted-foreground">Apply VAT to all transactions</p>
                    </div>
                    <Switch
                      id="vatEnabled"
                      checked={settings.vatEnabled}
                      onCheckedChange={(checked) => handleSettingChange('general', 'vatEnabled', checked)}
                      data-testid="switch-vat-enabled"
                    />
                  </div>
                  {settings.vatEnabled && (
                    <>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="vatRate">VAT Rate (%)</Label>
                          <Input
                            id="vatRate"
                            type="number"
                            value={settings.vatRate}
                            onChange={(e) => handleSettingChange('general', 'vatRate', parseFloat(e.target.value))}
                            data-testid="input-vat-rate"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="vatNumber">VAT Number</Label>
                          <Input
                            id="vatNumber"
                            value={settings.vatNumber}
                            onChange={(e) => handleSettingChange('general', 'vatNumber', e.target.value)}
                            placeholder="GB123456789"
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
                  <CardDescription>Configure accepted payment methods</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="cardPayment">Card Payment</Label>
                      <Switch
                        id="cardPayment"
                        checked={settings.cardPaymentEnabled}
                        onCheckedChange={(checked) => handleSettingChange('payment', 'cardPaymentEnabled', checked)}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="cashPayment">Cash Payment</Label>
                      <Switch
                        id="cashPayment"
                        checked={settings.cashPaymentEnabled}
                        onCheckedChange={(checked) => handleSettingChange('payment', 'cashPaymentEnabled', checked)}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="tickPayment">Tick Payment (Credit)</Label>
                      <Switch
                        id="tickPayment"
                        checked={settings.tickPaymentEnabled}
                        onCheckedChange={(checked) => handleSettingChange('payment', 'tickPaymentEnabled', checked)}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="transferPayment">Bank Transfer</Label>
                      <Switch
                        id="transferPayment"
                        checked={settings.transferPaymentEnabled}
                        onCheckedChange={(checked) => handleSettingChange('payment', 'transferPaymentEnabled', checked)}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Separator />

              <Card className={LM_CARD}>
                <CardHeader>
                  <CardTitle>Bank Details</CardTitle>
                  <CardDescription>Shown on invoices and receipts when customers pay by transfer</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="bankName">Bank Name</Label>
                      <Input
                        id="bankName"
                        value={settings.bankName}
                        onChange={(e) => handleSettingChange('payment', 'bankName', e.target.value)}
                        className="min-h-[44px]"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="accountName">Account Name</Label>
                      <Input
                        id="accountName"
                        value={settings.accountName}
                        onChange={(e) => handleSettingChange('payment', 'accountName', e.target.value)}
                        className="min-h-[44px]"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="accountNumber">Account Number</Label>
                      <div className="flex gap-2">
                        <Input
                          id="accountNumber"
                          value={settings.accountNumber}
                          onChange={(e) => handleSettingChange('payment', 'accountNumber', e.target.value)}
                        />
                        <Button
                          variant="outline"
                          size="icon"
                          aria-label="Copy account number"
                          onClick={() => copyToClipboard(settings.accountNumber, 'Account Number')}
                          data-testid="button-copy-account"
                        >
                          {copiedText === 'Account Number' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="sortCode">Sort Code</Label>
                      <div className="flex gap-2">
                        <Input
                          id="sortCode"
                          value={settings.sortCode}
                          onChange={(e) => handleSettingChange('payment', 'sortCode', e.target.value)}
                          placeholder="12-34-56"
                        />
                        <Button
                          variant="outline"
                          size="icon"
                          aria-label="Copy sort code"
                          onClick={() => copyToClipboard(settings.sortCode, 'Sort Code')}
                        >
                          {copiedText === 'Sort Code' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="iban">IBAN</Label>
                      <div className="flex gap-2">
                        <Input
                          id="iban"
                          value={settings.iban}
                          onChange={(e) => handleSettingChange('payment', 'iban', e.target.value)}
                        />
                        <Button
                          variant="outline"
                          size="icon"
                          aria-label="Copy IBAN"
                          onClick={() => copyToClipboard(settings.iban, 'IBAN')}
                        >
                          {copiedText === 'IBAN' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="swift">SWIFT/BIC</Label>
                      <div className="flex gap-2">
                        <Input
                          id="swift"
                          value={settings.swift}
                          onChange={(e) => handleSettingChange('payment', 'swift', e.target.value)}
                        />
                        <Button
                          variant="outline"
                          size="icon"
                          aria-label="Copy SWIFT code"
                          onClick={() => copyToClipboard(settings.swift, 'SWIFT')}
                        >
                          {copiedText === 'SWIFT' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Separator />

              <Card className={LM_CARD}>
                <CardHeader>
                  <CardTitle>Collection & Delivery</CardTitle>
                  <CardDescription>Pickup and delivery options shown to staff and on customer-facing flows</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label htmlFor="collectionEnabled">Collection Available</Label>
                        <p className="text-sm text-muted-foreground">Allow customers to collect orders</p>
                      </div>
                      <Switch
                        id="collectionEnabled"
                        checked={settings.collectionEnabled}
                        onCheckedChange={(checked) => handleSettingChange('payment', 'collectionEnabled', checked)}
                      />
                    </div>
                    {settings.collectionEnabled && (
                      <>
                        <div className="space-y-2">
                          <Label htmlFor="collectionAddress">Collection Address</Label>
                          <div className="flex gap-2">
                            <Textarea
                              id="collectionAddress"
                              value={settings.collectionAddress}
                              onChange={(e) => handleSettingChange('payment', 'collectionAddress', e.target.value)}
                              placeholder="123 Pickup Street, City, County, Postcode"
                              rows={2}
                            />
                            <Button
                              variant="outline"
                              size="icon"
                              aria-label="Copy collection address"
                              onClick={() => copyToClipboard(settings.collectionAddress, 'Collection Address')}
                            >
                              {copiedText === 'Collection Address' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                            </Button>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="collectionInstructions">Collection Instructions</Label>
                          <Textarea
                            id="collectionInstructions"
                            value={settings.collectionInstructions}
                            onChange={(e) => handleSettingChange('payment', 'collectionInstructions', e.target.value)}
                            placeholder="Collection hours: Mon-Fri 9am-5pm"
                            rows={2}
                          />
                        </div>
                      </>
                    )}
                    <div className="flex items-center justify-between">
                      <div>
                        <Label htmlFor="deliveryEnabled">Delivery Available</Label>
                        <p className="text-sm text-muted-foreground">Offer delivery service</p>
                      </div>
                      <Switch
                        id="deliveryEnabled"
                        checked={settings.deliveryEnabled}
                        onCheckedChange={(checked) => handleSettingChange('payment', 'deliveryEnabled', checked)}
                      />
                    </div>
                    {settings.deliveryEnabled && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="deliveryFee">Delivery Fee</Label>
                          <Input
                            id="deliveryFee"
                            type="number"
                            value={settings.deliveryFee}
                            onChange={(e) => handleSettingChange('payment', 'deliveryFee', parseFloat(e.target.value))}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="freeDeliveryThreshold">Free Delivery Above</Label>
                          <Input
                            id="freeDeliveryThreshold"
                            type="number"
                            value={settings.freeDeliveryThreshold}
                            onChange={(e) => handleSettingChange('payment', 'freeDeliveryThreshold', parseFloat(e.target.value))}
                          />
                        </div>
                      </div>
                    )}
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
              <Card className={LM_CARD}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Receipt className="h-5 w-5" />
                    Invoice Configuration
                  </CardTitle>
                  <CardDescription>Customize invoice format and content</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="invoicePrefix">Invoice Prefix</Label>
                      <Input
                        id="invoicePrefix"
                        value={settings.invoicePrefix}
                        onChange={(e) => handleSettingChange('invoice', 'invoicePrefix', e.target.value)}
                        placeholder="INV"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="invoiceStartNumber">Start Number</Label>
                      <Input
                        id="invoiceStartNumber"
                        type="number"
                        value={settings.invoiceStartNumber}
                        onChange={(e) => handleSettingChange('invoice', 'invoiceStartNumber', parseInt(e.target.value))}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="invoiceFooterText">Footer Text</Label>
                    <Textarea
                      id="invoiceFooterText"
                      value={settings.invoiceFooterText}
                      onChange={(e) => handleSettingChange('invoice', 'invoiceFooterText', e.target.value)}
                      placeholder="Thank you for your business!"
                      rows={2}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="invoiceTerms">Payment Terms</Label>
                    <Textarea
                      id="invoiceTerms"
                      value={settings.invoiceTerms}
                      onChange={(e) => handleSettingChange('invoice', 'invoiceTerms', e.target.value)}
                      placeholder="Payment due within 30 days"
                      rows={3}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="showVatBreakdown">Show VAT Breakdown</Label>
                      <p className="text-sm text-muted-foreground">Display detailed VAT information on invoices</p>
                    </div>
                    <Switch
                      id="showVatBreakdown"
                      checked={settings.showVatBreakdown}
                      onCheckedChange={(checked) => handleSettingChange('invoice', 'showVatBreakdown', checked)}
                    />
                  </div>
                </CardContent>
              </Card>
          </TabsContent>

          {/* System Settings */}
          <TabsContent value="system" className="space-y-6">
              <Card className={LM_CARD}>
                <CardHeader>
                  <CardTitle>Stock Management</CardTitle>
                  <CardDescription>Configure inventory thresholds and alerts</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="lowStockThreshold">Low Stock Alert (%)</Label>
                      <Input
                        id="lowStockThreshold"
                        type="number"
                        value={settings.lowStockThreshold}
                        onChange={(e) => handleSettingChange('system', 'lowStockThreshold', parseInt(e.target.value))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="criticalStockThreshold">Critical Stock Alert (%)</Label>
                      <Input
                        id="criticalStockThreshold"
                        type="number"
                        value={settings.criticalStockThreshold}
                        onChange={(e) => handleSettingChange('system', 'criticalStockThreshold', parseInt(e.target.value))}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Separator />

              <Card className={LM_CARD}>
                <CardHeader>
                  <CardTitle>Backup Settings</CardTitle>
                  <CardDescription>Configure automatic backups</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="autoBackup">Automatic Backup</Label>
                      <p className="text-sm text-muted-foreground">Regularly backup system data</p>
                    </div>
                    <Switch
                      id="autoBackup"
                      checked={settings.autoBackup}
                      onCheckedChange={(checked) => handleSettingChange('system', 'autoBackup', checked)}
                    />
                  </div>
                  {settings.autoBackup && (
                    <div className="space-y-2">
                      <Label htmlFor="backupFrequency">Backup Frequency</Label>
                      <Select
                        value={settings.backupFrequency}
                        onValueChange={(value) => handleSettingChange('system', 'backupFrequency', value)}
                      >
                        <SelectTrigger className="min-h-[44px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="hourly">Hourly</SelectItem>
                          <SelectItem value="daily">Daily</SelectItem>
                          <SelectItem value="weekly">Weekly</SelectItem>
                          <SelectItem value="monthly">Monthly</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Separator />

              <Card className={LM_CARD}>
                <CardHeader>
                  <CardTitle>Multi-Location</CardTitle>
                  <CardDescription>Manage multiple store locations</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="multiLocation">Enable Multi-Location</Label>
                      <p className="text-sm text-muted-foreground">Manage inventory across multiple stores</p>
                    </div>
                    <Switch
                      id="multiLocation"
                      checked={settings.multiLocationEnabled}
                      onCheckedChange={(checked) => handleSettingChange('system', 'multiLocationEnabled', checked)}
                    />
                  </div>
                </CardContent>
              </Card>
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

        <div className="sticky bottom-0 z-10 mt-8 flex flex-col items-end gap-2 border-t bg-background/95 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:flex-row sm:items-center sm:justify-between">
          {/* Say plainly where this saves — these fields are browser-local, and
              a bare "Saved successfully" previously implied account-wide sync. */}
          <p className="text-xs text-muted-foreground">
            Saves the preference fields to this browser only. Business name, branding, suppliers,
            cashiers and flags save to your account from their own sections.
          </p>
          <Button onClick={saveSettings} size="lg" className="min-h-[48px] w-full sm:w-auto" data-testid="button-save-settings">
            Save to this browser
          </Button>
        </div>
      </div>
    </div>
  )
}
