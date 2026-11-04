import { describe, expect, it } from "vitest";
import { extractContacts, extractEmails, extractForms, extractPhones } from "@/legacy/extract/contacts";

const norm = (xs: { normalized: string }[]) => xs.map((x) => x.normalized);

describe("extractEmails", () => {
  it("finds a plain email", () => {
    expect(norm(extractEmails("Send your CV to HR@Acme.pk today"))).toEqual(["hr@acme.pk"]);
  });

  it("handles [at] [dot] obfuscation", () => {
    expect(norm(extractEmails("careers [at] techco [dot] com"))).toEqual(["careers@techco.com"]);
  });

  it("handles (at) obfuscation", () => {
    expect(norm(extractEmails("jobs(at)softhouse.io"))).toEqual(["jobs@softhouse.io"]);
  });

  it("handles spaces around @", () => {
    expect(norm(extractEmails("email: hiring @ devstudio.pk"))).toEqual(["hiring@devstudio.pk"]);
  });

  it("drops trailing sentence punctuation", () => {
    expect(norm(extractEmails("Reach us at talent@brand.co.uk."))).toEqual(["talent@brand.co.uk"]);
  });

  it("ignores junk addresses", () => {
    const text = "noreply@company.org test@example.com logo@2x.png someone@linkedin.com";
    expect(extractEmails(text)).toEqual([]);
  });
});

describe("extractPhones", () => {
  it("normalizes 03XX-XXXXXXX", () => {
    expect(norm(extractPhones("WhatsApp 0300-1234567"))).toEqual(["923001234567"]);
  });

  it("normalizes 03XX XXXXXXX", () => {
    expect(norm(extractPhones("Call 0321 7654321 now"))).toEqual(["923217654321"]);
  });

  it("normalizes +92 3XX XXXXXXX", () => {
    expect(norm(extractPhones("Contact: +92 333 5551234"))).toEqual(["923335551234"]);
  });

  it("normalizes 0092 prefix", () => {
    expect(norm(extractPhones("Phone 00923001234567"))).toEqual(["923001234567"]);
  });

  it("normalizes bare 92 prefix", () => {
    expect(norm(extractPhones("whatsapp: 923451234567"))).toEqual(["923451234567"]);
  });

  it("finds two adjacent numbers", () => {
    expect(norm(extractPhones("0300-1234567 / 0312-7654321")).sort()).toEqual([
      "923001234567",
      "923127654321",
    ]);
  });

  it("reads wa.me links", () => {
    expect(norm(extractPhones("Apply: https://wa.me/923001234567?text=hi"))).toContain("923001234567");
  });

  it("finds international mobiles with +", () => {
    expect(norm(extractPhones("UAE office +971 50 123 4567"))).toEqual(["971501234567"]);
  });

  it("ignores salaries, years and PK landlines", () => {
    expect(extractPhones("Salary 80000-120000, est. 2015-2024, office 042-35761234")).toEqual([]);
  });
});

describe("extractForms", () => {
  it("finds forms.gle links with trailing punctuation", () => {
    expect(extractForms("apply here (https://forms.gle/AbC123xyz).").map((f) => f.value)).toEqual([
      "https://forms.gle/AbC123xyz",
    ]);
  });

  it("finds docs.google.com forms and strips the query for normalization", () => {
    const [f] = extractForms(
      "Form: https://docs.google.com/forms/d/e/1FAIpQLSf_abc/viewform?usp=sf_link, thanks",
    );
    expect(f.value).toBe("https://docs.google.com/forms/d/e/1FAIpQLSf_abc/viewform?usp=sf_link");
    expect(f.normalized).toBe("https://docs.google.com/forms/d/e/1FAIpQLSf_abc/viewform");
  });

  it("ignores other google links", () => {
    expect(extractForms("https://docs.google.com/document/d/xyz")).toEqual([]);
  });
});

describe("extractContacts", () => {
  it("extracts all three types from a typical post and dedupes", () => {
    const post =
      "Hiring React dev! Send CV to hr@acme.pk or WhatsApp 0300-1234567 (+92 300 1234567). Apply: https://forms.gle/abc123";
    const contacts = extractContacts(post);
    expect(contacts.map((c) => `${c.type}:${c.normalized}`).sort()).toEqual([
      "email:hr@acme.pk",
      "google_form:https://forms.gle/abc123",
      "phone:923001234567",
    ]);
  });
});
