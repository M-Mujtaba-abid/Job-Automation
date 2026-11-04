"use client";

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
  type Updater,
} from "@tanstack/react-table";
import { formatDistanceToNow } from "date-fns";
import { Bookmark, CheckCheck, EyeOff, MapPin, MoreHorizontal, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { JobFilterTab, JobRow } from "@/legacy/types";
import { ContactButtons, type WhatsAppConfig } from "./contact-buttons";

type Status = JobRow["status"];

export function JobsTable({
  rows,
  filter,
  selection,
  onSelectionChange,
  whatsapp,
  onEmailJob,
  onSetStatus,
}: {
  rows: JobRow[];
  filter: JobFilterTab;
  /** jobId → that job's emails (selection survives paging) */
  selection: Map<string, string[]>;
  onSelectionChange: (next: Map<string, string[]>) => void;
  whatsapp: WhatsAppConfig | null;
  onEmailJob: (job: JobRow) => void;
  onSetStatus: (job: JobRow, status: Status) => void;
}) {
  const rowSelection = useMemo<RowSelectionState>(
    () => Object.fromEntries(rows.filter((r) => selection.has(r.id)).map((r) => [r.id, true])),
    [rows, selection],
  );

  function handleSelection(updater: Updater<RowSelectionState>) {
    const nextState = typeof updater === "function" ? updater(rowSelection) : updater;
    const next = new Map(selection);
    for (const row of rows) {
      if (nextState[row.id]) {
        next.set(row.id, row.contacts.filter((c) => c.type === "email").map((c) => c.normalized));
      } else {
        next.delete(row.id);
      }
    }
    onSelectionChange(next);
  }

  const columns = useMemo<ColumnDef<JobRow>[]>(
    () => [
      {
        id: "select",
        header: ({ table }) => (
          <Checkbox
            checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && "indeterminate")}
            onCheckedChange={(v) => table.toggleAllPageRowsSelected(Boolean(v))}
            aria-label="Select all on this page"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            disabled={!row.getCanSelect()}
            onCheckedChange={(v) => row.toggleSelected(Boolean(v))}
            aria-label={`Select ${row.original.title}`}
          />
        ),
      },
      {
        id: "job",
        header: "Job",
        cell: ({ row }) => {
          const j = row.original;
          return (
            <div className="min-w-56 max-w-md">
              <Link href={`/jobs/${j.id}`} className="font-medium hover:underline">
                {j.title}
              </Link>
              <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                {j.company && <span>{j.company}</span>}
                {j.location && (
                  <span className="inline-flex items-center gap-0.5">
                    <MapPin className="size-3" />
                    {j.location}
                  </span>
                )}
                {j.isRemote && <Badge variant="info" className="px-1 py-0">Remote</Badge>}
                {j.employmentType && <span>{j.employmentType}</span>}
                {j.status !== "new" && <StatusBadge status={j.status} />}
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground/90">{j.snippet}</p>
            </div>
          );
        },
      },
      {
        id: "source",
        header: "Source",
        cell: ({ row }) => (
          <span className="text-xs whitespace-nowrap text-muted-foreground">
            {row.original.sourceType === "apify_facebook" ? "Facebook" : row.original.sourceType === "apify_linkedin" ? "LinkedIn" : (row.original.sourceName ?? "—")}
          </span>
        ),
      },
      {
        id: "posted",
        header: "Posted",
        cell: ({ row }) => {
          const d = row.original.postedAt ?? row.original.createdAt;
          return (
            <span className="text-xs whitespace-nowrap text-muted-foreground" title={new Date(d).toLocaleString()}>
              {formatDistanceToNow(new Date(d), { addSuffix: true })}
            </span>
          );
        },
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1">
            <ContactButtons job={row.original} whatsapp={whatsapp} onEmail={() => onEmailJob(row.original)} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon-sm" variant="ghost" aria-label="More actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {row.original.status !== "saved" && (
                  <DropdownMenuItem onSelect={() => onSetStatus(row.original, "saved")}>
                    <Bookmark /> Save
                  </DropdownMenuItem>
                )}
                {row.original.status !== "applied" && (
                  <DropdownMenuItem onSelect={() => onSetStatus(row.original, "applied")}>
                    <CheckCheck /> Mark applied
                  </DropdownMenuItem>
                )}
                {row.original.status !== "hidden" ? (
                  <DropdownMenuItem onSelect={() => onSetStatus(row.original, "hidden")}>
                    <EyeOff /> Hide
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onSelect={() => onSetStatus(row.original, "new")}>
                    <RotateCcw /> Unhide
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ],
    [whatsapp, onEmailJob, onSetStatus],
  );

  // TanStack Table returns non-memoizable functions by design; the React Compiler lint rule
  // flags that, but this component doesn't use the compiler.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: rows,
    columns,
    getRowId: (r) => r.id,
    getCoreRowModel: getCoreRowModel(),
    state: { rowSelection },
    enableRowSelection: (row) => filter !== "email" || row.original.hasEmail,
    onRowSelectionChange: handleSelection,
  });

  return (
    <div className="rounded-xl border">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((hg) => (
            <TableRow key={hg.id}>
              {hg.headers.map((h) => (
                <TableHead key={h.id} className={h.id === "select" ? "w-10 pl-3" : undefined}>
                  {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id} data-state={row.getIsSelected() ? "selected" : undefined}>
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id} className={cell.column.id === "select" ? "pl-3 align-top pt-3" : "align-top"}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function StatusBadge({ status }: { status: Status }) {
  if (status === "applied") return <Badge variant="success" className="px-1 py-0">Applied</Badge>;
  if (status === "saved") return <Badge variant="warning" className="px-1 py-0">Saved</Badge>;
  if (status === "hidden") return <Badge variant="secondary" className="px-1 py-0">Hidden</Badge>;
  return <Badge variant="info" className="px-1 py-0">New</Badge>;
}
