"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Integration } from "@/lib/integrations/types";
import {
  deleteIntegration,
  saveIntegration,
  testIntegration,
} from "@/app/(app)/integrations/actions";
import { IntegrationDialog } from "./integration-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { FlaskConical, Pencil, Plug, Plus, Trash2 } from "lucide-react";

export function IntegrationsView({
  initial,
  storeName,
}: {
  initial: Integration[];
  storeName: string;
}) {
  const router = useRouter();
  const [testing, setTesting] = useState<string | null>(null);
  const [, startToggle] = useTransition();

  function refresh() {
    router.refresh();
  }

  function toggle(integ: Integration, enabled: boolean) {
    startToggle(async () => {
      const res = await saveIntegration({
        name: integ.name,
        description: integ.description,
        endpoint_url: integ.endpoint_url,
        params_schema: integ.params_schema,
        side_effect: integ.side_effect,
        timeout_ms: integ.timeout_ms,
        enabled,
        // secret omitted -> kept
      });
      if (res.ok) refresh();
      else toast.error("Couldn't update", { description: res.error });
    });
  }

  async function runTest(name: string) {
    setTesting(name);
    const res = await testIntegration(name, {});
    setTesting(null);
    if (res.ok) {
      toast.success(`${name} responded`, {
        description: JSON.stringify(res.result).slice(0, 300),
      });
    } else {
      toast.error(`${name} test failed`, { description: res.error });
    }
  }

  async function remove(name: string) {
    const res = await deleteIntegration(name);
    if (res.ok) {
      toast.success("Integration removed");
      refresh();
    } else {
      toast.error("Couldn't remove", { description: res.error });
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Plug className="text-muted-foreground size-5" />
          <div>
            <h1 className="font-display text-2xl italic">Integrations</h1>
            <p className="text-muted-foreground text-sm">{storeName}</p>
          </div>
        </div>
        <IntegrationDialog
          onSaved={refresh}
          trigger={
            <Button size="sm">
              <Plus className="size-4" /> Add integration
            </Button>
          }
        />
      </header>

      <p className="text-muted-foreground text-sm">
        Connect Rani to your own systems — a POS for live prices, a booking system, anything with an
        HTTP endpoint. Rani decides on its own when to call each one, based on the description you
        write. No coding on our side.
      </p>

      {initial.length === 0 ? (
        <div className="bg-card text-muted-foreground flex flex-col items-center gap-2 rounded-lg border border-dashed py-16 text-center">
          <Plug className="size-6" />
          <p className="text-sm font-medium">No integrations yet</p>
          <p className="max-w-sm text-sm">
            Add one to give Rani a new ability — for example a live price lookup from your POS.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3">
          {initial.map((integ) => (
            <li key={integ.id} className="bg-card rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="bg-muted rounded px-1.5 py-0.5 text-xs font-medium">{integ.name}</code>
                    {integ.side_effect && (
                      <Badge variant="outline" className="border-amber-400/60 text-amber-600">action</Badge>
                    )}
                    {!integ.enabled && <Badge variant="outline" className="text-muted-foreground">off</Badge>}
                  </div>
                  <p className="text-muted-foreground line-clamp-2 text-sm">{integ.description}</p>
                  <p className="text-muted-foreground truncate text-xs">
                    {hostOf(integ.endpoint_url)} · {Object.keys(integ.params_schema?.properties ?? {}).length} param(s)
                    {integ.has_secret ? " · signed" : " · unsigned"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Switch
                    checked={integ.enabled}
                    onCheckedChange={(v) => toggle(integ, v)}
                    aria-label="Enabled"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground size-8"
                    aria-label="Test"
                    disabled={testing === integ.name}
                    onClick={() => runTest(integ.name)}
                  >
                    <FlaskConical className="size-4" />
                  </Button>
                  <IntegrationDialog
                    initial={integ}
                    onSaved={refresh}
                    trigger={
                      <Button variant="ghost" size="icon" className="text-muted-foreground size-8" aria-label="Edit">
                        <Pencil className="size-4" />
                      </Button>
                    }
                  />
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive size-8"
                        aria-label="Delete"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remove this integration?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Rani will no longer be able to call “{integ.name}”.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Keep</AlertDialogCancel>
                        <AlertDialogAction onClick={() => remove(integ.name)}>Remove</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
