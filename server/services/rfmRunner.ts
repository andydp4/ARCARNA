let lastRfmRunDate: string | null = null;

/** Run RFM recompute once per calendar day (nightly-style tick). */
export async function processRfmNightly(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  if (lastRfmRunDate === today) return;

  const hour = new Date().getHours();
  if (hour !== 3) return;

  lastRfmRunDate = today;
  const { recomputeAllOrgsRfm } = await import("../lib/rfmService");
  await recomputeAllOrgsRfm();
}
