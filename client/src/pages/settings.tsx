import { useState, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { queryClient, apiRequest } from '@/lib/queryClient'
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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
import {
  Settings2,
  Store,
  Receipt,
  CreditCard,
  Users,
  Moon,
  Sun,
  Copy,
  Check,
  Plus,
  Edit,
  Trash2,
  UserCheck,
  UserX,
  MapPin,
  Building,
  Phone,
  Mail,
  Globe,
} from 'lucide-react'

export default function Settings() {
  const { toast } = useToast()
  const [activeTab, setActiveTab] = useState('general')
  const [copiedText, setCopiedText] = useState('')
  const [isDarkMode, setIsDarkMode] = useState(false)
  
  // Load settings from localStorage or API
  const [settings, setSettings] = useState({
    // General Settings
    businessName: 'Midnight EPOS',
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

  // Mock users data - would come from API
  const [users] = useState([
    { id: 1, name: 'Admin User', email: 'admin@midnight.com', role: 'admin', status: 'active' },
    { id: 2, name: 'John Doe', email: 'john@midnight.com', role: 'manager', status: 'active' },
    { id: 3, name: 'Jane Smith', email: 'jane@midnight.com', role: 'cashier', status: 'pending' },
  ])

  useEffect(() => {
    // Check system theme preference
    const savedTheme = localStorage.getItem('theme')
    if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      setIsDarkMode(true)
      document.documentElement.classList.add('dark')
    }
    
    // Load saved settings
    const savedSettings = localStorage.getItem('settings')
    if (savedSettings) {
      setSettings(JSON.parse(savedSettings))
    }
  }, [])

  const toggleTheme = () => {
    if (isDarkMode) {
      document.documentElement.classList.remove('dark')
      localStorage.setItem('theme', 'light')
      setIsDarkMode(false)
    } else {
      document.documentElement.classList.add('dark')
      localStorage.setItem('theme', 'dark')
      setIsDarkMode(true)
    }
  }

  const handleSettingChange = (section: string, field: string, value: any) => {
    setSettings(prev => ({
      ...prev,
      [field]: value
    }))
  }

  const saveSettings = () => {
    localStorage.setItem('settings', JSON.stringify(settings))
    toast({
      title: 'Success',
      description: 'Settings saved successfully',
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

  const handleUserAction = (userId: number, action: 'approve' | 'delete' | 'suspend') => {
    // Would call API here
    toast({
      title: 'Success',
      description: `User ${action}d successfully`,
    })
  }

  return (
    <div className="w-full">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground flex items-center gap-2">
            <Settings2 className="h-6 sm:h-8 w-6 sm:w-8" />
            System Settings
          </h1>
          <p className="text-muted-foreground mt-1">Configure your EPOS system settings and preferences</p>
          <p className="mt-2 text-sm text-muted-foreground">
            General, payment, invoice, and system options below save to this browser unless your environment syncs them server-side.
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-2 sm:grid-cols-3 md:grid-cols-5 min-h-[48px]">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="payment">Payment</TabsTrigger>
            <TabsTrigger value="invoice">Invoice</TabsTrigger>
            <TabsTrigger value="system">System</TabsTrigger>
            <TabsTrigger value="users">Users</TabsTrigger>
          </TabsList>

          {/* General Settings */}
          <TabsContent value="general" className="space-y-6">
              <Card>
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
                        placeholder="123 Main Street, City, State, ZIP"
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
                          placeholder="+1 234 567 8900"
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

              <Card>
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

              <Card>
                <CardHeader>
                  <CardTitle>Appearance</CardTitle>
                  <CardDescription>Customize the look and feel</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="darkMode">Dark Mode</Label>
                      <p className="text-sm text-muted-foreground">Toggle between light and dark themes</p>
                    </div>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={toggleTheme}
                      data-testid="button-toggle-theme"
                    >
                      {isDarkMode ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
                    </Button>
                  </div>
                </CardContent>
              </Card>
          </TabsContent>

          {/* Payment Settings */}
          <TabsContent value="payment" className="space-y-6">
              <Card>
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

              <Card>
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

              <Card>
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
                              placeholder="123 Pickup Street, City, State, ZIP"
                              rows={2}
                            />
                            <Button
                              variant="outline"
                              size="icon"
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
          </TabsContent>

          {/* Invoice Settings */}
          <TabsContent value="invoice" className="space-y-6">
              <Card>
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
              <Card>
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

              <Card>
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

              <Card>
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
          <TabsContent value="users">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  User Management
                </CardTitle>
                <CardDescription>
                  Demo list for UI only — use <strong>User Access</strong> in the nav for real approvals and org access.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="mb-4">
                  <Button className="gap-2" data-testid="button-add-user">
                    <Plus className="h-4 w-4" />
                    Add User
                  </Button>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell className="font-medium">{user.name}</TableCell>
                        <TableCell>{user.email}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="font-mono text-xs uppercase">
                            {user.role}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={user.status === 'active' ? 'default' : 'secondary'}>
                            {user.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                            {user.status === 'pending' && (
                              <Button
                                variant="secondary"
                                size="sm"
                                className="min-h-[40px] w-full sm:w-auto"
                                onClick={() => handleUserAction(user.id, 'approve')}
                                data-testid={`button-approve-${user.id}`}
                              >
                                <UserCheck className="mr-2 h-4 w-4 text-green-600" />
                                Approve
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              className="min-h-[40px] w-full border-amber-600/40 text-amber-800 hover:bg-amber-50 dark:text-amber-200 sm:w-auto"
                              onClick={() => handleUserAction(user.id, 'suspend')}
                              data-testid={`button-suspend-${user.id}`}
                            >
                              <UserX className="mr-2 h-4 w-4" />
                              Suspend
                            </Button>
                            <div className="border-t border-destructive/20 pt-2 sm:border-0 sm:pt-0 sm:pl-2">
                              <Button
                                variant="outline"
                                size="sm"
                                className="min-h-[40px] w-full border-destructive/40 text-destructive hover:bg-destructive/10 sm:w-auto"
                                onClick={() => handleUserAction(user.id, 'delete')}
                                data-testid={`button-delete-user-${user.id}`}
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Remove
                              </Button>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <div className="sticky bottom-0 z-10 mt-8 flex justify-end border-t bg-background/95 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <Button onClick={saveSettings} size="lg" className="min-h-[48px] w-full sm:w-auto" data-testid="button-save-settings">
            Save settings
          </Button>
        </div>
      </div>
    </div>
  )
}