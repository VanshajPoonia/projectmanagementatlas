-- 041_reconcile_main_pm_assignees.sql
-- Sync Main PM Sheet task assignees to the Excel sheet (source of truth).
-- Applies 5 unambiguous corrections. The 'V-ROD PM/TASK Manager' task is intentionally
-- EXCLUDED: the sheet lists Kayla but it is kept on Vanshaj per an explicit prior instruction.
-- Run: psql "$POSTGRES_URL_NON_POOLING" -f scripts/041_reconcile_main_pm_assignees.sql

BEGIN;

-- Need to create a workflow so that when we post something on social media
--   sheet='Brian'  add=['Brian King']  remove=[]
INSERT INTO public.task_assignees (task_id,user_id) VALUES ('54031239-34a1-428c-be1e-7425564b673e',(SELECT id FROM public.profiles WHERE email='siberianheat@gmail.com')) ON CONFLICT (task_id,user_id) DO NOTHING;
UPDATE public.tasks SET assigned_to=(SELECT id FROM public.profiles WHERE email='siberianheat@gmail.com') WHERE id='54031239-34a1-428c-be1e-7425564b673e';

-- Figure out pricing for Brevo to be able to have more contacts
--   sheet='Brian'  add=['Brian King']  remove=['Kayla Viehland']
DELETE FROM public.task_assignees WHERE task_id='7127e187-bc36-4d68-b763-bfc10985ef58' AND user_id=(SELECT id FROM public.profiles WHERE email='kayla@goatlasgo.us');
INSERT INTO public.task_assignees (task_id,user_id) VALUES ('7127e187-bc36-4d68-b763-bfc10985ef58',(SELECT id FROM public.profiles WHERE email='siberianheat@gmail.com')) ON CONFLICT (task_id,user_id) DO NOTHING;
UPDATE public.tasks SET assigned_to=(SELECT id FROM public.profiles WHERE email='siberianheat@gmail.com') WHERE id='7127e187-bc36-4d68-b763-bfc10985ef58';

-- Roofing Contractor in IL paperwork
--   sheet='Brian'  add=['Brian King']  remove=['Kayla Viehland']
DELETE FROM public.task_assignees WHERE task_id='86dcbace-5d44-465b-9b9a-1a7b2cfd6db1' AND user_id=(SELECT id FROM public.profiles WHERE email='kayla@goatlasgo.us');
INSERT INTO public.task_assignees (task_id,user_id) VALUES ('86dcbace-5d44-465b-9b9a-1a7b2cfd6db1',(SELECT id FROM public.profiles WHERE email='siberianheat@gmail.com')) ON CONFLICT (task_id,user_id) DO NOTHING;
UPDATE public.tasks SET assigned_to=(SELECT id FROM public.profiles WHERE email='siberianheat@gmail.com') WHERE id='86dcbace-5d44-465b-9b9a-1a7b2cfd6db1';

-- Create a Google review QR code for ATLAS
--   sheet='Brian'  add=['Brian King']  remove=['Kayla Viehland']
DELETE FROM public.task_assignees WHERE task_id='8add49ce-0de5-4cb4-a6ce-0420dbac27f8' AND user_id=(SELECT id FROM public.profiles WHERE email='kayla@goatlasgo.us');
INSERT INTO public.task_assignees (task_id,user_id) VALUES ('8add49ce-0de5-4cb4-a6ce-0420dbac27f8',(SELECT id FROM public.profiles WHERE email='siberianheat@gmail.com')) ON CONFLICT (task_id,user_id) DO NOTHING;
UPDATE public.tasks SET assigned_to=(SELECT id FROM public.profiles WHERE email='siberianheat@gmail.com') WHERE id='8add49ce-0de5-4cb4-a6ce-0420dbac27f8';

-- Bike Parade section on website non year specfic
--   sheet='Brian'  add=['Brian King']  remove=['Kayla Viehland']
DELETE FROM public.task_assignees WHERE task_id='ced058d1-fd03-4736-af2d-2ba4f5098c06' AND user_id=(SELECT id FROM public.profiles WHERE email='kayla@goatlasgo.us');
INSERT INTO public.task_assignees (task_id,user_id) VALUES ('ced058d1-fd03-4736-af2d-2ba4f5098c06',(SELECT id FROM public.profiles WHERE email='siberianheat@gmail.com')) ON CONFLICT (task_id,user_id) DO NOTHING;
UPDATE public.tasks SET assigned_to=(SELECT id FROM public.profiles WHERE email='siberianheat@gmail.com') WHERE id='ced058d1-fd03-4736-af2d-2ba4f5098c06';

COMMIT;

-- Verification: each touched task's resulting assignees
SELECT t.title, string_agg(p.full_name,', ' ORDER BY p.full_name) AS assignees
FROM public.tasks t
JOIN public.task_assignees ta ON ta.task_id=t.id
JOIN public.profiles p ON p.id=ta.user_id
WHERE t.id IN ('54031239-34a1-428c-be1e-7425564b673e','7127e187-bc36-4d68-b763-bfc10985ef58','86dcbace-5d44-465b-9b9a-1a7b2cfd6db1','8add49ce-0de5-4cb4-a6ce-0420dbac27f8','ced058d1-fd03-4736-af2d-2ba4f5098c06')
GROUP BY t.title ORDER BY t.title;
