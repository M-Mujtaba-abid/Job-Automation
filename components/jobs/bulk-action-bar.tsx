"use client";

import { Bookmark, EyeOff, Mail, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function BulkActionBar({
  jobCount,
  emailCount,
  onApplyEmail,
  onSave,
  onHide,
  onClear,
}: {
  jobCount: number;
  emailCount: number;
  onApplyEmail: () => void;
  onSave: () => void;
  onHide: () => void;
  onClear: () => void;
}) {
  if (!jobCount) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur md:left-60">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-4 py-3 md:px-6">
        <div className="mr-auto text-sm">
          <span className="font-semibold tabular-nums">{jobCount}</span> job{jobCount === 1 ? "" : "s"} selected
          <span className="text-muted-foreground"> · </span>
          <span className="font-semibold tabular-nums">{emailCount}</span> unique email{emailCount === 1 ? "" : "s"}
        </div>
        <Button onClick={onApplyEmail} disabled={!emailCount}>
          <Mail /> Apply via Email
        </Button>
        <Button variant="outline" onClick={onSave}>
          <Bookmark /> <span className="hidden sm:inline">Save</span>
        </Button>
        <Button variant="outline" onClick={onHide}>
          <EyeOff /> <span className="hidden sm:inline">Hide</span>
        </Button>
        <Button variant="ghost" onClick={onClear} aria-label="Clear selection">
          <X /> <span className="hidden sm:inline">Clear</span>
        </Button>
      </div>
    </div>
  );
}
