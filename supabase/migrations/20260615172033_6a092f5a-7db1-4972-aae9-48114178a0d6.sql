REVOKE EXECUTE ON FUNCTION public.delete_payment_receipt_and_revert(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_payment_receipt_and_revert(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_payment_receipt_and_revert(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_payment_receipt_and_revert(uuid) TO service_role;