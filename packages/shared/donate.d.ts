// Types for donate.js, next to this file.

export type DonateState = { usageMs: number; showAtMs: number; donated: boolean };

export const DONATE_AMOUNTS: readonly string[];
export const DONATE_DEFAULT_AMOUNT: string;
export const DONATE_CURRENCY: string;
export const DONATE_EVERY_MS: number;
export const DONATE_MAX_STEP_MS: number;
export function donateUrl(amount: string): string;
export function donateLabel(amount: string): string;
export function donateState(saved: unknown): DonateState;
export function donateBoxDue(state: unknown): boolean;
export function addDonateUsage(state: unknown, ms: number): DonateState;
export function closeDonateBox(state: unknown): DonateState;
export function markDonated(state: unknown): DonateState;
