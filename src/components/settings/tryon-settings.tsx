"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/lib/i18n";
import { DEFAULT_TRYON, useSettingsStore } from "@/lib/stores/settings-store";
import type { TryOnRouteId } from "@/lib/tryon/types";

export function TryOnSettings() {
  const t = useT("settings");
  const tryon = useSettingsStore((s) => s.tryon) ?? DEFAULT_TRYON;
  const setTryon = useSettingsStore((s) => s.setTryon);
  const route: TryOnRouteId = tryon.route === "vton" ? "vton" : "compose";

  return (
    <div className="space-y-6">
      <Card className="glass-card">
        <CardContent className="p-5 space-y-4">
          <div>
            <h3 className="font-semibold text-sm">{t("tryonTitle")}</h3>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{t("tryonSubtitle")}</p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t("tryonRouteLabel")}</Label>
            <Select
              value={route}
              onValueChange={(val) => setTryon({ route: val === "vton" ? "vton" : "compose" })}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(value: string) => (value === "vton" ? t("tryonRouteVton") : t("tryonRouteCompose"))}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="compose">{t("tryonRouteCompose")}</SelectItem>
                <SelectItem value="vton">{t("tryonRouteVton")}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {route === "vton" ? t("tryonRouteVtonHint") : t("tryonRouteComposeHint")}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t("tryonFashnKeyLabel")}</Label>
            <Input
              type="password"
              value={tryon.fashnApiKey}
              onChange={(e) => setTryon({ fashnApiKey: e.target.value })}
              placeholder={t("tryonFashnKeyPlaceholder")}
              className="font-mono text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t("tryonFashnBaseUrlLabel")}</Label>
            <Input
              value={tryon.fashnBaseUrl}
              onChange={(e) => setTryon({ fashnBaseUrl: e.target.value })}
              placeholder={t("tryonFashnBaseUrlPlaceholder")}
              className="font-mono text-xs"
            />
          </div>

          <p className="text-[11px] leading-relaxed text-muted-foreground/80">{t("tryonVtonLaterNote")}</p>
        </CardContent>
      </Card>
    </div>
  );
}
