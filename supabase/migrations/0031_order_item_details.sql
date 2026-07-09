-- Per-store list of per-item details Rani should try to collect when taking an
-- order (brand, size, weight, variant, …). The universal "collect what you can,
-- never force it" rule lives in the prompt; this key tailors it per store.
alter type agent_config_key add value if not exists 'order_item_details';
