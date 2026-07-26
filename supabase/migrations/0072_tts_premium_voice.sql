-- Premium diner voice (OpenAI TTS).
--
-- 1) Two agent_config keys so an owner can pick the female voice + opt out:
--    tts_voice  = 'aria' | 'sable' | 'coral' | 'sage'  (default 'aria' in code)
--    tts_enabled = 'true' | 'false'                    (default ON for catalogue stores)
alter type public.agent_config_key add value if not exists 'tts_voice';
alter type public.agent_config_key add value if not exists 'tts_enabled';

-- 2) A private Storage bucket that caches each synthesized clip keyed by
--    (voice, text), so repeated serving lines never hit OpenAI twice. Private —
--    the tts edge function (service role) reads/writes it and streams the bytes.
insert into storage.buckets (id, name, public)
values ('tts-cache', 'tts-cache', false)
on conflict (id) do nothing;
