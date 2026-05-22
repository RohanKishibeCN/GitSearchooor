export function tsToIso(tsSec: number): string {
  return new Date(tsSec * 1000).toISOString();
}

export function nowSec(): number {
  return (Date.now() / 1000) | 0;
}

export async function sleepMs(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

