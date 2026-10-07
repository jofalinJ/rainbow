import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" }
  });

function normalizeWhatsAppNumber(input: string) {
  const digits = String(input || "").replace(/\D/g, "");
  if (digits.length === 10) return "91" + digits;
  if (digits.length >= 8 && digits.length <= 15) return digits;
  return "";
}

function decodeBase64Pdf(value: string) {
  const cleaned = String(value || "")
    .replace(/^data:application\/pdf;base64,/i, "")
    .replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned)) throw new Error("Invalid PDF payload.");
  if (cleaned.length === 0 || cleaned.length > 14_000_000) throw new Error("PDF payload is too large.");
  const binary = atob(cleaned);
  if (binary.length === 0 || binary.length > 10_000_000) throw new Error("PDF file is too large.");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: "application/pdf" });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authorization = req.headers.get("Authorization");
    if (!authorization) return json({ error: "Unauthorized" }, 401);

    const serviceKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
      (() => {
        try {
          return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default;
        } catch {
          return undefined;
        }
      })();

    if (!serviceKey) return json({ error: "Supabase server key is not configured." }, 500);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
    const token = authorization.replace(/^Bearer\s+/i, "");
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const { data: profile, error: profileError } = await admin
      .from("staff_profiles")
      .select("role,active")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profileError) return json({ error: "Could not verify staff access." }, 500);
    if (!profile?.active || !["admin", "cashier"].includes(profile.role)) {
      return json({ error: "Billing access required." }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const invoiceToken = String(body.invoice_token || "").trim();
    const filename = String(body.filename || "").trim().replace(/[^A-Za-z0-9._-]/g, "_") || "invoice.pdf";

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(invoiceToken)) {
      return json({ error: "Invalid bill token." }, 400);
    }

    const pdf = decodeBase64Pdf(String(body.pdf_base64 || ""));

    const { data: invoice, error: invoiceError } = await admin
      .from("invoices")
      .select("invoice_number,public_token,order_id,orders!inner(order_number,status,source,customers(name,whatsapp_number))")
      .eq("public_token", invoiceToken)
      .eq("orders.source", "local_store")
      .maybeSingle();

    if (invoiceError) return json({ error: "Could not find the bill." }, 500);
    if (!invoice || !invoice.orders || ["cancelled", "refunded"].includes(invoice.orders.status)) {
      return json({ error: "Bill is not available for WhatsApp sending." }, 404);
    }

    const customer = Array.isArray(invoice.orders.customers)
      ? invoice.orders.customers[0]
      : invoice.orders.customers;

    const to = normalizeWhatsAppNumber(customer?.whatsapp_number || "");
    if (!to) return json({ error: "This bill does not have a valid customer WhatsApp number." }, 400);

    const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
    const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
    const graphVersion = Deno.env.get("WHATSAPP_GRAPH_VERSION");

    if (!accessToken || !phoneNumberId || !graphVersion) {
      return json({
        error: "WhatsApp Business API is not configured. Add WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_GRAPH_VERSION to Supabase Edge Function secrets."
      }, 503);
    }

    const invoiceUrl =
      Deno.env.get("APP_PUBLIC_URL")
        ? Deno.env.get("APP_PUBLIC_URL")!.replace(/\/$/, "") + "/invoice.html?token=" + encodeURIComponent(invoiceToken)
        : null;

    const { data: notification, error: notificationError } = await admin
      .from("whatsapp_notifications")
      .insert({
        order_id: invoice.order_id,
        recipient_number: to,
        notification_type: "bill_pdf",
        message_template: "JJ GOLD COVERING invoice " + invoice.invoice_number,
        invoice_url: invoiceUrl,
        status: "pending"
      })
      .select("id")
      .single();

    if (notificationError) return json({ error: "Could not create WhatsApp delivery record." }, 500);

    const graphBase = "https://graph.facebook.com/" + graphVersion;
    const mediaForm = new FormData();
    mediaForm.append("messaging_product", "whatsapp");
    mediaForm.append("file", pdf, filename);

    const mediaResponse = await fetch(graphBase + "/" + encodeURIComponent(phoneNumberId) + "/media", {
      method: "POST",
      headers: { Authorization: "Bearer " + accessToken },
      body: mediaForm
    });

    const mediaBody = await mediaResponse.json().catch(() => ({}));
    if (!mediaResponse.ok || !mediaBody.id) {
      await admin.from("whatsapp_notifications").update({
        status: "failed",
        error_message: JSON.stringify(mediaBody).slice(0, 1000)
      }).eq("id", notification.id);
      return json({ error: "WhatsApp media upload failed." }, 502);
    }

    const caption = "JJ GOLD COVERING\nInvoice: " + invoice.invoice_number + "\nOrder: " + invoice.orders.order_number;

    const sendResponse = await fetch(graphBase + "/" + encodeURIComponent(phoneNumberId) + "/messages", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + accessToken,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "document",
        document: {
          id: mediaBody.id,
          caption,
          filename
        }
      })
    });

    const sendBody = await sendResponse.json().catch(() => ({}));
    if (!sendResponse.ok) {
      await admin.from("whatsapp_notifications").update({
        status: "failed",
        error_message: JSON.stringify(sendBody).slice(0, 1000)
      }).eq("id", notification.id);
      return json({ error: "WhatsApp message could not be sent." }, 502);
    }

    const providerMessageId =
      sendBody?.messages?.[0]?.id ||
      sendBody?.message_id ||
      null;

    await admin.from("whatsapp_notifications").update({
      status: "sent",
      provider_message_id: providerMessageId,
      sent_at: new Date().toISOString()
    }).eq("id", notification.id);

    return json({
      success: true,
      invoice_number: invoice.invoice_number,
      recipient_number: to
    });
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : "Could not send WhatsApp bill."
    }, 500);
  }
});
