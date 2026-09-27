# Optional cloud knowledge storage

UAI remains local-first. Verified knowledge is written locally first; optional cloud persistence is a secondary durability layer.

The adapter in `src/cloud-knowledge-store.js` targets a Postgres REST-compatible endpoint such as a user-owned Supabase project. It does not hard-code a vendor and does not make cloud storage mandatory.

Environment variables:

```bash
export IUV_KNOWLEDGE_CLOUD_URL='https://YOUR_PROJECT.supabase.co'
export IUV_KNOWLEDGE_CLOUD_KEY='YOUR_SERVER_SIDE_KEY'
export IUV_KNOWLEDGE_CLOUD_TABLE='uai_verified_knowledge'
```

Keep the key outside source control. Do not put it in prompts, datasets, logs, or browser-delivered code.

The table must enforce a unique `cloud_record_id`. Only records already marked `verification.verified=true` and `training_eligible=true` are eligible for cloud persistence.

Cloud truth states:
- UNAVAILABLE: not configured or network/provider unavailable.
- FAILURE: configured but a request was rejected.
- SUCCESS: a live persistence request succeeded.

Free tiers and quotas change. UAI must treat provider capacity as an operational limit, not as guaranteed storage.
