'use server';

import { createCollector, revokeCollector } from '@undercut/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';

export type AddDeviceState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  /** The plaintext token exists only in this response; the server keeps a hash. */
  | { status: 'created'; name: string; token: string };

const nameSchema = z.string().trim().min(1, 'Name the device, like “Home PC”.').max(80, 'Keep the name under 80 characters.');

export async function addLocalCollectorAction(_prev: AddDeviceState, form: FormData): Promise<AddDeviceState> {
  const name = nameSchema.safeParse(String(form.get('name') ?? ''));
  if (!name.success) return { status: 'error', message: name.error.issues[0]?.message ?? 'Invalid name.' };
  const { collector, token } = await createCollector(db(), { kind: 'local', name: name.data });
  revalidatePath('/devices');
  return { status: 'created', name: collector.name, token };
}

export async function revokeCollectorAction(id: string): Promise<void> {
  await revokeCollector(db(), id);
  revalidatePath('/devices');
}
