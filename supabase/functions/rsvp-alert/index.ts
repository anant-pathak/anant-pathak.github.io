// Emails the owners whenever someone RSVPs or changes their RSVP.
//
// Triggered by a Supabase Database Webhook on public.rsvps (INSERT and UPDATE).
// RSVPs are keyed by email, so a guest changing their answer is an UPDATE and
// the email shows what it was before. Sends through Gmail SMTP with an app
// password via Nodemailer, so no third-party email service is needed.
// (Nodemailer replaced denomailer, whose header/quoted-printable encoding broke
// emails with long emoji subjects and leaked "=20" into bodies.)
//
// Secrets (Edge Functions -> Secrets):
//   GMAIL_USER          the Gmail address that sends the alerts
//   GMAIL_APP_PASSWORD  16-character Google app password for that account
//   ALERT_TO            comma-separated recipients, e.g. "a@gmail.com, b@gmail.com"
//   WEBHOOK_SECRET      any long random string; the webhook sends it in the
//                       x-webhook-secret header so nobody else can trigger emails

import nodemailer from "npm:nodemailer@6.9.16";

type Rsvp = {
  name: string;
  response: "attending" | "maybe" | "declined";
  guest_count: number;
  comment: string | null;
  email: string;
  created_at: string;
  updated_at?: string;
};

const RESPONSES = {
  attending: { label: "Definitely attending", emoji: "🎉" },
  maybe: { label: "Will confirm later", emoji: "🤔" },
  declined: { label: "Sorry, can't make it", emoji: "💌" },
};

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

type Tally = Record<Rsvp["response"], { rsvps: number; guests: number }>;

