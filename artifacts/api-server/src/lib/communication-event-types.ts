export type CommunicationEventType =
  | "quote.sent"
  | "quote.accepted"
  | "appointment.scheduled"
  | "appointment.changed"
  | "job.completed"
  | "invoice.sent"
  | "payment.received"
  | "recurring_plan.due";

export type CommunicationEventStatus =
  | "pending"
  | "processing"
  | "succeeded"
  | "retrying"
  | "dead_letter";