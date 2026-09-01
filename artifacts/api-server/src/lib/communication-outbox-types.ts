import { db } from "@workspace/db";

export type CommunicationTx = Parameters<Parameters<typeof db.transaction>[0]>[0];