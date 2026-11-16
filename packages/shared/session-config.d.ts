// Types for session-config.js, next to this file. Only what the mobile app uses.

export type Choice = { value: string | null; label: string; desc?: string };

export type Field = {
  key: string;
  label?: string;
  type: 'permission' | 'select' | 'boolean' | 'text' | 'textarea';
  default: unknown;
  choices?: Choice[];
  more?: boolean;
  hidden?: boolean;
  /** Read only when a session starts: the resume form leaves it out. */
  newOnly?: boolean;
  placeholder?: string;
  description?: string;
  suggestions?: string[];
};

export const FIELDS: Record<string, Field[]>;
export function fieldsFor(runtime: string): Field[];
export function fieldsBehindMore(runtime: string, values?: Record<string, unknown>): string[];
export function own(object: object | null | undefined, key: string): boolean;
