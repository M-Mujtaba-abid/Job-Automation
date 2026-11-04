"use client";

import { FileText, Inbox, Mail, MessageCircle, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { JobFilterTab, JobsResponse } from "@/lib/types";

export type FilterState = {
  filter: JobFilterTab;
  q: string;
  sourceId: string;
  status: string;
  from: string;
  to: string;
  hideApplied: boolean;
  page: number;
};

const TABS: { value: JobFilterTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: "all", label: "All", icon: Inbox },
  { value: "email", label: "Email", icon: Mail },
  { value: "phone", label: "WhatsApp", icon: MessageCircle },
  { value: "form", label: "Google Form", icon: FileText },
];

export function JobFilters({
  state,
  counts,
  sources,
  onChange,
}: {
  state: FilterState;
  counts: JobsResponse["counts"] | null;
  sources: { id: string; name: string }[];
  onChange: (patch: Partial<FilterState>) => void;
}) {
  const [q, setQ] = useState(state.q);

  // Debounce search → URL.
  useEffect(() => {
    if (q === state.q) return;
    const t = setTimeout(() => onChange({ q, page: 1 }), 350);
    return () => clearTimeout(t);
  }, [q, state.q, onChange]);

  return (
    <div className="mb-4 grid gap-3">
      <Tabs value={state.filter} onValueChange={(v) => onChange({ filter: v as JobFilterTab, page: 1 })}>
        <TabsList className="h-auto w-full flex-wrap justify-start sm:w-fit">
          {TABS.map(({ value, label, icon: Icon }) => (
            <TabsTrigger key={value} value={value} className="flex-none px-3">
              <Icon />
              {label}
              <span className="rounded bg-muted-foreground/10 px-1.5 text-xs tabular-nums">{counts ? counts[value] : "–"}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search title, company, description…"
            className="pl-8"
            aria-label="Search jobs"
          />
        </div>
        <Select value={state.sourceId || "all"} onValueChange={(v) => onChange({ sourceId: v === "all" ? "" : v, page: 1 })}>
          <SelectTrigger className="w-44" aria-label="Source">
            <SelectValue placeholder="All sources" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            {sources.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={state.status || "active"} onValueChange={(v) => onChange({ status: v === "active" ? "" : v, page: 1 })}>
          <SelectTrigger className="w-32" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="new">New</SelectItem>
            <SelectItem value="saved">Saved</SelectItem>
            <SelectItem value="applied">Applied</SelectItem>
            <SelectItem value="hidden">Hidden</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1">
          <Input
            type="date"
            value={state.from}
            onChange={(e) => onChange({ from: e.target.value, page: 1 })}
            className="w-36"
            aria-label="From date"
          />
          <span className="text-muted-foreground">–</span>
          <Input
            type="date"
            value={state.to}
            onChange={(e) => onChange({ to: e.target.value, page: 1 })}
            className="w-36"
            aria-label="To date"
          />
        </div>
        {!state.status && (
          <Label className="ml-auto gap-2 font-normal">
            <Switch checked={state.hideApplied} onCheckedChange={(v) => onChange({ hideApplied: v, page: 1 })} />
            Hide applied
          </Label>
        )}
      </div>
    </div>
  );
}
