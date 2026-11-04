import type { Metadata } from "next";
import { RunsView } from "@/components/runs/runs-view";

export const metadata: Metadata = { title: "Fetch runs" };

export default function RunsPage() {
  return <RunsView />;
}
