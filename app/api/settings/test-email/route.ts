import { ApiError, route } from "@/lib/api";
import { getTemplate } from "@/lib/applications";
import { getCv } from "@/lib/cv";
import { env } from "@/lib/env";
import { sendMail } from "@/lib/mail";
import { getSettings } from "@/lib/settings";
import { profileVars, renderTemplate } from "@/lib/template";

/** Sends the default template (with sample job data) to the user's own address. */
export const POST = route(async () => {
  const [profile, template] = await Promise.all([getSettings(), getTemplate()]);
  const cv = template?.attachCv ? await getCv() : null;
  const to = profile.email || env().SMTP_USER;
  if (!to) throw new ApiError(400, "Set your email in Settings first");

  const vars = { ...profileVars(profile), job_title: "React Developer", company: "Sample Company", location: "Lahore" };
  const subject = template ? renderTemplate(template.subject, vars) : "Test email from Job Automation";
  const body = template
    ? renderTemplate(template.body, vars)
    : "SMTP is configured correctly. Create an email template to see a real preview.";

  const messageId = await sendMail({
    to,
    subject: `[TEST] ${subject}`,
    body,
    cv: cv ? { fileName: cv.fileName, data: cv.data } : null,
  });
  return { ok: true, to, messageId };
});