// Running totals across every RSVP. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
// are provided to every Edge Function automatically. Returns null on failure so
// the alert still goes out without the summary.
async function getTally(): Promise<Tally | null> {
  try {
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/rsvps?select=response,guest_count`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const rows: Pick<Rsvp, "response" | "guest_count">[] = await res.json();
    const tally: Tally = {
      attending: { rsvps: 0, guests: 0 },
      maybe: { rsvps: 0, guests: 0 },
      declined: { rsvps: 0, guests: 0 },
    };
    for (const r of rows) {
      if (!tally[r.response]) continue;
      tally[r.response].rsvps += 1;
      tally[r.response].guests += r.guest_count;
    }
    return tally;
  } catch (error) {
    console.error("Failed to load RSVP totals:", error);
    return null;
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const row = (label: string, value: string) =>
  `<tr><td style="padding:6px 14px 6px 0;color:#9a7c83;white-space:nowrap;vertical-align:top">${label}</td>` +
  `<td style="padding:6px 0;color:#4a3439">${value}</td></tr>`;

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  if (req.headers.get("x-webhook-secret") !== Deno.env.get("WEBHOOK_SECRET")) {
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = await req.json().catch(() => null);
  const rsvp: Rsvp | undefined = payload?.record;
  const isUpdate = payload?.type === "UPDATE";
  if (!["INSERT", "UPDATE"].includes(payload?.type) || payload?.table !== "rsvps" || !rsvp) {
    return new Response("Ignored", { status: 200 });
  }
  const before: Rsvp | null = isUpdate ? payload.old_record ?? null : null;

  const gmailUser = Deno.env.get("GMAIL_USER")!;
  const recipients = (Deno.env.get("ALERT_TO") ?? "")
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean);
  if (!recipients.length) return new Response("ALERT_TO is not set", { status: 500 });

  const { label, emoji } = RESPONSES[rsvp.response] ?? { label: rsvp.response, emoji: "📬" };
  const guests = rsvp.response === "declined" ? "" : ` (${plural(rsvp.guest_count, "guest")})`;
  const subject = `${emoji} ${isUpdate ? "Updated RSVP" : "RSVP"}: ${rsvp.name} - ${label}${guests}`;
  const when = new Date(rsvp.updated_at ?? rsvp.created_at).toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    dateStyle: "medium",
    timeStyle: "short",
  });

  // "Was: 🤔 Will confirm later · 2 guests" for changed RSVPs
  const previous = before
    ? `${RESPONSES[before.response]?.emoji ?? ""} ${RESPONSES[before.response]?.label ?? before.response}` +
      (before.response === "declined" ? "" : ` · ${plural(before.guest_count, "guest")}`)
    : "";

  const tally = await getTally();
  const summaryLines = tally
    ? [
        `🎉 Definitely coming: ${plural(tally.attending.rsvps, "RSVP")} · ${plural(tally.attending.guests, "guest")}`,
        `🤔 Maybe: ${plural(tally.maybe.rsvps, "RSVP")} · ${plural(tally.maybe.guests, "guest")}`,
        `💌 Can't make it: ${plural(tally.declined.rsvps, "RSVP")}`,
      ]
    : [];
  const summaryHtml = tally
    ? `
      <div style="margin:20px 0 0;padding:16px 18px;background:#fffdfb;border:1px solid #f1d3d9;border-radius:12px;font-family:Arial,sans-serif">
        <p style="margin:0 0 10px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#c96478">Totals so far</p>
        ${summaryLines.map((line) => `<p style="margin:0 0 6px;font-size:15px;color:#4a3439">${line}</p>`).join("")}
        <p style="margin:10px 0 0;font-size:15px;color:#4a3439"><strong>Expected headcount: ${tally.attending.guests}</strong>${
          tally.maybe.guests ? ` <span style="color:#9a7c83">(up to ${tally.attending.guests + tally.maybe.guests} with maybes)</span>` : ""
        }</p>
      </div>`
    : "";

  const html = `
    <div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;padding:24px;background:#fbf3ea;border-radius:16px">
      <h2 style="margin:0 0 4px;font-style:italic;font-weight:400;color:#c96478">${emoji} ${isUpdate ? "Updated" : "New"} baby shower RSVP</h2>
      <p style="margin:0 0 18px;color:#9a7c83;font-size:14px">${escapeHtml(when)} Pacific</p>
      <table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:15px">
        ${row("Name", `<strong>${escapeHtml(rsvp.name)}</strong>`)}
        ${row("Response", escapeHtml(label))}
        ${previous ? row("Was", `<span style="color:#9a7c83">${escapeHtml(previous)}</span>`) : ""}
        ${row("Total guests", rsvp.response === "declined" ? "—" : String(rsvp.guest_count))}
        ${row("Comment", rsvp.comment ? escapeHtml(rsvp.comment).replace(/\n/g, "<br>") : "<em style='color:#b9a4a9'>none</em>")}
        ${row("Email", `<a href="mailto:${escapeHtml(rsvp.email)}" style="color:#c96478">${escapeHtml(rsvp.email)}</a>`)}
      </table>
      ${summaryHtml}
    </div>`
    // Drop the template's indentation and line breaks; keeps the HTML compact.
    .replace(/\n\s*/g, "");

  const text =
    `${isUpdate ? "Updated" : "New"} baby shower RSVP (${when} Pacific)\n\n` +
    `Name: ${rsvp.name}\nResponse: ${label}\n` +
    (previous ? `Was: ${previous}\n` : "") +
    (rsvp.response === "declined" ? "" : `Total guests: ${rsvp.guest_count}\n`) +
    `Comment: ${rsvp.comment ?? "none"}\nEmail: ${rsvp.email}\n` +
    (tally
      ? `\nTotals so far\n${summaryLines.join("\n")}\nExpected headcount: ${tally.attending.guests}` +
        (tally.maybe.guests ? ` (up to ${tally.attending.guests + tally.maybe.guests} with maybes)` : "") +
        "\n"
      : "");

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: gmailUser, pass: Deno.env.get("GMAIL_APP_PASSWORD")! },
  });

  try {
    await transporter.sendMail({
      from: { name: "Baby Shower RSVPs", address: gmailUser },
      to: recipients,
      replyTo: rsvp.email,
      subject,
      text,
      html,
    });
  } catch (error) {
    console.error("Failed to send RSVP alert:", error);
    return new Response("Email failed", { status: 500 });
  }

  return new Response("Sent", { status: 200 });
});
