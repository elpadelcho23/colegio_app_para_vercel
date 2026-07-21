import type { APIRoute } from 'astro';
import { db } from '../../../server/db';

function ensureSubscriptionsTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      tenant_id TEXT PRIMARY KEY,
      plan TEXT NOT NULL DEFAULT 'trial' CHECK (plan IN ('free', 'trial', 'pro')),
      trial_ends_at TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    );
  `);
}

export const GET: APIRoute = ({ locals }) => {
  const user = locals.user;
  if (!user) return Response.json({ error: 'No autenticado' }, { status: 401 });
  ensureSubscriptionsTable();

  const row = db.prepare(`
    SELECT plan, trial_ends_at AS trialEndsAt, updated_at AS updatedAt
    FROM subscriptions
    WHERE tenant_id = ?
  `).get(user.tenant_id) as { plan: string; trialEndsAt: string | null; updatedAt: string } | undefined;

  if (!row) {
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 30);
    const trialEndsAt = trialEnd.toISOString().slice(0, 10);
    db.prepare(`
      INSERT INTO subscriptions (tenant_id, plan, trial_ends_at)
      VALUES (?, 'trial', ?)
    `).run(user.tenant_id, trialEndsAt);
    return Response.json({ plan: 'trial', trialEndsAt, source: 'created' });
  }

  return Response.json({ ...row, source: 'stored' });
};

export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return Response.json({ error: 'No autenticado' }, { status: 401 });
  ensureSubscriptionsTable();

  const body = await request.json().catch(() => ({}));
  const plan = body.plan === 'pro' || body.plan === 'free' || body.plan === 'trial' ? body.plan : null;
  if (!plan) return Response.json({ error: 'Plan inválido' }, { status: 400 });

  let trialEndsAt = body.trialEndsAt || null;
  if (plan === 'trial' && !trialEndsAt) {
    const date = new Date();
    date.setDate(date.getDate() + 30);
    trialEndsAt = date.toISOString().slice(0, 10);
  }
  if (plan === 'pro' || plan === 'free') trialEndsAt = null;

  db.prepare(`
    INSERT INTO subscriptions (tenant_id, plan, trial_ends_at, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(tenant_id) DO UPDATE SET
      plan = excluded.plan,
      trial_ends_at = excluded.trial_ends_at,
      updated_at = CURRENT_TIMESTAMP
  `).run(user.tenant_id, plan, trialEndsAt);

  return Response.json({ plan, trialEndsAt, ok: true });
};
