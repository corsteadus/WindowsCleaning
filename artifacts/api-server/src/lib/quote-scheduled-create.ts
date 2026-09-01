export interface ScheduledQuoteCommitAdapter<Quote, Appointment> {
  validateReferences(): Promise<void>;
  createQuote(): Promise<Quote>;
  createAppointment(quote: Quote): Promise<Appointment>;
  createLocations(quote: Quote): Promise<void>;
  createActivity(quote: Quote): Promise<void>;
  enqueueEvent(quote: Quote): Promise<void>;
  completeIdempotency(quote: Quote): Promise<void>;
}

export async function persistScheduledQuoteCore<Quote, Appointment>(
  adapter: ScheduledQuoteCommitAdapter<Quote, Appointment>,
): Promise<{ quote: Quote; appointment: Appointment }> {
  await adapter.validateReferences();
  const quote = await adapter.createQuote();
  const appointment = await adapter.createAppointment(quote);
  await adapter.createLocations(quote);
  await adapter.createActivity(quote);
  await adapter.enqueueEvent(quote);
  await adapter.completeIdempotency(quote);
  return { quote, appointment };
}