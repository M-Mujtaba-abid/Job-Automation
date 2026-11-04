import type { Metadata } from "next";
import { JobDetailView } from "@/components/jobs/job-detail-view";

export const metadata: Metadata = { title: "Job" };

export default async function JobDetailPage(props: PageProps<"/jobs/[id]">) {
  const { id } = await props.params;
  return <JobDetailView id={id} />;
}
