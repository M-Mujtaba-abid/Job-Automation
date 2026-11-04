import type { Metadata } from "next";
import { TemplatesView } from "@/components/templates/templates-view";

export const metadata: Metadata = { title: "Email templates" };

export default function TemplatesPage() {
  return <TemplatesView />;
}
