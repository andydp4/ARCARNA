import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LM_CARD } from "@/components/PageHeader";
import { DEVICE_NAME_EVENT, deviceName, setDeviceName } from "@/lib/problemReport";
import { DEVICE_NAMES, UNNAMED_DEVICE, type DeviceName } from "@shared/problemReports";

/**
 * "This device" (v1.2 Phase 8A, UXA-14): name the till, tablet or phone from
 * a fixed list, so Problem? reports and Sentry say which one. Kept on this
 * device only; a typed name is not offered, because it could be a person's.
 */
export function DeviceNameSettings() {
  const [device, setDevice] = useState<DeviceName | null>(() => deviceName());
  useEffect(() => {
    const onChange = () => setDevice(deviceName());
    window.addEventListener(DEVICE_NAME_EVENT, onChange);
    return () => window.removeEventListener(DEVICE_NAME_EVENT, onChange);
  }, []);

  return (
    <Card className={LM_CARD} data-testid="device-name-settings">
      <CardHeader>
        <CardTitle>This device</CardTitle>
        <CardDescription>
          Which till, tablet or phone this is. It goes with Problem? reports and error reports, so an admin knows where
          it happened. Set it once on each device.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Label htmlFor="device-name-select">Device name</Label>
        <Select
          value={device ?? UNNAMED_DEVICE}
          onValueChange={(v) => setDeviceName(v === UNNAMED_DEVICE ? null : (v as DeviceName))}
        >
          <SelectTrigger id="device-name-select" className="min-h-[44px] w-[220px]" data-testid="select-device-name">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNNAMED_DEVICE}>{UNNAMED_DEVICE}</SelectItem>
            {DEVICE_NAMES.map((d) => (
              <SelectItem key={d} value={d}>
                {d}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardContent>
    </Card>
  );
}
