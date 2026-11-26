BEGIN;
-- Keep the existing private bucket, or initialize it in a test project if absent.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('sifa-private-documents','sifa-private-documents',false,5242880,ARRAY['application/pdf','image/jpeg','image/png','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
ON CONFLICT(id) DO NOTHING;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id='sifa-private-documents' AND public=false) THEN RAISE EXCEPTION 'Application bucket must be private'; END IF;
END $$;
-- Finalize an application only after the Edge Function has uploaded and validated all attachments.
CREATE OR REPLACE FUNCTION public.sifa_finalize_application_v2(
 p_id uuid,p_ref text,p_user uuid,p_name text,p_email text,p_phone text,p_country text,p_program text,p_payload jsonb,p_docs jsonb
) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_time timestamptz; v_doc jsonb; v_count int;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id=p_user AND email_confirmed_at IS NOT NULL AND lower(trim(email))=lower(trim(p_email))) THEN
  RAISE EXCEPTION 'Verified account required' USING ERRCODE='42501';
 END IF;
 PERFORM 1 FROM public.admission_settings WHERE id=true AND applications_open AND p_program=ANY(open_programs) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Admissions closed'; END IF;
 IF jsonb_typeof(p_docs) IS DISTINCT FROM 'array' OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid application data'; END IF;
 IF jsonb_array_length(p_docs) NOT BETWEEN 3 AND 12 THEN RAISE EXCEPTION 'Invalid attachment count'; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(p_docs) d WHERE d->>'storage_path' LIKE 'public-applications/'||p_id||'/identityDocument/%')<>1
 OR (SELECT count(*) FROM jsonb_array_elements(p_docs) d WHERE d->>'storage_path' LIKE 'public-applications/'||p_id||'/educationCertificate/%')<>1
 OR (SELECT count(*) FROM jsonb_array_elements(p_docs) d WHERE d->>'storage_path' LIKE 'public-applications/'||p_id||'/photo/%' AND d->>'content_type' IN ('image/jpeg','image/png'))<>1 THEN
  RAISE EXCEPTION 'Required documents missing';
 END IF;
 INSERT INTO public.sifa_public_applications(id,application_ref,linked_user_id,full_name,email,phone,country,program,payload,status)
 VALUES(p_id,p_ref,p_user,p_name,p_email,p_phone,p_country,p_program,p_payload,'Submitted') RETURNING submitted_at INTO v_time;
 FOR v_doc IN SELECT value FROM jsonb_array_elements(p_docs) LOOP
  IF NOT starts_with(v_doc->>'storage_path','public-applications/'||p_id||'/') OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='sifa-private-documents' AND name=v_doc->>'storage_path') THEN RAISE EXCEPTION 'Attachment not stored'; END IF;
  INSERT INTO public.sifa_application_documents(public_application_id,storage_bucket,storage_path,original_filename,content_type,byte_size)
  VALUES(p_id,'sifa-private-documents',v_doc->>'storage_path',v_doc->>'original_filename',v_doc->>'content_type',(v_doc->>'byte_size')::bigint);
 END LOOP;
 IF p_payload->>'financialSupport'='Scholarship or fee-waiver request' THEN
  INSERT INTO public.sifa_scholarship_decisions(public_application_id,decision,monthly_discount_percent) VALUES(p_id,'pending',0);
 END IF;
 RETURN v_time;
END; $$;
REVOKE ALL ON FUNCTION public.sifa_finalize_application_v2(uuid,text,uuid,text,text,text,text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sifa_finalize_application_v2(uuid,text,uuid,text,text,text,text,text,jsonb,jsonb) TO service_role;
COMMIT;
