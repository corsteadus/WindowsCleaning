import type {
  InvoiceCreditLine,
  InvoiceCreditNote,
  InvoiceReissue,
  InvoiceVoid,
} from "@workspace/db";

export type InvoiceCreditNoteWithLines = InvoiceCreditNote & {
  lines: InvoiceCreditLine[];
};

export function serializeInvoiceCorrectionHistory(input: {
  voidRecord: InvoiceVoid | null;
  creditNotes: InvoiceCreditNoteWithLines[];
  reissue: InvoiceReissue | null;
  replacementOf: InvoiceReissue | null;
}) {
  return {
    void: input.voidRecord
      ? {
          ...input.voidRecord,
          voidedAt: input.voidRecord.voidedAt.toISOString(),
        }
      : null,
    creditNotes: input.creditNotes.map((note) => ({
      ...note,
      totalAmount: Number(note.totalAmount),
        balanceReductionAmount: Number(note.balanceReductionAmount),
        customerCreditAmount: Number(note.customerCreditAmount),
      createdAt: note.createdAt.toISOString(),
      lines: note.lines.map((line) => ({
        ...line,
        createdAt: line.createdAt.toISOString(),
      })),
    })),
    reissue: input.reissue
      ? { ...input.reissue, createdAt: input.reissue.createdAt.toISOString() }
      : null,
    replacementOf: input.replacementOf
      ? { ...input.replacementOf, createdAt: input.replacementOf.createdAt.toISOString() }
      : null,
  };
}