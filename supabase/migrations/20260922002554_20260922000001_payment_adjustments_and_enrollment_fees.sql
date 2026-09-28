/*
# Payment Adjustments: Discounts, Exemptions & Enrollment Fee Tracking

## Summary
Enhances the existing payment system to support:
- Enrollment fees tracked separately from monthly installments
- Discounts (réductions) with percentage or fixed amount, and reason
- Exemptions (exonérations) total or partial, with reason
- Automatic calculation of effective amount due, amount paid, and remaining balance

This migration is purely additive — no existing tables, columns, triggers, or policies are modified or removed.

## New Tables (1 table)

### payment_adjustments
Tracks all discounts and exemptions applied to a student's payment plan.
- `id` (uuid, PK)
- `institution_id` (FK institutions) — institution scope
- `payment_plan_id` (FK payment_plans) — which plan this adjustment applies to
- `student_id` (FK students) — student reference
- `academic_year_id` (FK academic_years) — year scope
- `adjustment_type` (text: 'discount' | 'exemption') — discount = reduction, exemption = full/partial waiver
- `scope` (text: 'enrollment_fee' | 'tuition' | 'total') — what the adjustment applies to
- `amount_type` (text: 'percentage' | 'fixed_amount') — how the amount is expressed
- `amount` (numeric) — percentage (0-100) or fixed amount in currency
- `reason` (text) — why the adjustment was granted
- `status` (text: 'active' | 'cancelled') — active adjustments are applied; cancelled are kept for history
- `created_by` (FK auth.users) — who created the adjustment
- `cancelled_by` (FK auth.users, nullable) — who cancelled it
- `cancelled_at` (timestamptz, nullable) — when it was cancelled
- timestamps

## Modified Tables

### installments
- Added `installment_type` column (text, default 'custom', CHECK in enrollment/monthly/custom)
  This lets the UI distinguish enrollment fee installments from monthly installments.
  Existing installments default to 'custom' — no behavior change.

### payment_plans
- Added `enrollment_fee` column (numeric, default 0) — the enrollment fee portion of the plan
- Added `tuition_amount` column (numeric, default 0) — the tuition portion (monthly fees total)
  These are informational breakdowns; `total_amount` remains the authoritative total.

## Security
- RLS enabled on `payment_adjustments`.
- Policies follow the same pattern as other finance tables:
  - SELECT: super_admin OR (payments.view AND institution match) OR own student
  - INSERT: payments.create AND institution match
  - UPDATE: payments.update AND institution match
  - DELETE: payments.delete AND institution match

## Important Notes
1. No existing data is modified — all new columns have safe defaults.
2. The existing trigger `recalc_installment_status` continues to work unchanged.
3. Adjustment amounts are computed in the UI by querying active adjustments.
4. Cancelled adjustments are retained for audit history.
5. The `installment_type` column is informational — the existing trigger and status logic treat all installments the same way.
*/

-- ============================================================
-- 1. Add installment_type to installments
-- ============================================================
ALTER TABLE public.installments
  ADD COLUMN IF NOT EXISTS installment_type text NOT NULL DEFAULT 'custom'
  CHECK (installment_type IN ('enrollment', 'monthly', 'custom'));

CREATE INDEX IF NOT EXISTS idx_installments_type ON public.installments (installment_type);

-- ============================================================
-- 2. Add enrollment_fee and tuition_amount to payment_plans
-- ============================================================
ALTER TABLE public.payment_plans
  ADD COLUMN IF NOT EXISTS enrollment_fee numeric(12,2) NOT NULL DEFAULT 0 CHECK (enrollment_fee >= 0);

ALTER TABLE public.payment_plans
  ADD COLUMN IF NOT EXISTS tuition_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (tuition_amount >= 0);

-- ============================================================
-- 3. Create payment_adjustments table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.payment_adjustments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id    uuid NOT NULL REFERENCES public.institutions(id) ON DELETE RESTRICT,
  payment_plan_id   uuid NOT NULL REFERENCES public.payment_plans(id) ON DELETE CASCADE,
  student_id        uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  academic_year_id  uuid NOT NULL REFERENCES public.academic_years(id) ON DELETE RESTRICT,
  adjustment_type   text NOT NULL CHECK (adjustment_type IN ('discount', 'exemption')),
  scope             text NOT NULL DEFAULT 'total' CHECK (scope IN ('enrollment_fee', 'tuition', 'total')),
  amount_type       text NOT NULL DEFAULT 'fixed_amount' CHECK (amount_type IN ('percentage', 'fixed_amount')),
  amount            numeric(12,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  reason            text,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_payment_adjustments_updated_at ON public.payment_adjustments;
CREATE TRIGGER trg_payment_adjustments_updated_at
  BEFORE UPDATE ON public.payment_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_payment_adjustments_plan ON public.payment_adjustments (payment_plan_id);
CREATE INDEX IF NOT EXISTS idx_payment_adjustments_student ON public.payment_adjustments (student_id);
CREATE INDEX IF NOT EXISTS idx_payment_adjustments_institution ON public.payment_adjustments (institution_id);
CREATE INDEX IF NOT EXISTS idx_payment_adjustments_status ON public.payment_adjustments (status);
CREATE INDEX IF NOT EXISTS idx_payment_adjustments_type ON public.payment_adjustments (adjustment_type);

-- ============================================================
-- 4. Enable RLS on payment_adjustments
-- ============================================================
ALTER TABLE public.payment_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_payment_adjustments" ON public.payment_adjustments;
CREATE POLICY "select_payment_adjustments" ON public.payment_adjustments FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin()
    OR (public.has_permission('payments.view') AND institution_id = public.current_institution_id())
    OR student_id = public.current_student_id()
  );

DROP POLICY IF EXISTS "insert_payment_adjustments" ON public.payment_adjustments;
CREATE POLICY "insert_payment_adjustments" ON public.payment_adjustments FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_permission('payments.create')
    AND institution_id = public.current_institution_id()
  );

DROP POLICY IF EXISTS "update_payment_adjustments" ON public.payment_adjustments;
CREATE POLICY "update_payment_adjustments" ON public.payment_adjustments FOR UPDATE
  TO authenticated
  USING (
    public.has_permission('payments.update')
    AND institution_id = public.current_institution_id()
  )
  WITH CHECK (
    public.has_permission('payments.update')
    AND institution_id = public.current_institution_id()
  );

DROP POLICY IF EXISTS "delete_payment_adjustments" ON public.payment_adjustments;
CREATE POLICY "delete_payment_adjustments" ON public.payment_adjustments FOR DELETE
  TO authenticated
  USING (
    public.has_permission('payments.delete')
    AND institution_id = public.current_institution_id()
  );
