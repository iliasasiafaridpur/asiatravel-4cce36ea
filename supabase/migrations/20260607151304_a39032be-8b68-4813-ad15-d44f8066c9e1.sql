-- 1. cash_expenses: remove overly-permissive staff delete
DROP POLICY IF EXISTS "staff_delete_expenses" ON public.cash_expenses;

-- 2. cash_handovers: remove overly-permissive staff delete
DROP POLICY IF EXISTS "staff_delete_handovers" ON public.cash_handovers;

-- 3. payment_receipts: remove overly-permissive staff delete
DROP POLICY IF EXISTS "staff_delete_receipts" ON public.payment_receipts;

-- 4. profiles: prevent role self-elevation on self-insert
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile"
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id AND role = 'staff');