-- Phase 4 Step 3C-1: creative image limits badhi (logo 1 MB -> 2 MB, banner 2 MB -> 4 MB).
-- Bucket "creative-assets" ki file_size_limit sabse bade file (banner) ke hisaab se 4 MB (4194304 bytes).
-- Logo ki 2 MB seema app me (lib/campaigns/creative-assets.ts) lagti hai.
-- Sirf bucket ki limit badalta hai: koi table / policy / data nahi chhuta. Rerun-safe.
-- Pehle TEST database par chalao, phir Production par.

begin;

update storage.buckets
   set file_size_limit = 4194304
 where id = 'creative-assets';

commit;

-- CHECK (sirf padhta hai). Expect: 1 row, public = false, file_size_limit = 4194304:
--   select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'creative-assets';
