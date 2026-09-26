import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { LM_CARD } from '@/components/PageHeader'
import { useToast } from '@/hooks/use-toast'
import { apiRequest } from '@/lib/queryClient'
import { resolveAppPath } from '@/lib/appPaths'
import {
  EMPTY_SHOP_PRIVACY,
  hasComplaintsContact,
  hasPrivacyNotice,
  shopPrivacyFromOrg,
  type ShopPrivacyInfo,
} from '@shared/shopPrivacy'

/**
 * The shop's customer privacy notice and data protection complaints contact
 * (PRV-15). Admin only (server: PATCH /api/settings is ADMIN+ and logged).
 * Empty by default: the owner writes the wording, and the links on the shop
 * site and receipts stay hidden until something is filled in.
 */
export function ShopPrivacySettings({ orgId }: { orgId?: string | null }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { data } = useQuery<Partial<ShopPrivacyInfo>>({ queryKey: ['/api/settings'] })
  const [form, setForm] = useState<ShopPrivacyInfo>(EMPTY_SHOP_PRIVACY)

  useEffect(() => {
    if (data) setForm(shopPrivacyFromOrg(data))
  }, [data])

  const save = useMutation({
    mutationFn: async () => {
      await apiRequest('PATCH', '/api/settings', form)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/settings'] })
      toast({ title: 'Saved', description: 'Privacy notice and complaints contact updated.' })
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to save', description: error.message, variant: 'destructive' })
    },
  })

  const saved = shopPrivacyFromOrg(data ?? null)
  const previewHref = orgId ? resolveAppPath(`/privacy?orgId=${encodeURIComponent(orgId)}`) : null

  return (
    <Card className={LM_CARD} data-testid="card-shop-privacy">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" />
          Customer privacy notice and complaints contact
        </CardTitle>
        <CardDescription>
          What your customers are told about how you use their details, and who they contact with a
          data protection question or complaint. Shown on the shop site and on receipts only once filled
          in. You write the wording.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="privacyNoticeUrl">Privacy notice web address (optional)</Label>
          <Input
            id="privacyNoticeUrl"
            type="url"
            value={form.privacyNoticeUrl}
            onChange={(e) => setForm((f) => ({ ...f, privacyNoticeUrl: e.target.value }))}
            placeholder="https://www.example.com/privacy"
            data-testid="input-privacy-notice-url"
          />
          <p className="text-xs text-muted-foreground">
            If you have your own page, put its address here. Otherwise write the notice below and arcarna
            shows it on a page of its own.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="privacyNoticeText">Privacy notice text (optional)</Label>
          <Textarea
            id="privacyNoticeText"
            value={form.privacyNoticeText}
            onChange={(e) => setForm((f) => ({ ...f, privacyNoticeText: e.target.value }))}
            rows={8}
            data-testid="input-privacy-notice-text"
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="complaintsContactName">Complaints contact name</Label>
            <Input
              id="complaintsContactName"
              value={form.complaintsContactName}
              onChange={(e) => setForm((f) => ({ ...f, complaintsContactName: e.target.value }))}
              data-testid="input-complaints-name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="complaintsContactEmail">Complaints contact email</Label>
            <Input
              id="complaintsContactEmail"
              type="email"
              value={form.complaintsContactEmail}
              onChange={(e) => setForm((f) => ({ ...f, complaintsContactEmail: e.target.value }))}
              data-testid="input-complaints-email"
            />
          </div>
        </div>
        <p className="text-sm text-muted-foreground" data-testid="text-privacy-status">
          {hasPrivacyNotice(saved) ? 'Privacy notice: shown to customers.' : 'Privacy notice: not set, so no link is shown.'}{' '}
          {hasComplaintsContact(saved)
            ? 'Complaints contact: shown to customers.'
            : 'Complaints contact: not set (needs an email), so it is not shown.'}
          {previewHref && hasPrivacyNotice(saved) && (
            <>
              {' '}
              <a className="underline" href={previewHref} target="_blank" rel="noreferrer">
                See what customers see
              </a>
            </>
          )}
        </p>
        <Button onClick={() => save.mutate()} disabled={save.isPending} data-testid="button-save-privacy">
          {save.isPending ? 'Saving…' : 'Save privacy details'}
        </Button>
      </CardContent>
    </Card>
  )
}
