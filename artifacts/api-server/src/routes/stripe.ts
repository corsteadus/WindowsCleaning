import { Router, type IRouter, type Request, type Response } from "express";
import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db, invoicesTable } from "@workspace/db";
import { enqueueCommunicationEvent } from "../lib/communication-outbox.js";
import { businessDateStr } from "../lib/date.ts";

const router: IRouter = Router();

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  return new Stripe(key, { apiVersion: "2026-03-25.dahlia" });
}

// ─── Generate / retrieve payment link ─────────────────────────────────────────

router.post("/invoices/:id/generate-payment-link", async (req: Request, res: Response): Promise<void> => {
  try {
    const invoiceId = parseInt(String(req.params.id), 10);
    const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId));

    if (!invoice) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }
    if (invoice.status === "paid") {
      res.status(400).json({ error: "Invoice is already paid — cannot generate a payment link." });
      return;
    }

    // If a link already exists and regenerate is not requested, return it
    if (invoice.stripePaymentLink && req.query.regenerate !== "true") {
      res.json({
        paymentLink: invoice.stripePaymentLink,
        paymentLinkId: invoice.stripePaymentLinkId,
        alreadyExisted: true,
      });
      return;
    }

    const stripe = getStripe();
    const totalCents = Math.round(Number(invoice.totalAmount) * 100);

    if (totalCents <= 0) {
      res.status(400).json({ error: "Invoice total must be greater than zero." });
      return;
    }

    // Create a one-time price
    const price = await stripe.prices.create({
      unit_amount: totalCents,
      currency: "usd",
      product_data: {
        name: `Invoice ${invoice.invoiceNumber}`,
      },
    });

    // Create the payment link with metadata pointing back to this invoice
    const paymentLink = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
      metadata: {
        invoiceId: invoiceId.toString(),
        customerId: invoice.customerId.toString(),
        invoiceNumber: invoice.invoiceNumber,
      },
      after_completion: {
        type: "hosted_confirmation",
        hosted_confirmation: {
          custom_message: `Thank you! Invoice ${invoice.invoiceNumber} has been paid.`,
        },
      },
    });

    // Persist link to invoice record
    await db
      .update(invoicesTable)
      .set({
        stripePaymentLink: paymentLink.url,
        stripePaymentLinkId: paymentLink.id,
      })
      .where(eq(invoicesTable.id, invoiceId));

    res.json({
      paymentLink: paymentLink.url,
      paymentLinkId: paymentLink.id,
      alreadyExisted: false,
    });
  } catch (err) {
    console.error("Stripe payment link error:", err);
    const msg = err instanceof Error ? err.message : "Failed to generate payment link";
    res.status(500).json({ error: msg });
  }
});

// ─── Stripe webhook ────────────────────────────────────────────────────────────
// NOTE: This route receives raw body (configured in app.ts before express.json())

router.post("/stripe/webhook", async (req: Request, res: Response): Promise<void> => {
  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error("STRIPE_WEBHOOK_SECRET is not set — cannot verify webhook");
    res.status(500).json({ error: "Webhook secret not configured" });
    return;
  }

  let event: Stripe.Event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(req.body as Buffer, sig as string, webhookSecret);
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    res.status(400).json({ error: "Invalid webhook signature" });
    return;
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;

      if (session.payment_status === "paid") {
        const invoiceId = session.metadata?.invoiceId
          ? parseInt(session.metadata.invoiceId, 10)
          : null;

        if (invoiceId) {
          await db.transaction(async (tx) => {
            const [invoice] = await tx.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
            if (!invoice || invoice.status === "paid") return;
            const [paidInvoice] = await tx.update(invoicesTable).set({
              status: "paid",
              paidAt: new Date().toISOString(),
              amountPaid: invoice.totalAmount,
              balanceDue: "0",
            }).where(eq(invoicesTable.id, invoiceId)).returning();
            if (!paidInvoice) return;
            await enqueueCommunicationEvent(tx, {
              eventType: "payment.received",
              aggregateType: "invoice",
              aggregateId: paidInvoice.id,
              payload: {
                customerId: paidInvoice.customerId,
                invoiceId: paidInvoice.id,
                paymentId: null,
                amount: paidInvoice.totalAmount,
                paymentDate: businessDateStr(),
              },
              source: "stripe.webhook",
              causationKey: event.id,
              dedupeKey: `payment.received:stripe:${event.id}`,
            });
            console.log(`Invoice ${invoiceId} marked paid via Stripe webhook`);
          });
        }
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error("Webhook processing error:", err);
    res.status(500).json({ error: "Webhook processing failed" });
  }
});

export default router;
