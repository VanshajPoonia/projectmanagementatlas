-- Revert 131 (strategy canvas). DESTROYS every SWOT entry. Dump first if they matter:
--   pg_dump "$POSTGRES_URL_NON_POOLING" --data-only -t public.strategy_items -Fc -f swot.dump
BEGIN;
DROP TRIGGER IF EXISTS touch_strategy_items ON public.strategy_items;
DROP TABLE IF EXISTS public.strategy_items;
DELETE FROM public.applied_migrations WHERE filename = '131_strategy_canvas.sql';
COMMIT;
