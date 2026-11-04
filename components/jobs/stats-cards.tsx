"use client";

import { CalendarPlus, CheckCheck, FileText, Mail, MessageCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { StatsResponse } from "@/lib/types";

const CARDS = [
  { key: "newToday", label: "New (24h)", icon: CalendarPlus, tone: "text-blue-600 dark:text-blue-400" },
  { key: "withEmail", label: "With email", icon: Mail, tone: "text-foreground" },
  { key: "withPhone", label: "With WhatsApp", icon: MessageCircle, tone: "text-whatsapp" },
  { key: "withForm", label: "With form", icon: FileText, tone: "text-purple-600 dark:text-purple-400" },
  { key: "appliedThisWeek", label: "Applied this week", icon: CheckCheck, tone: "text-success" },
] as const;

export function StatsCards({ stats }: { stats: StatsResponse | null }) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {CARDS.map(({ key, label, icon: Icon, tone }) => (
        <Card key={key} className="gap-1 px-4 py-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            {label}
            <Icon className={`size-4 ${tone}`} />
          </div>
          {stats ? (
            <div className="text-2xl font-semibold tabular-nums">{stats[key]}</div>
          ) : (
            <Skeleton className="mt-1 h-7 w-12" />
          )}
        </Card>
      ))}
    </div>
  );
}
