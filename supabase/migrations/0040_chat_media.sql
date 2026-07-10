-- Private bucket for chat photos a CUSTOMER sends (so staff can see them in the
-- panel later). Bot-sent promo/product images come from the existing kb bucket;
-- this is only for inbound customer uploads (web + WhatsApp).
--
-- Private: reads go through short-lived signed URLs. Writes are service-role
-- (edge functions bypass RLS), so no object policies are needed.

insert into storage.buckets (id, name, public)
values ('chat-media', 'chat-media', false)
on conflict (id) do nothing;

update storage.buckets set file_size_limit = 5242880 where id = 'chat-media'; -- 5 MB
